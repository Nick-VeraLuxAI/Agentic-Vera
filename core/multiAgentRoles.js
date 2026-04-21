/**
 * Optional "role" hints (orchestrator / specialist) — map to prompt suffix + route preference.
 */

const ROLE_HINTS = {
  orchestrator: {
    routeHint: "default",
    promptSuffix:
      "Role: **Orchestrator** — coordinate subtasks, delegate clearly, avoid doing everything yourself in one reply.",
  },
  planner: {
    routeHint: "default",
    promptSuffix: "Role: **Planner** — produce structured steps, risks, and verification before execution.",
  },
  coder: {
    routeHint: "coder",
    promptSuffix: "Role: **Coder** — focus on implementation, correctness, and minimal diffs.",
  },
  reviewer: {
    routeHint: "default",
    promptSuffix: "Role: **Reviewer** — critique plans and outputs; list issues and concrete improvements.",
  },
  researcher: {
    routeHint: "default",
    promptSuffix: "Role: **Researcher** — gather evidence from search_tool and sources; cite context.",
  },
};

function normalizeAgentRole(raw) {
  const s = String(raw || "").trim().toLowerCase();
  return ROLE_HINTS[s] ? s : "";
}

function getRoleBlock(role) {
  const key = normalizeAgentRole(role);
  if (!key) return { routeHint: null, text: "" };
  const r = ROLE_HINTS[key];
  return { routeHint: r.routeHint, text: r.promptSuffix };
}

module.exports = {
  normalizeAgentRole,
  getRoleBlock,
  ROLE_HINTS,
};
