const brain = require("./verabrain");
const { runTool } = require("../tools/runner");
const { verifyAgentOutcome } = require("./outcomeVerifier");
const { runLocalModel } = require("../tools/localInfer");
const { buildPolicy, createBudgetTracker } = require("./agentPolicy");
const { verifyStepProgrammatic, verifySuccessCriteriaStrings } = require("./verificationLadder");
const { extractStructuredPayload, shouldUseStructuredMode } = require("./structuredPlan");
const { synthesizeStructuredPlan } = require("./planSynthesis");
const { getRoleBlock } = require("./multiAgentRoles");
const { normalizeInteractionMode } = require("./chatMode");
const { ApprovalPauseError } = require("./agentErrors");
const agentState = require("../memory/agentState");
const agentTrace = require("../memory/agentTrace");
const agentEpisodes = require("../memory/agentEpisodes");
const agentCoordination = require("../memory/agentCoordination");
const outcomeLearning = require("../memory/outcomeLearning");
const { withTimeout } = require("./promiseTimeout");

const DEFAULT_ALLOWED = [
  "search_tool",
  "summary_tool",
  "local_infer",
  "workspace_read",
  "workspace_list",
  "eval_arithmetic",
  "system_info",
  "coordination_post",
];
const STEP_TIMEOUT_MS = Number(process.env.VERA_AGENT_STEP_TIMEOUT_MS || 300000);
const MAX_STEPS_CAP = Math.min(128, Math.max(1, Number(process.env.VERA_AGENT_MAX_STEPS || 32)));

function makeGuardedRunTool(task, budget, execCtx = {}) {
  const allowSandbox = task.payload?.allowSandbox === true;
  const allowHttpFetch = task.payload?.allowHttpFetch === true;
  const approvedSensitive = new Set(
    Array.isArray(task.payload?.approvedSensitiveTools) ? task.payload.approvedSensitiveTools.map(String) : []
  );
  const allowedList = Array.isArray(task.payload?.allowedTools) ? task.payload.allowedTools : DEFAULT_ALLOWED;
  const allowed = new Set(allowedList);
  const runId = execCtx.runId;
  const taskId = execCtx.taskId;

  return async function guardedRunTool(name, args = {}, ctx = {}) {
    const toolName = String(name || "").trim();
    if (!allowed.has(toolName)) {
      return { ok: false, error: `Tool '${toolName}' is not allowed for this agent run.` };
    }
    if (toolName === "code_sandbox" && !allowSandbox && !approvedSensitive.has("code_sandbox")) {
      return {
        ok: false,
        error: "code_sandbox requires allowSandbox: true or approvedSensitiveTools: ['code_sandbox'].",
      };
    }
    if (toolName === "http_fetch" && !allowHttpFetch && !approvedSensitive.has("http_fetch")) {
      return {
        ok: false,
        error: "http_fetch requires allowHttpFetch: true or approvedSensitiveTools: ['http_fetch'].",
      };
    }
    const budgetCheck = budget.beforeTool(toolName);
    if (!budgetCheck.ok) return budgetCheck;

    const merged = {
      ...ctx,
      runId: ctx.runId || runId,
      taskId: ctx.taskId || taskId,
      requireHumanApproval: task.payload?.requireHumanApproval === true,
    };
    const result = await runTool(toolName, args, merged);
    if (result && result.approvalRequired === true) {
      throw new ApprovalPauseError(result.approvalId, result.message || "Approval required.");
    }
    return result;
  };
}

function resolveRunRoute(prompt, task, stepRole) {
  if (typeof brain.getModelRoute !== "function") return null;
  const rb = getRoleBlock(stepRole || task.payload?.agentRole);
  const preferred = task.payload?.preferredRoute || rb.routeHint || undefined;
  return brain.getModelRoute(prompt, {
    preferredRoute: preferred,
    metadata: task.payload?.routingMetadata || {},
  });
}

function buildSendOptions(task, goal, route, extra = {}) {
  const mode = normalizeInteractionMode(task.payload?.interactionMode || "agent");
  return {
    runToolImpl: extra.guarded,
    toolLoopMaxMs: Number(process.env.VERA_AGENT_TOOL_LOOP_MAX_MS || 180000),
    agentGoal: goal,
    agentPlan: task.payload?.plan ? JSON.stringify(task.payload.plan) : undefined,
    route,
    interactionMode: mode,
    agentRole: extra.stepRole || task.payload?.agentRole,
    coordinationId: task.payload?.coordinationId ? String(task.payload.coordinationId) : undefined,
    toolCtx: {
      runId: extra.runId,
      taskId: extra.taskId || task.id,
      requireHumanApproval: task.payload?.requireHumanApproval === true,
      coordinationId: task.payload?.coordinationId ? String(task.payload.coordinationId) : undefined,
    },
    metadata: {
      preferredRoute: task.payload?.preferredRoute,
      ...(task.payload?.routingMetadata && typeof task.payload.routingMetadata === "object"
        ? task.payload.routingMetadata
        : {}),
    },
  };
}

async function finalizeVerificationAndStatus({
  goal,
  lastReply,
  successCriteria,
  task,
  completed,
  runId,
  verifyOn,
}) {
  let verification = null;
  if (verifyOn && lastReply) {
    const route = resolveRunRoute(goal, task);
    const modelPath = task.payload?.verifierModelPath || task.payload?.modelPath || route?.modelPath;
    try {
      verification = await verifyAgentOutcome(
        {
          goal,
          lastReply,
          successCriteria: Array.isArray(successCriteria) ? successCriteria : [],
          modelPath,
        },
        runLocalModel
      );
    } catch (e) {
      verification = { ok: false, error: e.message || String(e), satisfied: false };
    }
    await agentTrace.appendEvent(runId, { event: "outcome_verification", verification });
  }

  let outcomeStatus = completed ? "completed" : "max_steps";
  if (verifyOn && verification) {
    if (completed && verification.ok && verification.satisfied === false) {
      outcomeStatus = "verifier_rejected";
    } else if (completed && (!verification.ok || verification.satisfied == null)) {
      outcomeStatus = "completed_unverified";
    }
  }
  return { verification, outcomeStatus };
}

async function saveStepCheckpoint(runId, data) {
  await agentTrace.saveCheckpoint(runId, { ts: Date.now(), ...data });
}

async function runTurnLoop({
  task,
  runId,
  sessionId,
  goal,
  maxSteps,
  successCriteria,
  guarded,
  verifyOn,
  resume,
}) {
  let lastReply = "";
  let completed = false;
  let startStep = 0;
  if (resume && resume.mode === "turns" && Number.isFinite(resume.step)) {
    startStep = Math.max(0, Number(resume.step));
  }

  for (let step = startStep; step < maxSteps; step += 1) {
    await agentTrace.appendEvent(runId, { event: "step_begin", step, mode: "turns" });
    const userMessage =
      step === 0
        ? goal
        : `Continue toward the goal (step ${step + 1} of ${maxSteps}). Use tools if needed. Output [AGENT_DONE] on a line when the goal is fully satisfied.`;

    const route = resolveRunRoute(userMessage, task);

    let reply;
    try {
      reply = await withTimeout(
        brain.send(userMessage, sessionId, {
          ...buildSendOptions(task, goal, route, { guarded, runId, taskId: task.id }),
        }),
        Number(task.payload?.stepTimeoutMs || STEP_TIMEOUT_MS),
        `agent_run step ${step}`
      );
    } catch (e) {
      if (e instanceof ApprovalPauseError) {
        await saveStepCheckpoint(runId, {
          mode: "turns",
          step,
          goal,
          awaitingApprovalId: e.approvalId,
        });
        return {
          lastReply: lastReply || "",
          completed: false,
          verification: null,
          outcomeStatus: "awaiting_approval",
          failedStep: undefined,
          awaitingApprovalId: e.approvalId,
        };
      }
      throw e;
    }

    lastReply = reply;
    await agentTrace.appendEvent(runId, { event: "step_reply", step, reply: reply.slice(0, 8000) });

    const cid = task.payload?.coordinationId ? String(task.payload.coordinationId) : "";
    if (cid) {
      agentCoordination.appendMessage(
        cid,
        task.payload?.agentRole || "agent",
        "all",
        runId,
        `Turn ${step + 1} output: ${reply.slice(0, 2000)}`
      );
    }

    const episode = agentEpisodes.extractEpisodeFromReply(reply);
    if (episode) {
      await agentEpisodes.recordEpisode(runId, step, episode, "lesson");
    }

    await saveStepCheckpoint(runId, {
      mode: "turns",
      step: step + 1,
      goal,
      lastReplySnippet: reply.slice(0, 2000),
    });

    if (String(reply).includes("[AGENT_DONE]")) {
      completed = true;
      break;
    }
  }

  const { verification, outcomeStatus } = await finalizeVerificationAndStatus({
    goal,
    lastReply,
    successCriteria,
    task,
    completed,
    runId,
    verifyOn,
  });

  return {
    lastReply,
    completed,
    verification,
    outcomeStatus,
    failedStep: undefined,
    awaitingApprovalId: undefined,
  };
}

async function runStructuredLoop({
  task,
  runId,
  sessionId,
  goal,
  maxSteps,
  successCriteria,
  guarded,
  verifyOn,
  structured,
  resume,
}) {
  const plan = structured.plan;
  const steps = plan.steps;
  const limit = Math.min(steps.length, maxSteps);
  let lastReply = "";
  let failedStep = null;

  let cumulative = (resume && resume.cumulative) || (resume && resume.cumulativeSnippet) || "";
  let startIdx = 0;
  if (resume && resume.mode === "structured" && Number.isFinite(resume.nextStepIndex)) {
    startIdx = Math.min(limit, Math.max(0, Number(resume.nextStepIndex)));
  }

  for (let i = startIdx; i < limit; i += 1) {
    const step = steps[i];
    const maxTry = Math.max(1, 1 + (step.maxRetries || 1));

    await agentTrace.appendEvent(runId, { event: "structured_step_begin", stepIndex: i, stepId: step.id });

    let reply = "";
    let stepSuccess = false;

    for (let attempt = 1; attempt <= maxTry; attempt += 1) {
      const userMessage = [
        `Structured agent step ${i + 1} of ${limit} (id: ${step.id})`,
        `Overall goal: ${goal}`,
        step.objective ? `Step objective: ${step.objective}` : "",
        cumulative ? `Progress so far:\n${cumulative.slice(0, 6000)}` : "",
        "When this step is satisfied, include [STEP_DONE] on its own line.",
        "If the step is impossible, include [STEP_BLOCKED]: <reason> on its own line.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const route = resolveRunRoute(userMessage, task, step.role);

      try {
        reply = await withTimeout(
          brain.send(userMessage, sessionId, {
            ...buildSendOptions(task, goal, route, {
              guarded,
              runId,
              taskId: task.id || task.payload?.taskId,
              stepRole: step.role,
            }),
            agentPlan: JSON.stringify({ structured: true, step: step.id, objective: step.objective }),
          }),
          Number(task.payload?.stepTimeoutMs || STEP_TIMEOUT_MS),
          `structured step ${i} attempt ${attempt}`
        );
      } catch (e) {
        if (e instanceof ApprovalPauseError) {
          await saveStepCheckpoint(runId, {
            mode: "structured",
            nextStepIndex: i,
            cumulative,
            goal,
            awaitingApprovalId: e.approvalId,
          });
          return {
            lastReply: lastReply || "",
            completed: false,
            verification: null,
            outcomeStatus: "awaiting_approval",
            failedStep: undefined,
            awaitingApprovalId: e.approvalId,
          };
        }
        throw e;
      }

      lastReply = reply;

      if (String(reply).includes("[STEP_BLOCKED]")) {
        failedStep = { index: i, id: step.id, reason: "blocked" };
        stepSuccess = false;
        break;
      }

      const prog = verifyStepProgrammatic(step, reply);
      if (!prog.ok) {
        if (attempt === maxTry) {
          failedStep = { index: i, id: step.id, reason: prog.reason || "programmatic_check_failed" };
        }
        continue;
      }

      if (String(reply).includes("[STEP_DONE]")) {
        stepSuccess = true;
        cumulative += `\n\n--- Step ${step.id} ---\n${reply.slice(0, 4000)}`;
        break;
      }

      if (attempt === maxTry) {
        failedStep = { index: i, id: step.id, reason: "missing_step_done_marker" };
      }
    }

    const episode = agentEpisodes.extractEpisodeFromReply(reply);
    if (episode) {
      await agentEpisodes.recordEpisode(runId, i, episode, "lesson");
    }

    await agentTrace.appendEvent(runId, {
      event: "structured_step_reply",
      stepIndex: i,
      stepId: step.id,
      reply: reply.slice(0, 8000),
      stepSuccess,
    });

    await saveStepCheckpoint(runId, {
      mode: "structured",
      stepIndex: i,
      nextStepIndex: stepSuccess ? i + 1 : i,
      goal,
      cumulativeSnippet: cumulative.slice(0, 4000),
      cumulative,
    });

    const coordStr = task.payload?.coordinationId ? String(task.payload.coordinationId) : "";
    if (coordStr && stepSuccess) {
      agentCoordination.appendMessage(
        coordStr,
        step.role || task.payload?.agentRole || "agent",
        "all",
        runId,
        `Structured step ${step.id}: ${reply.slice(0, 2000)}`
      );
    }

    if (!stepSuccess) {
      break;
    }
  }

  const allStepsOk = !failedStep && limit > 0;
  const criteriaOk = verifySuccessCriteriaStrings(successCriteria, lastReply);
  if (!criteriaOk.ok) {
    await agentTrace.appendEvent(runId, { event: "criteria_check_failed", reason: criteriaOk.reason });
  }

  const runCompleted = allStepsOk && criteriaOk.ok;

  const { verification, outcomeStatus: baseOutcome } = await finalizeVerificationAndStatus({
    goal,
    lastReply,
    successCriteria,
    task,
    completed: runCompleted,
    runId,
    verifyOn,
  });

  let outcomeStatus = baseOutcome;
  if (failedStep) {
    outcomeStatus = "step_failed";
  } else if (!criteriaOk.ok) {
    outcomeStatus = "criteria_failed";
  }

  return {
    lastReply,
    completed: runCompleted,
    verification,
    outcomeStatus,
    failedStep,
    awaitingApprovalId: undefined,
  };
}

async function runAgentExecution(task) {
  const goal = String(task.payload?.goal || "").trim();
  if (!goal) throw new Error("agent_run requires payload.goal.");

  const sessionId = String(task.payload?.sessionId || "worker_agent");
  let effectivePayload = { ...(task.payload || {}) };
  const maxSteps = Math.min(MAX_STEPS_CAP, Math.max(1, Number(effectivePayload.maxSteps || 8)));
  const taskId = task.id;
  const successCriteria = effectivePayload.successCriteria || effectivePayload.acceptanceCriteria || [];
  const verifyOn = String(process.env.VERA_AGENT_OUTCOME_VERIFY || "true").toLowerCase() !== "false";

  if (effectivePayload.synthesizePlan === true && !shouldUseStructuredMode(effectivePayload)) {
    const route = resolveRunRoute(goal, { payload: effectivePayload });
    const syn = await synthesizeStructuredPlan(goal, { modelPath: route?.modelPath });
    if (syn.ok) {
      effectivePayload.executionMode = "structured";
      effectivePayload.structuredPlan = {
        version: syn.plan.version,
        goal: syn.plan.goal,
        steps: syn.plan.steps,
      };
    }
  }

  let resume = null;
  if (effectivePayload.resumeRunId) {
    resume = agentTrace.getCheckpoint(effectivePayload.resumeRunId);
  }

  let coordinationId = effectivePayload.coordinationId ? String(effectivePayload.coordinationId).trim() : "";
  if (effectivePayload.createCoordination === true && !coordinationId) {
    coordinationId = agentCoordination.createSession(goal);
  }
  if (coordinationId) {
    effectivePayload.coordinationId = coordinationId;
  }

  const taskView = { ...task, payload: effectivePayload };
  const policy = buildPolicy(taskView);
  const budget = createBudgetTracker(policy);
  const runId = agentTrace.startRun({ taskId, sessionId });
  const guarded = makeGuardedRunTool(taskView, budget, { runId, taskId });

  if (coordinationId) {
    await agentTrace.appendEvent(runId, { event: "coordination_session", coordinationId });
    agentCoordination.appendMessage(
      coordinationId,
      "system",
      "all",
      runId,
      `Agent run started (task ${taskId}). Goal: ${goal.slice(0, 900)}`
    );
  }

  await agentTrace.appendEvent(runId, { event: "run_started", goal, maxSteps, policy: JSON.parse(JSON.stringify(policy)) });
  if (effectivePayload.synthesizePlan && effectivePayload.structuredPlan) {
    await agentTrace.appendEvent(runId, { event: "plan_synthesized", steps: effectivePayload.structuredPlan?.steps?.length });
  }
  if (resume) {
    await agentTrace.appendEvent(runId, { event: "resume_from_checkpoint", previousRunId: effectivePayload.resumeRunId });
  }

  const planJsonForState = effectivePayload.plan
    ? JSON.stringify(effectivePayload.plan)
    : effectivePayload.structuredPlan
      ? JSON.stringify(effectivePayload.structuredPlan)
      : "";

  await agentState.upsertSessionState(sessionId, {
    goal_text: goal,
    plan_json: planJsonForState,
    status: "running",
    step_index: 0,
  });

  try {
    let result;

    if (shouldUseStructuredMode(effectivePayload)) {
      const parsed = extractStructuredPayload(effectivePayload);
      if (!parsed.ok) {
        throw new Error(parsed.error || "Invalid structured plan.");
      }
      result = await runStructuredLoop({
        task: taskView,
        runId,
        sessionId,
        goal,
        maxSteps,
        successCriteria,
        guarded,
        verifyOn,
        structured: parsed,
        resume,
      });
    } else {
      result = await runTurnLoop({
        task: taskView,
        runId,
        sessionId,
        goal,
        maxSteps,
        successCriteria,
        guarded,
        verifyOn,
        resume,
      });
    }

    const { lastReply, completed, verification, outcomeStatus, failedStep, awaitingApprovalId } = result;

    try {
      await outcomeLearning.recordVerifiedOutcome({
        goal,
        lastReply,
        verification: result.verification,
        runId,
        sessionId,
      });
    } catch (_e) {
      /* non-fatal */
    }

    await agentState.upsertSessionState(sessionId, {
      status: outcomeStatus,
      step_index: maxSteps,
    });

    await agentTrace.appendEvent(runId, {
      event: "run_finished",
      completed,
      outcomeStatus,
      lastReply: lastReply.slice(0, 2000),
      budget: budget.snapshot(),
      failedStep: failedStep || undefined,
      awaitingApprovalId: awaitingApprovalId || undefined,
    });
    await agentTrace.completeRun(runId, outcomeStatus);

    return {
      ok: true,
      runId,
      sessionId,
      completed,
      outcomeStatus,
      verification,
      failedStep: failedStep || undefined,
      awaitingApprovalId: awaitingApprovalId || undefined,
      lastReply: lastReply.slice(0, 4000),
      budget: budget.snapshot(),
    };
  } catch (err) {
    await agentTrace.completeRun(runId, "failed", err.message);
    await agentState.upsertSessionState(sessionId, { status: "failed" });
    throw err;
  }
}

module.exports = {
  runAgentExecution,
  makeGuardedRunTool,
  resolveRunRoute,
};
