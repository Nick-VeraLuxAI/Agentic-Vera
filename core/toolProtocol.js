/**
 * Parse and strip structured tool-call payloads from model output.
 */

function normalizeCall(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim();
  if (!name) return null;
  const args = raw.arguments ?? raw.args ?? {};
  return { name, arguments: typeof args === "object" && args !== null ? args : {} };
}

function parseToolCalls(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const matches = [];

  const tagged = raw.match(/\[TOOL_CALL\]([\s\S]*?)\[\/TOOL_CALL\]/gi) || [];
  for (const block of tagged) {
    const payload = block.replace(/\[TOOL_CALL\]|\[\/TOOL_CALL\]/gi, "").trim();
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.tool_calls)) {
          for (const c of parsed.tool_calls) {
            const n = normalizeCall(c);
            if (n) matches.push(n);
          }
        } else {
          const n = normalizeCall(parsed);
          if (n) matches.push(n);
        }
      }
    } catch (_err) {
      /* ignore */
    }
  }

  if (matches.length) return matches;

  const fence =
    raw.match(/```(?:json)?\s*([\s\S]*?)```/im) ||
    raw.match(/```\s*([\s\S]*?)```/im);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1].trim());
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.tool_calls)) {
          return parsed.tool_calls.map(normalizeCall).filter(Boolean);
        }
        const n = normalizeCall(parsed);
        if (n) return [n];
      }
    } catch (_err) {
      /* ignore */
    }
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.tool_calls)) {
      return parsed.tool_calls.map(normalizeCall).filter(Boolean);
    }
    const n = normalizeCall(parsed);
    if (n) return [n];
  } catch (_err) {
    /* ignore */
  }

  return [];
}

function stripToolMarkers(text) {
  let out = String(text || "");
  out = out.replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/gi, "").trim();
  out = out.replace(/```(?:json)?\s*[\s\S]*?```/gim, "").trim();
  return out;
}

module.exports = {
  parseToolCalls,
  stripToolMarkers,
  normalizeCall,
};
