const taskQueue = require("./taskQueue");
const scheduleStore = require("../memory/scheduleStore");

/**
 * Poll due schedules and enqueue tasks (enable with VERA_SCHEDULER_ENABLED=true).
 */
function startScheduler() {
  if (String(process.env.VERA_SCHEDULER_ENABLED || "").toLowerCase() !== "true") {
    return null;
  }
  const pollMs = Math.max(5000, Number(process.env.VERA_SCHEDULER_POLL_MS || 30000));
  const timer = setInterval(async () => {
    try {
      const due = scheduleStore.getDueSchedules(Date.now());
      for (const s of due) {
        let payload = {};
        try {
          payload = JSON.parse(s.payload_json || "{}");
        } catch (_e) {
          payload = {};
        }
        await taskQueue.enqueueTask(s.task_type, payload);
        await scheduleStore.bumpNextRun(s.id, s.interval_ms);
      }
    } catch (err) {
      console.error("Scheduler tick error:", err.message);
    }
  }, pollMs);
  timer.unref?.();
  return timer;
}

module.exports = { startScheduler };
