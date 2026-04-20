const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

test("retrieval memory indexes and returns relevant context", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-retrieval-"));
  const previous = process.env.VERA_RETRIEVAL_INDEX_FILE;
  process.env.VERA_RETRIEVAL_INDEX_FILE = path.join(root, "retrieval_index.json");

  try {
    clearModule("../memory/storage.js");
    clearModule("../memory/retrievalMemory.js");
    const retrieval = require("../memory/retrievalMemory.js");

    await retrieval.addDocuments("s1", "conversation", "User likes hiking in colorado mountains");
    await retrieval.addDocuments("s2", "conversation", "Discussing pizza toppings and restaurants");

    const results = retrieval.searchRelevant("what did i say about hiking?", { topK: 2 });
    assert.ok(results.length >= 1);
    assert.match(results[0].text.toLowerCase(), /hiking|mountains/);
    const stats = retrieval.getStats();
    assert.equal(stats.embeddingsEnabled, true);
    assert.ok(stats.documentsWithEmbeddings >= 1);
  } finally {
    if (previous === undefined) delete process.env.VERA_RETRIEVAL_INDEX_FILE;
    else process.env.VERA_RETRIEVAL_INDEX_FILE = previous;
  }
});

test("fine-tune dataset builder respects approved sessions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-ft-"));
  const sessionsDir = path.join(root, "sessions");
  const trainingDir = path.join(root, "training");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(trainingDir, { recursive: true });

  fs.writeFileSync(
    path.join(sessionsDir, "approved-1.json"),
    JSON.stringify(
      [
        { role: "user", content: "How do I reset my password?" },
        { role: "assistant", content: "Go to settings and click Reset Password." },
      ],
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(sessionsDir, "unapproved-2.json"),
    JSON.stringify(
      [
        { role: "user", content: "private data should not be used" },
        { role: "assistant", content: "acknowledged" },
      ],
      null,
      2
    )
  );

  const approvedFile = path.join(trainingDir, "approved_sessions.txt");
  fs.writeFileSync(approvedFile, "approved-1\n");

  clearModule("../training/fineTuneDataset.js");
  const fineTune = require("../training/fineTuneDataset.js");
  const examples = fineTune.buildDataset({
    sessionsDir,
    approvedFile,
    approvedOnly: true,
  });

  assert.equal(examples.length, 1);
  assert.equal(examples[0].sessionId, "approved-1");
  assert.match(examples[0].prompt, /reset my password/i);
});
