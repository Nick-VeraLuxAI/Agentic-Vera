const fs = require("fs");
const path = require("path");
const { runMemorySummarizer } = require("./memorySummarizer");
const { ensureDirSync, atomicWriteJsonSync, readJsonSafeSync, withMemoryLock } = require("./storage");

const FILE_PATH = process.env.VERA_LONGTERM_FILE || path.join(__dirname, "longterm.json");

function ensureFileExists() {
  ensureDirSync(path.dirname(FILE_PATH));
  if (!fs.existsSync(FILE_PATH)) {
    atomicWriteJsonSync(FILE_PATH, []);
  }
}

function getFacts() {
  ensureFileExists();
  const raw = readJsonSafeSync(FILE_PATH, []);
  return Array.isArray(raw) ? raw : [];
}

function parseKeyValueMemoryBlock(text) {
  const lines = text.split('\n');
  const obj = {};
  for (const line of lines) {
    const [key, ...rest] = line.split(':');
    if (!key || !rest.length) continue;
    obj[key.trim().toLowerCase()] = rest.join(':').trim();
  }
  if (obj.confidence) obj.confidence = parseFloat(obj.confidence);
  return obj;
}

function normalize(factObj) {
  if (!factObj || typeof factObj !== "object") return "";
  return [
    factObj.subject || "",
    factObj.sentiment || "",
    factObj.type || ""
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.,!?;:]+$/, "")
    .replace(/\b(the user|user)\b/g, "")
    .replace(/\b(likes|loves|enjoys|prefers|doesn't like|does not like|dislikes|hates)\b/g, "")
    .trim();
}

async function addFact(rawInput) {
  return withMemoryLock(async () => {
    const facts = getFacts();
    const summarizedInput =
      rawInput && typeof rawInput === "object" && rawInput.text
        ? rawInput
        : await runMemorySummarizer(rawInput);
    const summarized = typeof summarizedInput === "string"
      ? parseKeyValueMemoryBlock(summarizedInput)
      : summarizedInput;

    if (!summarized || typeof summarized !== "object" || !summarized.text) {
      console.log("⚠️ Skipping invalid summary:", summarized);
      return;
    }

    const newNorm = normalize(summarized);
    const updated = facts.filter(f => normalize(f) !== newNorm);

    if (updated.length !== facts.length) {
      console.log("❌ Replaced conflicting or duplicate fact.");
    }

    updated.push(summarized);
    atomicWriteJsonSync(FILE_PATH, updated);
    console.log("💾 Saved structured fact:", summarized.text);
  });
}

async function deleteFact(rawInput) {
  return withMemoryLock(async () => {
    const facts = getFacts();
    const summarizedInput =
      rawInput && typeof rawInput === "object" && rawInput.text
        ? rawInput
        : await runMemorySummarizer(rawInput);
    const summarized = typeof summarizedInput === "string"
      ? parseKeyValueMemoryBlock(summarizedInput)
      : summarizedInput;

    if (!summarized || typeof summarized !== "object" || !summarized.text) return false;

    const targetNorm = normalize(summarized);
    const updated = facts.filter(f => normalize(f) !== targetNorm);

    atomicWriteJsonSync(FILE_PATH, updated);
    console.log("🧹 Deleted fact if matched:", summarized.text);

    return facts.length !== updated.length;
  });
}

function clearFacts() {
  atomicWriteJsonSync(FILE_PATH, []);
}

module.exports = {
  getFacts,
  addFact,
  deleteFact,
  clearFacts,
};
