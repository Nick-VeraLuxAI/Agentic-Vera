const crypto = require("crypto");
const { getDb, getDbPath } = require("./db");
const { withMemoryLock } = require("./storage");
const { runMemorySummarizer } = require("./memorySummarizer");
const { embedText } = require("./embeddings");
const { embedChunkForIndexAsync, getEmbeddingFingerprint } = require("./embeddingProvider");
const { markContradictionsForNewBelief } = require("./memoryContradiction");

const MAX_DOCS = Number(process.env.VERA_RETRIEVAL_MAX_DOCS || 5000);
const CHUNK_SIZE = Number(process.env.VERA_RETRIEVAL_CHUNK_SIZE || 900);
const CHUNK_OVERLAP = Number(process.env.VERA_RETRIEVAL_CHUNK_OVERLAP || 150);
const USE_EMBEDDINGS = String(process.env.VERA_RETRIEVAL_USE_EMBEDDINGS || "true").toLowerCase() === "true";

function parseKeyValueMemoryBlock(text) {
  const lines = String(text).split("\n");
  const obj = {};
  for (const line of lines) {
    const [key, ...rest] = line.split(":");
    if (!key || !rest.length) continue;
    obj[key.trim().toLowerCase()] = rest.join(":").trim();
  }
  if (obj.confidence) obj.confidence = parseFloat(obj.confidence);
  return obj;
}

function normalizeFactObj(factObj) {
  if (!factObj || typeof factObj !== "object") return "";
  return [
    factObj.subject || "",
    factObj.sentiment || "",
    factObj.type || "",
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.,!?;:]+$/, "")
    .replace(/\b(the user|user)\b/g, "")
    .replace(/\b(likes|loves|enjoys|prefers|doesn't like|does not like|dislikes|hates)\b/g, "")
    .trim();
}

function subjectKeyFromFact(factObj) {
  const n = normalizeFactObj(factObj);
  return n || String(factObj.text || "").toLowerCase().slice(0, 400);
}

function upsertEntityForFact(db, factObj, now) {
  const label = String(factObj.subject || factObj.text || "fact").slice(0, 500);
  const normalized = label
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "unknown";

  const select = db.prepare(`SELECT id FROM entities WHERE normalized_key = ?`);
  const existing = select.get(normalized);
  if (existing) return existing.id;

  const id = crypto.createHash("sha1").update(`entity|${normalized}`).digest("hex").slice(0, 32);
  db.prepare(
    `INSERT INTO entities (id, kind, label, normalized_key, metadata, created_at) VALUES (?, 'subject', ?, ?, NULL, ?)`
  ).run(id, label, normalized, now);
  return id;
}

function chunkText(text) {
  const input = String(text || "").trim();
  if (!input) return [];
  if (input.length <= CHUNK_SIZE) return [input];
  const chunks = [];
  let start = 0;
  while (start < input.length) {
    const end = Math.min(input.length, start + CHUNK_SIZE);
    chunks.push(input.slice(start, end));
    if (end >= input.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function pruneOldChunks(db) {
  const count = db.prepare(`SELECT COUNT(*) as c FROM chunks`).get().c;
  const excess = count - MAX_DOCS;
  if (excess <= 0) return;
  const rows = db.prepare(`SELECT id FROM chunks ORDER BY created_at ASC LIMIT ?`).all(excess);
  const del = db.prepare(`DELETE FROM chunks WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const r of rows) del.run(r.id);
  });
  tx();
}

function getFactsSync() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT content FROM beliefs WHERE valid_to IS NULL ORDER BY valid_from DESC`
    )
    .all();
  const out = [];
  for (const r of rows) {
    try {
      const o = JSON.parse(r.content);
      if (o && typeof o === "object") out.push(o);
    } catch (_e) {
      /* skip */
    }
  }
  return out;
}

async function addFact(rawInput) {
  return withMemoryLock(async () => {
    const db = getDb();
    const summarizedInput =
      rawInput && typeof rawInput === "object" && rawInput.text
        ? rawInput
        : await runMemorySummarizer(rawInput);
    const summarized =
      typeof summarizedInput === "string" ? parseKeyValueMemoryBlock(summarizedInput) : summarizedInput;

    if (!summarized || typeof summarized !== "object" || !summarized.text) {
      console.log("⚠️ Skipping invalid summary:", summarized);
      return;
    }

    const now = Date.now();
    const subjectKey = subjectKeyFromFact(summarized);
    const sessionId = "";
    const entityId = upsertEntityForFact(db, summarized, now);
    const newId = crypto.randomUUID();

    const eventId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO events (id, session_id, source, type, payload, created_at) VALUES (?, ?, 'memory', 'belief_added', ?, ?)`
    ).run(eventId, sessionId || "default", JSON.stringify({ subjectKey }), now);

    const supersede = db.transaction(() => {
      const prev = db
        .prepare(
          `SELECT id FROM beliefs WHERE subject_key = ? AND session_id = ? AND valid_to IS NULL`
        )
        .all(subjectKey, sessionId);
      for (const p of prev) {
        db.prepare(`UPDATE beliefs SET valid_to = ?, superseded_by = ? WHERE id = ?`).run(now, newId, p.id);
      }

      db.prepare(
        `INSERT INTO beliefs (id, session_id, entity_id, subject_key, content, confidence, valid_from, valid_to, superseded_by, source_event_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`
      ).run(
        newId,
        sessionId,
        entityId,
        subjectKey,
        JSON.stringify(summarized),
        typeof summarized.confidence === "number" ? summarized.confidence : null,
        now,
        eventId
      );
    });

    supersede();
    try {
      markContradictionsForNewBelief(db, summarized, newId, sessionId);
    } catch (_e) {
      /* review_flag may be unavailable before migration */
    }
    console.log("💾 Saved structured fact:", summarized.text);
  });
}

async function deleteFact(rawInput) {
  return withMemoryLock(async () => {
    const db = getDb();
    const summarizedInput =
      rawInput && typeof rawInput === "object" && rawInput.text
        ? rawInput
        : await runMemorySummarizer(rawInput);
    const summarized =
      typeof summarizedInput === "string" ? parseKeyValueMemoryBlock(summarizedInput) : summarizedInput;

    if (!summarized || typeof summarized !== "object" || !summarized.text) return false;

    const now = Date.now();
    const targetKey = subjectKeyFromFact(summarized);
    const sessionId = "";

    const rows = db
      .prepare(`SELECT id FROM beliefs WHERE subject_key = ? AND session_id = ? AND valid_to IS NULL`)
      .all(targetKey, sessionId);

    if (!rows.length) {
      const normTarget = normalizeFactObj(summarized);
      const all = db.prepare(`SELECT id, content FROM beliefs WHERE valid_to IS NULL`).all();
      for (const r of all) {
        try {
          const o = JSON.parse(r.content);
          if (normalizeFactObj(o) === normTarget) {
            rows.push({ id: r.id });
            break;
          }
        } catch (_e) {
          /* ignore */
        }
      }
    }

    let changed = 0;
    const tx = db.transaction(() => {
      for (const r of rows) {
        db.prepare(`UPDATE beliefs SET valid_to = ? WHERE id = ?`).run(now, r.id);
        changed += 1;
      }
    });
    tx();

    if (changed) console.log("🧹 Deleted fact if matched:", summarized.text);
    return changed > 0;
  });
}

function clearFacts() {
  const db = getDb();
  const now = Date.now();
  db.prepare(`UPDATE beliefs SET valid_to = ? WHERE valid_to IS NULL`).run(now);
}

async function addDocuments(sessionId, source, text, metadata = {}) {
  return withMemoryLock(async () => {
    const db = getDb();
    const sid = String(sessionId || "default");
    const chunks = chunkText(text);
    if (!chunks.length) return 0;

    const now = Date.now();
    const eventId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO events (id, session_id, source, type, payload, created_at) VALUES (?, ?, ?, 'chunk_ingest', ?, ?)`
    ).run(eventId, sid, source, JSON.stringify({ chunks: chunks.length }), now);

    const useHttp = String(process.env.VERA_EMBEDDING_HTTP_URL || "").trim();
    const fpPrimary = getEmbeddingFingerprint();
    const fpHashFallback = `hash:${Number(process.env.VERA_RETRIEVAL_EMBED_DIM || 128)}`;
    const prepared = [];
    for (const chunk of chunks) {
      let emb = null;
      let fpRow = USE_EMBEDDINGS ? fpPrimary : null;
      if (USE_EMBEDDINGS) {
        try {
          emb = useHttp ? await embedChunkForIndexAsync(chunk) : embedText(chunk);
        } catch (err) {
          console.warn("Chunk embedding failed, using local hash embed:", err.message);
          emb = embedText(chunk);
          fpRow = fpHashFallback;
        }
      }
      prepared.push({ chunk, emb, fp: fpRow });
    }

    const insert = db.prepare(
      `INSERT OR REPLACE INTO chunks (id, event_id, session_id, source, text, metadata, embedding, embedding_fp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const run = db.transaction(() => {
      for (const row of prepared) {
        const id = crypto.createHash("sha1").update(`${sid}|${source}|${row.chunk}`).digest("hex");
        insert.run(
          id,
          eventId,
          sid,
          source,
          row.chunk,
          JSON.stringify(metadata),
          row.emb ? JSON.stringify(row.emb) : null,
          row.fp,
          now
        );
      }
      pruneOldChunks(db);
    });

    run();
    return chunks.length;
  });
}

function getChunkStats() {
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) as c FROM chunks`).get().c;
  const withEmb = db.prepare(`SELECT COUNT(*) as c FROM chunks WHERE embedding IS NOT NULL`).get().c;
  const fp = getEmbeddingFingerprint();
  let fingerprintMismatch = 0;
  try {
    fingerprintMismatch = db
      .prepare(
        `SELECT COUNT(*) as c FROM chunks WHERE embedding IS NOT NULL AND (embedding_fp IS NULL OR embedding_fp != ?)`
      )
      .get(fp).c;
  } catch (_e) {
    /* pre-migration */
  }
  return {
    documents: total,
    documentsWithEmbeddings: withEmb,
    embeddingCoverage: total ? Number((withEmb / total).toFixed(4)) : 0,
    embeddingsEnabled: USE_EMBEDDINGS,
    embeddingFingerprint: fp,
    fingerprintMismatch,
    embeddingDimension: Number(process.env.VERA_RETRIEVAL_EMBED_DIM || 128),
    indexFile: getDbPath(),
  };
}

function listReviewQueue(limit = 50) {
  const db = getDb();
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  try {
    return db
      .prepare(
        `SELECT id, subject_key, content, confidence, valid_from, review_flag FROM beliefs WHERE valid_to IS NULL AND review_flag != 0 ORDER BY valid_from DESC LIMIT ?`
      )
      .all(lim);
  } catch (_e) {
    return [];
  }
}

module.exports = {
  getFacts: getFactsSync,
  addFact,
  deleteFact,
  clearFacts,
  addDocuments,
  getChunkStats,
  listReviewQueue,
  normalizeFactObj,
  subjectKeyFromFact,
  parseKeyValueMemoryBlock,
};
