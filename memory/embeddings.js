const crypto = require("crypto");

const EMBEDDING_DIM = Number(process.env.VERA_RETRIEVAL_EMBED_DIM || 128);

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

module.exports = {
  tokenize,
  embedText,
  cosineSimilarity,
  scoreMatch,
  EMBEDDING_DIM,
};
