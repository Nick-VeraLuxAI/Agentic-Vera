const fs = require("fs");
const path = require("path");

const { createModelRouter } = require("../core/modelRouter");
const retrievalMemory = require("../memory/retrievalMemory");

const inputPath = process.env.VERA_EVALS_FILE || path.join(__dirname, "..", "evals", "golden.json");
const outputPath = process.env.VERA_EVALS_REPORT || path.join(__dirname, "..", "evals", "report.json");
const USE_MODEL = String(process.env.VERA_EVALS_USE_MODEL || "false").toLowerCase() === "true";

function loadCases() {
  return JSON.parse(fs.readFileSync(inputPath, "utf8"));
}

function scoreTokenExpectations(text, expects = []) {
  const lowered = String(text || "").toLowerCase();
  const tokens = Array.isArray(expects) ? expects : [];
  if (!tokens.length) return 1;
  const tokenMatchCount = tokens.filter((token) => lowered.includes(String(token).toLowerCase())).length;
  return tokenMatchCount / tokens.length;
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
      route: route.route,
      routeReason: route.reason,
      expectationScore,
      responseScore,
      retrievalScore,
      routePass,
      score,
    });
  }

  const average = results.length
    ? results.reduce((sum, r) => sum + r.score, 0) / results.length
    : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    config: {
      useModel: USE_MODEL,
    },
    cases: results.length,
    averageScore: Number(average.toFixed(4)),
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
