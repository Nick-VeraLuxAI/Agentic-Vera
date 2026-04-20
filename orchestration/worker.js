const taskQueue = require("./taskQueue");
const brain = require("../core/verabrain");
const { runTool } = require("../tools/runner");

const POLL_MS = Number(process.env.VERA_WORKER_POLL_MS || 2000);
const WORKER_ID = process.env.VERA_WORKER_ID || `worker_${process.pid}`;

async function runTask(task) {
  switch (task.type) {
    case "fine_tune_job":
      await taskQueue.addCheckpoint(task.id, { event: "fine_tune_job_received" });
      return {
        ok: true,
        note: "Fine-tune execution scaffold acknowledged. Implement trainer integration to run external job.",
      };
    case "inference": {
      const prompt = String(task.payload?.prompt || "");
      const sessionId = String(task.payload?.sessionId || "worker");
      if (!prompt) throw new Error("Missing prompt in inference payload.");
      const reply = await brain.send(prompt, sessionId, task.payload?.route ? { route: task.payload.route } : {});
      return { ok: true, reply };
    }
    case "tool": {
      const toolName = String(task.payload?.name || task.payload?.tool || "").trim();
      if (!toolName) throw new Error("Missing tool name in tool payload.");
      const result = await runTool(toolName, task.payload?.args || {});
      return { ok: true, result };
    }
    default:
      return {
        ok: true,
        note: `No handler registered for task type '${task.type}'.`,
      };
  }
}

async function processNextTask() {
  const task = await taskQueue.claimNextQueuedTask(WORKER_ID);
  if (!task) return false;

  try {
    await taskQueue.addCheckpoint(task.id, { event: "task_started", workerId: WORKER_ID });
    const result = await runTask(task);
    await taskQueue.updateTask(task.id, {
      status: "completed",
      progress: 100,
      result,
      completedAt: Date.now(),
    });
    await taskQueue.addCheckpoint(task.id, { event: "task_completed", workerId: WORKER_ID });
  } catch (err) {
    await taskQueue.updateTask(task.id, {
      status: "failed",
      error: err.message,
      completedAt: Date.now(),
    });
    await taskQueue.addCheckpoint(task.id, {
      event: "task_failed",
      workerId: WORKER_ID,
      error: err.message,
    });
  }
  return true;
}

function startWorker() {
  const timer = setInterval(async () => {
    try {
      await processNextTask();
    } catch (err) {
      console.error("Task worker loop error:", err.message);
    }
  }, POLL_MS);
  timer.unref?.();
  return timer;
}

module.exports = {
  startWorker,
  processNextTask,
};
