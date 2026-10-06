/**
 * Heuristic contradiction detection: opposing sentiment about overlapping topics → review_flag.
 */

function normalizeFactObj(factObj) {
  if (!factObj || typeof factObj !== "object") return "";
  return [
    factObj.subject || "",
    factObj.sentiment || "",
    factObj.type || "",
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.,!?;:]+$/, "")
    .replace(/\b(the user|user)\b/g, "")
    .replace(/\b(likes|loves|enjoys|prefers|doesn't like|does not like|dislikes|hates)\b/g, "")
    .trim();
}

function topicOverlapTokens(a, b) {
  const ka = normalizeFactObj(a);
  const kb = normalizeFactObj(b);
  if (ka && kb && ka === kb) return true;
  const wa = new Set(String(ka).split(/\s+/).filter((x) => x.length > 2));
  const wb = new Set(String(kb).split(/\s+/).filter((x) => x.length > 2));
  let n = 0;
  for (const w of wa) {
    if (wb.has(w)) n += 1;
  }
  return n >= 2;
}

function sentimentPolarity(text) {
  const t = String(text || "").toLowerCase();
  const neg = /\b(does not|don't|doesn't|never\b|no longer|not\s+\w+\s+to|dislike|hates|hate|avoid)\b/;
  const pos = /\b(loves|love|likes|like|prefers|prefer|enjoys|enjoy|always|favorite)\b/;
  const n = neg.test(t) ? -1 : pos.test(t) ? 1 : 0;
  return n;
}

function mightContradict(a, b) {
  const p1 = sentimentPolarity(a.text);
  const p2 = sentimentPolarity(b.text);
  if (p1 === 0 || p2 === 0) return false;
  return p1 !== p2;
}

function markContradictionsForNewBelief(db, newFact, newId, sessionId) {
  const sid = sessionId != null ? String(sessionId) : "";
  const rows = db
    .prepare(`SELECT id, content FROM beliefs WHERE valid_to IS NULL AND session_id = ?`)
    .all(sid);
  const targets = [];
  for (const r of rows) {
    if (r.id === newId) continue;
    let o;
    try {
      o = JSON.parse(r.content);
    } catch (_e) {
      continue;
    }
    if (!o || typeof o !== "object") continue;
    if (mightContradict(newFact, o) && topicOverlapTokens(newFact, o)) {
      targets.push(r.id);
    }
  }
  if (!targets.length) return;
  targets.push(newId);
  const stmt = db.prepare(`UPDATE beliefs SET review_flag = 1 WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const id of targets) stmt.run(id);
  });
  tx();
}

module.exports = {
  markContradictionsForNewBelief,
};
