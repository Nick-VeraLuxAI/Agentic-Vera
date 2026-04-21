const { searchMemory, searchMemoryAsync } = require("./searchMemory");
const memoryStore = require("./memoryStore");

/**
 * Back-compat: semantic search over chunk index only (same as unified search, beliefs off).
 */
function searchRelevant(query, options = {}) {
  const sessionId = options.sessionId != null ? String(options.sessionId) : "default";
  const scopeSessionChunks = options.scopeSession === true;
  const result = searchMemory(query, sessionId, {
    includeBeliefs: false,
    includeChunks: true,
    includeEpisodes: false,
    topK: options.topK,
    maxChars: options.maxChars,
    lexicalWeight: options.lexicalWeight,
    vectorWeight: options.vectorWeight,
    scopeSessionChunks,
  });
  return result.chunks;
}

async function searchRelevantAsync(query, options = {}) {
  const sessionId = options.sessionId != null ? String(options.sessionId) : "default";
  const scopeSessionChunks = options.scopeSession === true;
  const result = await searchMemoryAsync(query, sessionId, {
    includeBeliefs: false,
    includeChunks: true,
    includeEpisodes: false,
    topK: options.topK,
    maxChars: options.maxChars,
    lexicalWeight: options.lexicalWeight,
    vectorWeight: options.vectorWeight,
    scopeSessionChunks,
  });
  return result.chunks;
}

async function addDocuments(sessionId, source, text, metadata = {}) {
  return memoryStore.addDocuments(sessionId, source, text, metadata);
}

function getStats() {
  return memoryStore.getChunkStats();
}

module.exports = {
  addDocuments,
  searchRelevant,
  searchRelevantAsync,
  getStats,
  embedText: require("./embeddings").embedText,
};
