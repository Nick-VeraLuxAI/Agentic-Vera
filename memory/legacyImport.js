const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readJsonSafeSync } = require("./storage");
const { embedText } = require("./embeddings");

function parseFactContent(obj) {
  if (!obj || typeof obj !== "object") return null;
  return JSON.stringify(obj);
}

function importLongtermJson(db, filePath) {
  const facts = readJsonSafeSync(filePath, []);
  if (!Array.isArray(facts) || facts.length === 0) return { beliefs: 0 };

  const insertEntity = db.prepare(`
    INSERT INTO entities (id, kind, label, normalized_key, metadata, created_at)
    VALUES (@id, @kind, @label, @normalized_key, @metadata, @created_at)
  `);
  const selectEntity = db.prepare(`SELECT id FROM entities WHERE normalized_key = ?`);
  const insertBelief = db.prepare(`
    INSERT INTO beliefs (id, session_id, entity_id, subject_key, content, confidence, valid_from, valid_to, superseded_by, source_event_id)
    VALUES (@id, @session_id, @entity_id, @subject_key, @content, @confidence, @valid_from, NULL, NULL, NULL)
  `);

  const now = Date.now();
  let n = 0;
  const upsertEntity = (fact) => {
    const label = String(fact.subject || fact.text || "fact").slice(0, 500);
    const normalized = label
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "unknown";
    const existing = selectEntity.get(normalized);
    if (existing) return existing.id;
    const id = crypto.createHash("sha1").update(`entity|${normalized}`).digest("hex").slice(0, 32);
    insertEntity.run({
      id,
      kind: "subject",
      label,
      normalized_key: normalized,
      metadata: null,
      created_at: now,
    });
    return id;
  };

  const transaction = db.transaction((rows) => {
    for (const fact of rows) {
      if (!fact || typeof fact !== "object" || !fact.text) continue;
      const entityId = upsertEntity(fact);
      const subjectKey = [
        fact.subject || "",
        fact.sentiment || "",
        fact.type || "",
      ]
        .join(" ")
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/[.,!?;:]+$/, "")
        .replace(/\b(the user|user)\b/g, "")
        .replace(/\b(likes|loves|enjoys|prefers|doesn't like|does not like|dislikes|hates)\b/g, "")
        .trim() || normalizedKeyFromFact(fact);

      const id = crypto.randomUUID();
      insertBelief.run({
        id,
        session_id: "",
        entity_id: entityId,
        subject_key: subjectKey,
        content: parseFactContent(fact),
        confidence: typeof fact.confidence === "number" ? fact.confidence : null,
        valid_from: now,
      });
      n += 1;
    }
  });

  transaction(facts);
  return { beliefs: n };
}

function normalizedKeyFromFact(fact) {
  return String(fact.text || "")
    .toLowerCase()
    .slice(0, 200);
}

function importRetrievalIndexJson(db, filePath) {
  const raw = readJsonSafeSync(filePath, { documents: [] });
  const docs = Array.isArray(raw.documents) ? raw.documents : [];
  if (!docs.length) return { chunks: 0 };

  const insertChunk = db.prepare(`
    INSERT OR IGNORE INTO chunks (id, event_id, session_id, source, text, metadata, embedding, created_at)
    VALUES (@id, NULL, @session_id, @source, @text, @metadata, @embedding, @created_at)
  `);

  let n = 0;
  const tx = db.transaction((rows) => {
    for (const doc of rows) {
      if (!doc || !doc.text) continue;
      const id = doc.id || crypto.createHash("sha1").update(`${doc.sessionId}|${doc.source}|${doc.text}`).digest("hex");
      const emb =
        Array.isArray(doc.embedding) && doc.embedding.length
          ? JSON.stringify(doc.embedding)
          : JSON.stringify(embedText(doc.text) || []);
      insertChunk.run({
        id,
        session_id: String(doc.sessionId || "default"),
        source: String(doc.source || "imported"),
        text: String(doc.text),
        metadata: doc.metadata ? JSON.stringify(doc.metadata) : null,
        embedding: emb,
        created_at: Number(doc.createdAt) || Date.now(),
      });
      n += 1;
    }
  });

  tx(docs);
  return { chunks: n };
}

function runLegacyImportIfNeeded(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get("legacy_json_v1");
  if (row) return { skipped: true };

  const existingBeliefs = db.prepare("SELECT COUNT(*) as c FROM beliefs").get().c;
  const existingChunks = db.prepare("SELECT COUNT(*) as c FROM chunks").get().c;
  if (existingBeliefs > 0 || existingChunks > 0) {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_json_v1', ?)").run("non_empty_db");
    return { skipped: true, reason: "db_already_has_data" };
  }

  const longTermPath = process.env.VERA_LONGTERM_FILE || path.join(__dirname, "longterm.json");
  const retrievalPath = process.env.VERA_RETRIEVAL_INDEX_FILE || path.join(__dirname, "retrieval_index.json");

  let beliefCount = 0;
  let chunkCount = 0;

  if (fs.existsSync(longTermPath)) {
    const r = importLongtermJson(db, longTermPath);
    beliefCount = r.beliefs;
  }
  if (fs.existsSync(retrievalPath)) {
    const r = importRetrievalIndexJson(db, retrievalPath);
    chunkCount = r.chunks;
  }

  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_json_v1', ?)").run(String(Date.now()));
  return { beliefs: beliefCount, chunks: chunkCount };
}

module.exports = {
  runLegacyImportIfNeeded,
  importLongtermJson,
  importRetrievalIndexJson,
};
