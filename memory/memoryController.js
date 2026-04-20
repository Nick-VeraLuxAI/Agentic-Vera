const shortTerm = require("./shortTermMemory");
const longTerm = require("./longTermMemory");
const { shouldRemember, shouldForget } = require("./memoryDecider");
const { runMemorySummarizer } = require("./memorySummarizer");

// Get both short- and long-term memory for a session
async function getAllMemory(sessionId) {
  return {
    shortTerm: await shortTerm.loadMemory(sessionId),
    longTerm: longTerm.getFacts()
  };
}

// Get only relevant long-term facts for a given input
async function getRelevantFacts(userInput) {
  const facts = longTerm.getFacts();
  const lowered = userInput.toLowerCase();
  return facts.filter(f =>
    lowered.includes(f.subject?.toLowerCase() || "") ||
    lowered.includes(f.original?.toLowerCase() || "")
  );
}

// Process a user message for memory logic
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

// Save short-term memory
async function saveShortTerm(sessionId, messageHistory) {
  await shortTerm.saveMemory(sessionId, messageHistory);
}

// Manual [MEMORY: ...] tag from user or AI
async function manuallySaveFact(rawFact) {
  await longTerm.addFact(rawFact);
}

// Manual [FORGET: ...] tag from user or AI
async function manuallyForgetFact(rawFact) {
  await longTerm.deleteFact(rawFact);
}

// ✅ Correct export
module.exports = {
  getAllMemory,
  getRelevantFacts,
  processUserMessage,
  saveShortTerm,
  manuallySaveFact,
  manuallyForgetFact
};
