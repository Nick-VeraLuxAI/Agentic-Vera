const { runAgentExecution, makeGuardedRunTool } = require("./agentRunExecutor");

/**
 * Multi-step background agent: orchestrated in agentRunExecutor (turn-based vs structured plans,
 * policy budgets, verification ladder, checkpoints, episodic lessons).
 */
async function runAgentRunTask(task) {
  return runAgentExecution(task);
}

module.exports = {
  runAgentRunTask,
  makeGuardedRunTool,
};
