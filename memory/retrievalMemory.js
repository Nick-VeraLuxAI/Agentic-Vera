const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ensureDirSync, atomicWriteJsonSync, readJsonSafeSync, withMemoryLock } = require("./storage");

const INDEX_FILE = process.env.VERA_RETRIEVAL_INDEX_FILE || path.join(__dirname, "retrieval_index.json");
const MAX_DOCS = Number(process.env.VERA_RETRIEVAL_MAX_DOCS || 5000);
const CHUNK_SIZE = Number(process.env.VERA_RETRIEVAL_CHUNK_SIZE || 900);
const CHUNK_OVERLAP = Number(process.env.VERA_RETRIEVAL_CHUNK_OVERLAP || 150);
const USE_EMBEDDINGS = String(process.env.VERA_RETRIEVAL_USE_EMBEDDINGS || "true").toLowerCase() === "true";
const EMBEDDING_DIM = Number(process.env.VERA_RETRIEVAL_EMBED_DIM || 128);

function ensureIndexExists() {
  ensureDirSync(path.dirname(INDEX_FILE));
  if (!fs.existsSync(INDEX_FILE)) {
    atomicWriteJsonSync(INDEX_FILE, { documents: [] });
  }
}

function loadIndex() {
  ensureIndexExists();
  const raw = readJsonSafeSync(INDEX_FILE, { documents: [] });
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.documents)) {
    return { documents: [] };
  }
  return raw;
}

function saveIndex(index) {
  atomicWriteJsonSync(INDEX_FILE, index);
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function hashTokenToIndex(token, dim) {
  const digest = crypto.createHash("sha1").update(token).digest();
  const value = digest.readUInt32BE(0);
  return value % dim;
}

function embedText(text, dim = EMBEDDING_DIM) {
  const tokens = tokenize(text);
  if (!tokens.length) return null;
  const vector = new Array(dim).fill(0);
  for (const token of tokens) {
    const idx = hashTokenToIndex(token, dim);
    vector[idx] += 1;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (!norm) return null;
  return vector.map((value) => Number((value / norm).toFixed(8)));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i]) || 0;
    const bv = Number(b[i]) || 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function termFrequency(tokens) {
  const tf = Object.create(null);
  for (const token of tokens) tf[token] = (tf[token] || 0) + 1;
  return tf;
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

function scoreMatch(queryTokens, docTokens, totalDocs, documentFrequencyMap) {
  if (!queryTokens.length || !docTokens.length) return 0;
  const docTf = termFrequency(docTokens);
  const docLengthNorm = Math.sqrt(docTokens.length);
  let score = 0;

  for (const token of queryTokens) {
    const tf = docTf[token] || 0;
    if (!tf) continue;
    const df = documentFrequencyMap[token] || 0;
    const idf = Math.log(1 + (totalDocs + 1) / (df + 1));
    score += (tf / docLengthNorm) * idf;
  }

  return score;
}

async function addDocuments(sessionId, source, text, metadata = {}) {
  const chunks = chunkText(text);
  if (!chunks.length) return 0;

  return withMemoryLock(async () => {
    const index = loadIndex();
    const now = Date.now();
    for (const chunk of chunks) {
      const id = crypto
        .createHash("sha1")
        .update(`${sessionId}|${source}|${chunk}`)
        .digest("hex");
      index.documents.push({
        id,
        sessionId: String(sessionId || "default"),
        source: String(source || "unknown"),
        text: chunk,
        embedding: USE_EMBEDDINGS ? embedText(chunk) : null,
        metadata,
        createdAt: now,
      });
    }

    const dedup = new Map();
    for (const doc of index.documents) dedup.set(doc.id, doc);
    index.documents = Array.from(dedup.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_DOCS);
    saveIndex(index);
    return chunks.length;
  });
}

function searchRelevant(query, options = {}) {
  const topK = Number(options.topK || 4);
  const maxChars = Number(options.maxChars || 2800);
  const lexicalWeight = Number(options.lexicalWeight || 0.5);
  const vectorWeight = Number(options.vectorWeight || 0.5);
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  const index = loadIndex();
  const docs = index.documents || [];
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
      const lexicalScore = scoreMatch(queryTokens, docTokensById.get(doc.id), docs.length, df);
      const vectorScore = queryEmbedding && Array.isArray(doc.embedding) ? cosineSimilarity(queryEmbedding, doc.embedding) : 0;
      return {
        doc,
        lexicalScore,
        vectorScore,
      };
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
      return {
        ...item,
        score: combinedScore,
      };
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

  return selected.map((item) => ({
    score: Number(item.score.toFixed(4)),
    source: item.doc.source,
    sessionId: item.doc.sessionId,
    text: item.doc.text,
  }));
}

function getStats() {
  const index = loadIndex();
  const withEmbeddings = index.documents.filter((doc) => Array.isArray(doc.embedding) && doc.embedding.length > 0).length;
  return {
    documents: index.documents.length,
    documentsWithEmbeddings: withEmbeddings,
    embeddingCoverage: index.documents.length ? Number((withEmbeddings / index.documents.length).toFixed(4)) : 0,
    embeddingsEnabled: USE_EMBEDDINGS,
    embeddingDimension: EMBEDDING_DIM,
    indexFile: INDEX_FILE,
  };
}

module.exports = {
  addDocuments,
  searchRelevant,
  getStats,
  embedText,
};
