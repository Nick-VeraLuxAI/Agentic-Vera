const { runLocalModel } = require("../tools/localInfer");
const { parseStructuredPlan } = require("./structuredPlan");

function extractJsonObject(text) {
  const raw = String(text || "");
  const fence = raw.match(/\{[\s\S]*\}/);
  if (!fence) return null;
  try {
    return JSON.parse(fence[0]);
  } catch (_e) {
    return null;
  }
}

/**
 * One-shot LLM call to turn a goal into structuredPlan.steps[].
 */
async function synthesizeStructuredPlan(goal, options = {}) {
  const modelPath = options.modelPath;
  const prompt = `You are a planning engine. Given the user goal, output ONLY valid JSON (no markdown fences) with this shape:
{"version":1,"goal":string,"steps":[{"id":string,"objective":string,"checks"?:{"contains"?:string[]},"maxRetries"?:number}]}
Rules:
- 2–8 steps, each objective actionable in one agent turn.
- Use short ids like s1, s2.
- Optional checks.contains lists substrings that should appear in the step output when satisfied.
- Do not include commentary outside JSON.

Goal:
${String(goal || "").slice(0, 6000)}`;

  const raw = await runLocalModel(prompt, {
    modelPath,
    nPredict: 1024,
    temp: 0.2,
  });
  let parsedObj = extractJsonObject(raw);
  let parsed = parsedObj
    ? parseStructuredPlan(parsedObj)
    : { ok: false, error: "Plan synthesis did not return JSON." };

  if (!parsed.ok) {
    const repairPrompt = `Your previous output was invalid. Output ONLY valid JSON (no markdown) with this exact shape:
{"version":1,"goal":string,"steps":[{"id":string,"objective":string,"checks"?:{"contains"?:string[]},"maxRetries"?:number}]}
Fix the issues: ${parsed.error || "missing or invalid JSON"}
Previous attempt:
${String(raw).slice(0, 3500)}`;

    const raw2 = await runLocalModel(repairPrompt, {
      modelPath,
      nPredict: 1024,
      temp: 0.1,
    });
    parsedObj = extractJsonObject(raw2);
    parsed = parsedObj ? parseStructuredPlan(parsedObj) : { ok: false };
    if (!parsed.ok) {
      return {
        ok: false,
        error: parsed.error || "Invalid synthesized plan after repair.",
        raw: String(raw2).slice(0, 1500),
      };
    }
    return { ok: true, plan: parsed.plan, repaired: true };
  }

  return { ok: true, plan: parsed.plan };
}

module.exports = { synthesizeStructuredPlan };
