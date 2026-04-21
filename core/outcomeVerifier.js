const { runLocalModel } = require("../tools/localInfer");

/**
 * Second-pass LLM judge: structured JSON outcome check (not sole truth, but strong signal).
 */
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

async function verifyAgentOutcome(
  { goal, lastReply, successCriteria = [], modelPath },
  runInfer = runLocalModel
) {
  const criteriaBlock =
    Array.isArray(successCriteria) && successCriteria.length
      ? `Success criteria (the agent should meet all that apply):\n${successCriteria
          .map((c, i) => `${i + 1}. ${String(c)}`)
          .join("\n")}\n`
      : "";

  const prompt = `You are a strict outcome verifier. Reply with ONE JSON object only, no markdown:
{"satisfied": boolean, "confidence": number between 0 and 1, "reason": string, "unmetCriteria": string[] }

Goal:
${String(goal || "").slice(0, 4000)}

${criteriaBlock}
Agent output (may be partial):
---
${String(lastReply || "").slice(0, 12000)}
---

Set satisfied true only if the goal appears substantially achieved. If success criteria were listed, all must be met for satisfied true.`;

  const raw = await runInfer(prompt, { modelPath, nPredict: 384, temp: 0.1 });
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed.satisfied !== "boolean") {
    return {
      ok: false,
      satisfied: false,
      confidence: 0,
      reason: "Verifier did not return valid JSON.",
      rawVerifierOutput: String(raw).slice(0, 2000),
    };
  }
  return {
    ok: true,
    satisfied: parsed.satisfied,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    reason: String(parsed.reason || ""),
    unmetCriteria: Array.isArray(parsed.unmetCriteria) ? parsed.unmetCriteria : [],
    rawVerifierOutput: String(raw).slice(0, 2000),
  };
}

module.exports = { verifyAgentOutcome, extractJsonObject };
