const shortTerm = require("./shortTermMemory");
const longTerm = require("./longTermMemory");
const { shouldRemember, shouldForget } = require("./memoryDecider");
const { runMemorySummarizer } = require("./memorySummarizer");
const { searchMemory, searchMemoryAsync } = require("./searchMemory");

async function getAllMemory(sessionId) {
  return {
    shortTerm: await shortTerm.loadMemory(sessionId),
    longTerm: longTerm.getFacts(),
  };
}

async function getRelevantFacts(userInput, sessionId = "default") {
  return searchMemory(userInput, sessionId, { includeChunks: false }).beliefs;
}

async function searchUnified(query, sessionId = "default", options = {}) {
  const opts = {
    includeBeliefs: options.includeBeliefs !== false,
    includeChunks: options.includeChunks !== false,
    includeEpisodes: options.includeEpisodes === true,
    topK: options.topK,
    maxChars: options.maxChars,
    scopeSessionChunks: options.scopeSessionChunks === true,
    episodeLimit: options.episodeLimit,
  };
  if (String(process.env.VERA_EMBEDDING_HTTP_URL || "").trim()) {
    return searchMemoryAsync(query, sessionId, opts);
  }
  return searchMemory(query, sessionId, opts);
}

async function processUserMessage(userInput, sessionId) {
  const updates = [];

  const { shouldSave, fact } = shouldRemember(userInput);
  if (shouldSave && fact.length > 4) {
    const summary = await runMemorySummarizer(fact);
    if (summary && typeof summary === "object" && summary.text && summary.text.length > 4) {
      await longTerm.addFact(summary);
      updates.push(`💾 Stored: ${summary.text}`);
    }
  }

  const { shouldDelete, fact: forgetFact } = shouldForget(userInput);
  if (shouldDelete && forgetFact.length > 4) {
    await longTerm.deleteFact(forgetFact);
    updates.push(`🗑 Removed: ${forgetFact}`);
  }

  return updates;
}

async function saveShortTerm(sessionId, messageHistory) {
  await shortTerm.saveMemory(sessionId, messageHistory);
}

async function manuallySaveFact(rawFact) {
  await longTerm.addFact(rawFact);
}

async function manuallyForgetFact(rawFact) {
  await longTerm.deleteFact(rawFact);
}

module.exports = {
  getAllMemory,
  getRelevantFacts,
  searchUnified,
  processUserMessage,
  saveShortTerm,
  manuallySaveFact,
  manuallyForgetFact,
};
