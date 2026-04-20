const fs = require("fs");
const path = require("path");
const { ensureDirSync, atomicWriteJsonSync, readJsonSafeSync, withMemoryLock } = require("./storage");

const MEMORY_DIR = process.env.VERA_SESSIONS_DIR || path.join(__dirname, "sessions");
ensureDirSync(MEMORY_DIR);

function sanitizeSessionId(sessionId = "default") {
  const value = String(sessionId || "default").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    throw new Error("Invalid session ID format.");
  }
  return value;
}

function buildSessionFilePath(sessionId = "default") {
  const safeSessionId = sanitizeSessionId(sessionId);
  const file = path.resolve(MEMORY_DIR, `${safeSessionId}.json`);
  const root = path.resolve(MEMORY_DIR) + path.sep;
  if (!file.startsWith(root)) {
    throw new Error("Unsafe session path.");
  }
  return file;
}

function loadMemory(sessionId = "default") {
  const file = buildSessionFilePath(sessionId);
  return readJsonSafeSync(file, []);
}

async function saveMemory(sessionId = "default", memory) {
  const file = buildSessionFilePath(sessionId);
  await withMemoryLock(async () => {
    atomicWriteJsonSync(file, memory);
  });
}

module.exports = { loadMemory, saveMemory };
