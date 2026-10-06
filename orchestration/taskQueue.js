const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ensureDirSync, atomicWriteJsonSync, readJsonSafeSync, withMemoryLock } = require("../memory/storage");

const TASK_QUEUE_FILE = process.env.VERA_TASK_QUEUE_FILE || path.join(__dirname, "tasks.json");

function ensureQueueFile() {
  ensureDirSync(path.dirname(TASK_QUEUE_FILE));
  if (!fs.existsSync(TASK_QUEUE_FILE)) {
    atomicWriteJsonSync(TASK_QUEUE_FILE, { tasks: [], idempotencyIndex: {} });
  }
}

function loadState() {
  ensureQueueFile();
  const state = readJsonSafeSync(TASK_QUEUE_FILE, { tasks: [] });
  if (!state || typeof state !== "object" || !Array.isArray(state.tasks)) {
    return { tasks: [], idempotencyIndex: {} };
  }
  if (!state.idempotencyIndex || typeof state.idempotencyIndex !== "object") {
    state.idempotencyIndex = {};
  }
  return state;
}

function saveState(state) {
  atomicWriteJsonSync(TASK_QUEUE_FILE, state);
}

function hashIdempotencyKey(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex");
}

async function enqueueTask(type, payload = {}, options = {}) {
  return withMemoryLock(async () => {
    const state = loadState();
    const rawKey = options.idempotencyKey != null ? String(options.idempotencyKey).trim() : "";
    if (rawKey) {
      const h = hashIdempotencyKey(rawKey);
      const existingId = state.idempotencyIndex[h];
      if (existingId) {
        const existing = state.tasks.find((t) => t.id === existingId);
        if (existing) return existingId;
      }
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    state.tasks.push({
      id,
      type: String(type || "generic"),
      payload,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      checkpoints: [],
      attempts: 0,
    });
    if (rawKey) {
      state.idempotencyIndex[hashIdempotencyKey(rawKey)] = id;
    }
    saveState(state);
    return id;
  });
}

async function updateTask(id, patch = {}) {
  return withMemoryLock(async () => {
    const state = loadState();
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return false;
    Object.assign(task, patch, { updatedAt: Date.now() });
    saveState(state);
    return true;
  });
}

async function addCheckpoint(id, checkpoint) {
  return withMemoryLock(async () => {
    const state = loadState();
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return false;
    task.checkpoints = task.checkpoints || [];
    task.checkpoints.push({
      ts: new Date().toISOString(),
      ...checkpoint,
    });
    task.updatedAt = Date.now();
    saveState(state);
    return true;
  });
}

async function claimNextQueuedTask(workerId = `worker_${process.pid}`) {
  return withMemoryLock(async () => {
    const state = loadState();
    const nextTask = state.tasks
      .filter((task) => task.status === "queued")
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!nextTask) return null;
    nextTask.status = "running";
    nextTask.progress = Math.max(Number(nextTask.progress || 0), 1);
    nextTask.workerId = workerId;
    nextTask.startedAt = nextTask.startedAt || Date.now();
    nextTask.updatedAt = Date.now();
    nextTask.checkpoints = nextTask.checkpoints || [];
    nextTask.checkpoints.push({
      ts: new Date().toISOString(),
      event: "task_claimed",
      workerId,
    });
    saveState(state);
    return { ...nextTask };
  });
}

function getTask(id) {
  const state = loadState();
  return state.tasks.find((t) => t.id === id) || null;
}

function listTasks(limit = 50, filter = {}) {
  const state = loadState();
  let tasks = state.tasks.slice();
  if (filter.status) {
    tasks = tasks.filter((t) => t.status === filter.status);
  }
  return tasks.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

function listDeadLetterTasks(limit = 50) {
  return listTasks(limit, { status: "dead_letter" });
}

function countsByStatus() {
  const state = loadState();
  const c = { queued: 0, running: 0, completed: 0, dead_letter: 0 };
  for (const t of state.tasks) {
    const s = t.status || "unknown";
    c[s] = (c[s] || 0) + 1;
  }
  return c;
}

module.exports = {
  enqueueTask,
  updateTask,
  addCheckpoint,
  claimNextQueuedTask,
  getTask,
  listTasks,
  listDeadLetterTasks,
  countsByStatus,
  hashIdempotencyKey,
};
