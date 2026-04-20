const { addApprovedSession } = require("../training/fineTuneDataset");

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("Usage: node scripts/approve-finetune-session.js <session-id>");
  process.exit(1);
}

try {
  addApprovedSession(sessionId);
  console.log(`Approved session for fine-tuning: ${sessionId}`);
} catch (err) {
  console.error("Failed to approve session:", err.message);
  process.exit(1);
}
