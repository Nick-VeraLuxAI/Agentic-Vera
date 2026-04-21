const retrievalMemory = require("./retrievalMemory");

const ENABLED = String(process.env.VERA_OUTCOME_LESSONS_TO_RAG || "false").toLowerCase() === "true";

/**
 * Persist verified-success patterns into retrieval so future runs can match similar goals.
 */
async function recordVerifiedOutcome({ goal, lastReply, verification, runId, sessionId = "global_lessons" }) {
  if (!ENABLED || !verification || verification.satisfied !== true) return null;
  const lesson = [
    `Verified outcome lesson (run ${runId || "?"})`,
    `Goal: ${String(goal || "").slice(0, 2000)}`,
    verification.reason ? `Verifier: ${String(verification.reason).slice(0, 1500)}` : "",
    lastReply ? `Agent output excerpt: ${String(lastReply).slice(0, 2500)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    return await retrievalMemory.addDocuments(sessionId, "outcome-verifier", lesson, {
      type: "verified_outcome",
      runId: runId || null,
    });
  } catch (err) {
    console.warn("outcomeLearning: index failed:", err.message);
    return null;
  }
}

module.exports = {
  recordVerifiedOutcome,
  ENABLED,
};
