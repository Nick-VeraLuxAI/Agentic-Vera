const taskQueue = require("./taskQueue");
const brain = require("../core/verabrain");
const { runTool } = require("../tools/runner");
const { runAgentRunTask } = require("../core/agentRunner");
const { bumpTaskOutcome } = require("../lib/opsMetrics");

const POLL_MS = Number(process.env.VERA_WORKER_POLL_MS || 2000);
const WORKER_ID = process.env.VERA_WORKER_ID || `worker_${process.pid}`;
const MAX_TASK_ATTEMPTS = Math.max(1, Number(process.env.VERA_TASK_MAX_ATTEMPTS || 3));

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
      const result = await runTool(toolName, task.payload?.args || {}, {});
      return { ok: true, result };
    }
    case "agent_run":
    case "agent_run_resume": {
      return runAgentRunTask(task);
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
    bumpTaskOutcome("completed");
    await taskQueue.addCheckpoint(task.id, { event: "task_completed", workerId: WORKER_ID });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const prev = Number(task.attempts || 0);
    const attempts = prev + 1;
    await taskQueue.addCheckpoint(task.id, {
      event: "task_failed",
      workerId: WORKER_ID,
      error: msg,
      attempt: attempts,
    });
    if (attempts < MAX_TASK_ATTEMPTS) {
      await taskQueue.updateTask(task.id, {
        status: "queued",
        attempts,
        lastError: msg,
        workerId: null,
        progress: 0,
        updatedAt: Date.now(),
      });
    } else {
      await taskQueue.updateTask(task.id, {
        status: "dead_letter",
        attempts,
        error: msg,
        lastError: msg,
        completedAt: Date.now(),
      });
      bumpTaskOutcome("dead_letter");
      await taskQueue.addCheckpoint(task.id, {
        event: "task_dead_letter",
        workerId: WORKER_ID,
        error: msg,
        attempts,
      });
    }
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
