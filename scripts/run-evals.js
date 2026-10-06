const fs = require("fs");
const path = require("path");

const { createModelRouter } = require("../core/modelRouter");
const retrievalMemory = require("../memory/retrievalMemory");

const defaultGolden = path.join(__dirname, "..", "evals", "golden.json");
const inputPath = process.env.VERA_EVALS_FILE || defaultGolden;
const outputPath = process.env.VERA_EVALS_REPORT || path.join(__dirname, "..", "evals", "report.json");
const USE_MODEL = String(process.env.VERA_EVALS_USE_MODEL || "false").toLowerCase() === "true";

function loadCases() {
  const files = [];
  const extra = process.env.VERA_EVALS_FILES;
  if (extra && String(extra).trim()) {
    for (const p of String(extra)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      files.push(path.isAbsolute(p) ? p : path.join(__dirname, "..", p));
    }
  } else {
    files.push(inputPath);
    const bench = path.join(__dirname, "..", "evals", "benchmark-suite.json");
    if (fs.existsSync(bench)) {
      files.push(bench);
    }
  }

  const seen = new Set();
  const all = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const raw = JSON.parse(fs.readFileSync(f, "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.cases || [];
    for (const c of arr) {
      const id = c && c.id != null ? String(c.id) : "";
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      all.push(c);
    }
  }
  return all;
}

function scoreTokenExpectations(text, expects = []) {
  const lowered = String(text || "").toLowerCase();
  const tokens = Array.isArray(expects) ? expects : [];
  if (!tokens.length) return 1;
  const tokenMatchCount = tokens.filter((token) => lowered.includes(String(token).toLowerCase())).length;
  return tokenMatchCount / tokens.length;
}

function groupAggregate(results) {
  const by = Object.create(null);
  for (const r of results) {
    const g = r.group || "ungrouped";
    if (!by[g]) by[g] = { scores: [], count: 0 };
    by[g].scores.push(r.score);
    by[g].count += 1;
  }
  const out = {};
  for (const [g, v] of Object.entries(by)) {
    const avg = v.scores.length ? v.scores.reduce((a, b) => a + b, 0) / v.scores.length : 0;
    out[g] = { count: v.count, averageScore: Number(avg.toFixed(4)) };
  }
  return out;
}

async function run() {
  const router = createModelRouter();
  const cases = loadCases();
  const results = [];
  const brain = USE_MODEL ? require("../core/verabrain") : null;

  for (const c of cases) {
    const route = router.resolveRoute({ prompt: c.prompt, metadata: {} });
    const expectationScore = scoreTokenExpectations(c.prompt, c.expects || c.expectsPrompt);
    const routePass = c.routeHint ? route.route === c.routeHint || route.route === "default" : true;
    const responseText =
      USE_MODEL && Array.isArray(c.expectsResponse) && c.expectsResponse.length
        ? await brain.send(c.prompt, `eval_${c.id}`)
        : "";
    const responseScore = Array.isArray(c.expectsResponse)
      ? scoreTokenExpectations(responseText, c.expectsResponse)
      : null;

    let retrievalScore = null;
    if (c.retrievalQuery) {
      const matches = retrievalMemory.searchRelevant(c.retrievalQuery, { topK: Number(c.retrievalTopK || 4) });
      const haystack = matches.map((m) => m.text).join("\n").toLowerCase();
      retrievalScore = Array.isArray(c.retrievalExpects) && c.retrievalExpects.length
        ? scoreTokenExpectations(haystack, c.retrievalExpects)
        : matches.length > 0
          ? 1
          : 0;
    }

    const weightedComponents = [
      { present: true, weight: 0.4, value: expectationScore },
      { present: true, weight: 0.3, value: routePass ? 1 : 0 },
      { present: responseScore !== null, weight: 0.2, value: responseScore || 0 },
      { present: retrievalScore !== null, weight: 0.1, value: retrievalScore || 0 },
    ].filter((x) => x.present);
    const totalWeight = weightedComponents.reduce((sum, item) => sum + item.weight, 0) || 1;
    const score = Number(
      (
        weightedComponents.reduce((sum, item) => sum + item.value * item.weight, 0) /
        totalWeight
      ).toFixed(4)
    );

    results.push({
      id: c.id,
      group: c.group,
      route: route.route,
      routeReason: route.reason,
      routeConfidence: typeof route.confidence === "number" ? route.confidence : null,
      expectationScore,
      responseScore,
      retrievalScore,
      routePass,
      score,
    });
  }

  const average = results.length ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    config: {
      useModel: USE_MODEL,
      caseCount: cases.length,
    },
    cases: results.length,
    averageScore: Number(average.toFixed(4)),
    byGroup: groupAggregate(results),
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Eval report written: ${outputPath}`);
  console.log(`Average score: ${report.averageScore}`);
}

run().catch((err) => {
  console.error("Eval run failed:", err.message);
  process.exit(1);
});
