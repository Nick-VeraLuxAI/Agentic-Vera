const { embedText, EMBEDDING_DIM } = require("./embeddings");

/**
 * Stable fingerprint for the active embedding configuration (index + query must match).
 */
function getEmbeddingFingerprint() {
  const url = String(process.env.VERA_EMBEDDING_HTTP_URL || "").trim();
  if (url) {
    const model = String(process.env.VERA_EMBEDDING_MODEL || "text-embedding-3-small");
    return `http:${model}`;
  }
  const dim = Number(process.env.VERA_RETRIEVAL_EMBED_DIM || 128);
  return `hash:${dim}`;
}

/**
 * Index-time embedding (same vector space as embedQueryVectorAsync).
 */
async function embedChunkForIndexAsync(text, dim = EMBEDDING_DIM) {
  return embedQueryVectorAsync(text, dim);
}

/**
 * Optional OpenAI-compatible embeddings HTTP API for query vectors.
 * Set VERA_EMBEDDING_HTTP_URL (e.g. https://api.openai.com/v1/embeddings) and VERA_EMBEDDING_API_KEY.
 * VERA_EMBEDDING_MODEL defaults to text-embedding-3-small.
 */
async function embedQueryVectorAsync(text, dim = EMBEDDING_DIM) {
  const url = String(process.env.VERA_EMBEDDING_HTTP_URL || "").trim();
  if (!url) {
    return embedText(text, dim);
  }

  const model = String(process.env.VERA_EMBEDDING_MODEL || "text-embedding-3-small");
  const apiKey = String(process.env.VERA_EMBEDDING_API_KEY || "").trim();
  const input = String(text || "").slice(0, 12000);

  const endpoint = url.includes("/embeddings") ? url : `${url.replace(/\/$/, "")}/v1/embeddings`;
  const body = JSON.stringify({ model, input });

  const headers = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = apiKey.toLowerCase().startsWith("bearer ") ? apiKey : `Bearer ${apiKey}`;
  }

  const res = await fetch(endpoint, { method: "POST", headers, body });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Embedding HTTP ${res.status}: ${raw.slice(0, 200)}`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (_e) {
    throw new Error("Embedding response was not JSON.");
  }
  const data = json.data && json.data[0];
  const vec = data && data.embedding;
  if (!Array.isArray(vec) || !vec.length) {
    throw new Error("Embedding response missing data[0].embedding array.");
  }
  return vec.map((x) => Number(x) || 0);
}

module.exports = {
  embedQueryVectorAsync,
  embedChunkForIndexAsync,
  getEmbeddingFingerprint,
};
