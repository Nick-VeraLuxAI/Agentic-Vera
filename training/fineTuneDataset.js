const fs = require("fs");
const path = require("path");

const DEFAULT_SESSIONS_DIR = process.env.VERA_SESSIONS_DIR || path.join(__dirname, "..", "memory", "sessions");
const APPROVED_FILE = process.env.VERA_FINETUNE_APPROVED_FILE || path.join(__dirname, "approved_sessions.txt");
const OUTPUT_FILE = process.env.VERA_FINETUNE_DATASET_FILE || path.join(__dirname, "dataset.jsonl");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readApprovedSessionIds(filePath = APPROVED_FILE) {
  if (!fs.existsSync(filePath)) return new Set();
  const ids = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return new Set(ids);
}

function listSessionFiles(sessionsDir = DEFAULT_SESSIONS_DIR) {
  ensureDir(sessionsDir);
  return fs
    .readdirSync(sessionsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ sessionId: name.replace(/\.json$/, ""), fullPath: path.join(sessionsDir, name) }));
}

function buildExamplesFromMessages(messages, sessionId) {
  const examples = [];
  for (let i = 0; i < messages.length - 1; i += 1) {
    const a = messages[i];
    const b = messages[i + 1];
    if (a?.role !== "user" || b?.role !== "assistant") continue;
    const prompt = String(a.content || "").trim();
    const completion = String(b.content || "").trim();
    if (prompt.length < 3 || completion.length < 3) continue;
    examples.push({
      sessionId,
      prompt,
      completion,
      createdAt: Date.now(),
    });
  }
  return examples;
}

function buildDataset(options = {}) {
  const sessionsDir = options.sessionsDir || DEFAULT_SESSIONS_DIR;
  const approvedOnly = options.approvedOnly !== false;
  const approvedIds = options.approvedIds || readApprovedSessionIds(options.approvedFile || APPROVED_FILE);
  const maxExamples = Number(options.maxExamples || 5000);

  const examples = [];
  const sessionFiles = listSessionFiles(sessionsDir);
  for (const entry of sessionFiles) {
    if (approvedOnly && !approvedIds.has(entry.sessionId)) continue;
    let messages = [];
    try {
      messages = JSON.parse(fs.readFileSync(entry.fullPath, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(messages)) continue;
    examples.push(...buildExamplesFromMessages(messages, entry.sessionId));
    if (examples.length >= maxExamples) break;
  }
  return examples.slice(0, maxExamples);
}

function writeDatasetJsonl(examples, outputFile = OUTPUT_FILE) {
  ensureDir(path.dirname(outputFile));
  const payload = examples
    .map((row) =>
      JSON.stringify({
        instruction: row.prompt,
        output: row.completion,
        sessionId: row.sessionId,
      })
    )
    .join("\n");
  fs.writeFileSync(outputFile, payload + (payload ? "\n" : ""), "utf8");
  return outputFile;
}

function addApprovedSession(sessionId, filePath = APPROVED_FILE) {
  const safe = String(sessionId || "").trim();
  if (!safe) throw new Error("Session id is required.");
  ensureDir(path.dirname(filePath));
  const ids = readApprovedSessionIds(filePath);
  ids.add(safe);
  fs.writeFileSync(filePath, Array.from(ids).sort().join("\n") + "\n", "utf8");
}

module.exports = {
  buildDataset,
  writeDatasetJsonl,
  addApprovedSession,
  readApprovedSessionIds,
};
