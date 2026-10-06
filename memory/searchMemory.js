const { getDb } = require("./db");
const {
  tokenize,
  embedText,
  cosineSimilarity,
  scoreMatch,
} = require("./embeddings");
const { embedQueryVectorAsync } = require("./embeddingProvider");

const USE_EMBEDDINGS = String(process.env.VERA_RETRIEVAL_USE_EMBEDDINGS || "true").toLowerCase() === "true";

function mapChunkHit(item) {
  const doc = item.doc;
  const text = doc.text;
  const end = Math.max(0, text.length - 1);
  return {
    score: Number(item.score.toFixed(4)),
    source: doc.source,
    sessionId: doc.session_id,
    text,
    chunkId: doc.id,
    charStart: 0,
    charEnd: end,
    embeddingFingerprint: doc.embedding_fp || null,
  };
}

function scoreBeliefAgainstQuery(queryTokens, factObj) {
  const hay = [
    factObj.subject,
    factObj.text,
    factObj.original,
    factObj.value,
    factObj.type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!hay) return 0;
  let score = 0;
  for (const t of queryTokens) {
    if (t.length > 1 && hay.includes(t)) score += 1;
  }
  return score;
}

function rankActiveBeliefs(query, sessionId) {
  const db = getDb();
  const sid = String(sessionId || "default");
  const rows = db
    .prepare(
      `SELECT content FROM beliefs WHERE valid_to IS NULL AND (session_id = '' OR session_id = ?) ORDER BY valid_from DESC`
    )
    .all(sid);

  const queryTokens = tokenize(query);
  const parsed = [];
  for (const r of rows) {
    try {
      const o = JSON.parse(r.content);
      if (o && typeof o === "object") parsed.push(o);
    } catch (_e) {
      /* skip */
    }
  }

  if (!queryTokens.length) return parsed.slice(0, 12);

  const scored = parsed
    .map((f) => ({
      fact: f,
      score: scoreBeliefAgainstQuery(queryTokens, f),
    }))
    .sort((a, b) => b.score - a.score);

  const withHits = scored.filter((x) => x.score > 0);
  if (withHits.length) return withHits.slice(0, 12).map((x) => x.fact);
  return parsed.slice(0, 8);
}

function searchChunks(query, options = {}) {
  const topK = Number(options.topK || 4);
  const maxChars = Number(options.maxChars || 2800);
  const lexicalWeight = Number(options.lexicalWeight || 0.5);
  const vectorWeight = Number(options.vectorWeight || 0.5);
  const sessionId = options.sessionId != null ? String(options.sessionId) : null;

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  const db = getDb();
  let sql = `SELECT id, session_id, source, text, metadata, embedding, embedding_fp, created_at FROM chunks`;
  const params = [];
  if (sessionId) {
    sql += ` WHERE session_id = ?`;
    params.push(sessionId);
  }
  const docs = db.prepare(sql).all(...params);
  if (!docs.length) return [];

  const docTokensById = new Map();
  const df = Object.create(null);
  for (const doc of docs) {
    const tokens = tokenize(doc.text);
    docTokensById.set(doc.id, tokens);
    const unique = new Set(tokens);
    for (const t of unique) df[t] = (df[t] || 0) + 1;
  }

  const queryEmbedding = USE_EMBEDDINGS ? embedText(query) : null;
  const scored = docs
    .map((doc) => {
      let emb = null;
      if (doc.embedding) {
        try {
          emb = JSON.parse(doc.embedding);
        } catch (_e) {
          emb = null;
        }
      }
      const lexicalScore = scoreMatch(queryTokens, docTokensById.get(doc.id), docs.length, df);
      const vectorScore = queryEmbedding && Array.isArray(emb) ? cosineSimilarity(queryEmbedding, emb) : 0;
      return { doc, lexicalScore, vectorScore };
    })
    .filter((x) => x.lexicalScore > 0 || x.vectorScore > 0);

  const lexicalMax = scored.reduce((max, item) => Math.max(max, item.lexicalScore), 0) || 1;
  const vectorMax = scored.reduce((max, item) => Math.max(max, item.vectorScore), 0) || 1;
  const ranked = scored
    .map((item) => {
      const lexicalNormalized = item.lexicalScore / lexicalMax;
      const vectorNormalized = item.vectorScore / vectorMax;
      const combinedScore = queryEmbedding
        ? lexicalNormalized * lexicalWeight + vectorNormalized * vectorWeight
        : lexicalNormalized;
      return { ...item, score: combinedScore };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 3);

  const selected = [];
  let usedChars = 0;
  for (const item of ranked) {
    if (selected.length >= topK) break;
    const len = item.doc.text.length;
    if (usedChars + len > maxChars) continue;
    selected.push(item);
    usedChars += len;
  }

  return selected.map((item) => mapChunkHit(item));
}

async function searchChunksAsync(query, options = {}) {
  const topK = Number(options.topK || 4);
  const maxChars = Number(options.maxChars || 2800);
  const lexicalWeight = Number(options.lexicalWeight || 0.5);
  const vectorWeight = Number(options.vectorWeight || 0.5);
  const sessionId = options.sessionId != null ? String(options.sessionId) : null;

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  const db = getDb();
  let sql = `SELECT id, session_id, source, text, metadata, embedding, embedding_fp, created_at FROM chunks`;
  const params = [];
  if (sessionId) {
    sql += ` WHERE session_id = ?`;
    params.push(sessionId);
  }
  const docs = db.prepare(sql).all(...params);
  if (!docs.length) return [];

  const docTokensById = new Map();
  const df = Object.create(null);
  for (const doc of docs) {
    const tokens = tokenize(doc.text);
    docTokensById.set(doc.id, tokens);
    const unique = new Set(tokens);
    for (const t of unique) df[t] = (df[t] || 0) + 1;
  }

  let queryEmbedding = null;
  if (USE_EMBEDDINGS) {
    try {
      queryEmbedding = await embedQueryVectorAsync(query);
    } catch (err) {
      console.warn("embedQueryVectorAsync failed, falling back to local hash embed:", err.message);
      queryEmbedding = embedText(query);
    }
  }

  const scored = docs
    .map((doc) => {
      let emb = null;
      if (doc.embedding) {
        try {
          emb = JSON.parse(doc.embedding);
        } catch (_e) {
          emb = null;
        }
      }
      const lexicalScore = scoreMatch(queryTokens, docTokensById.get(doc.id), docs.length, df);
      let vectorScore = 0;
      if (queryEmbedding && Array.isArray(emb)) {
        if (emb.length === queryEmbedding.length) {
          vectorScore = cosineSimilarity(queryEmbedding, emb);
        }
      }
      return { doc, lexicalScore, vectorScore };
    })
    .filter((x) => x.lexicalScore > 0 || x.vectorScore > 0);

  const lexicalMax = scored.reduce((max, item) => Math.max(max, item.lexicalScore), 0) || 1;
  const vectorMax = scored.reduce((max, item) => Math.max(max, item.vectorScore), 0) || 1;
  const ranked = scored
    .map((item) => {
      const lexicalNormalized = item.lexicalScore / lexicalMax;
      const vectorNormalized = item.vectorScore / vectorMax;
      const combinedScore = queryEmbedding
        ? lexicalNormalized * lexicalWeight + vectorNormalized * vectorWeight
        : lexicalNormalized;
      return { ...item, score: combinedScore };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 3);

  const selected = [];
  let usedChars = 0;
  for (const item of ranked) {
    if (selected.length >= topK) break;
    const len = item.doc.text.length;
    if (usedChars + len > maxChars) continue;
    selected.push(item);
    usedChars += len;
  }

  return selected.map((item) => mapChunkHit(item));
}

function recentEpisodes(sessionId, limit = 5) {
  const db = getDb();
  const sid = String(sessionId || "default");
  return db
    .prepare(
      `SELECT id, source, type, payload, created_at FROM events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(sid, limit);
}

/**
 * Unified memory retrieval: beliefs + RAG chunks + optional recent events.
 */
function searchMemory(query, sessionId = "default", options = {}) {
  const includeBeliefs = options.includeBeliefs !== false;
  const includeChunks = options.includeChunks !== false;
  const includeEpisodes = options.includeEpisodes === true;
  const scopeSessionChunks = options.scopeSessionChunks === true;

  const beliefs = includeBeliefs ? rankActiveBeliefs(query, sessionId) : [];

  const chunkOpts = {
    topK: Number(
      options.topK != null ? options.topK : Number(process.env.VERA_RETRIEVAL_TOP_K || 4)
    ),
    maxChars: Number(
      options.maxChars != null
        ? options.maxChars
        : Number(process.env.VERA_RETRIEVAL_MAX_CONTEXT_CHARS || 2800)
    ),
    sessionId: scopeSessionChunks ? sessionId : null,
  };

  const chunks = includeChunks ? searchChunks(query, chunkOpts) : [];

  const episodes = includeEpisodes ? recentEpisodes(sessionId, options.episodeLimit || 5) : [];

  return {
    beliefs,
    chunks,
    episodes,
  };
}

async function searchMemoryAsync(query, sessionId = "default", options = {}) {
  const includeBeliefs = options.includeBeliefs !== false;
  const includeChunks = options.includeChunks !== false;
  const includeEpisodes = options.includeEpisodes === true;
  const scopeSessionChunks = options.scopeSessionChunks === true;

  const beliefs = includeBeliefs ? rankActiveBeliefs(query, sessionId) : [];

  const chunkOpts = {
    topK: Number(
      options.topK != null ? options.topK : Number(process.env.VERA_RETRIEVAL_TOP_K || 4)
    ),
    maxChars: Number(
      options.maxChars != null
        ? options.maxChars
        : Number(process.env.VERA_RETRIEVAL_MAX_CONTEXT_CHARS || 2800)
    ),
    sessionId: scopeSessionChunks ? sessionId : null,
  };

  const chunks = includeChunks ? await searchChunksAsync(query, chunkOpts) : [];

  const episodes = includeEpisodes ? recentEpisodes(sessionId, options.episodeLimit || 5) : [];

  return {
    beliefs,
    chunks,
    episodes,
  };
}

module.exports = {
  searchMemory,
  searchMemoryAsync,
  searchChunks,
  searchChunksAsync,
  rankActiveBeliefs,
  recentEpisodes,
};
