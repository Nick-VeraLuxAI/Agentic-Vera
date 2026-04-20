const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

function setMemoryEnv(root) {
  const previous = {
    VERA_LONGTERM_FILE: process.env.VERA_LONGTERM_FILE,
    VERA_SESSIONS_DIR: process.env.VERA_SESSIONS_DIR,
    VERA_BACKUPS_DIR: process.env.VERA_BACKUPS_DIR,
    VERA_BACKUP_MANIFEST_HMAC_KEY: process.env.VERA_BACKUP_MANIFEST_HMAC_KEY,
    VERA_MAX_BACKUP_AGE_MS: process.env.VERA_MAX_BACKUP_AGE_MS,
  };

  process.env.VERA_LONGTERM_FILE = path.join(root, "longterm.json");
  process.env.VERA_SESSIONS_DIR = path.join(root, "sessions");
  process.env.VERA_BACKUPS_DIR = path.join(root, "backups");

  return () => {
    if (previous.VERA_LONGTERM_FILE === undefined) delete process.env.VERA_LONGTERM_FILE;
    else process.env.VERA_LONGTERM_FILE = previous.VERA_LONGTERM_FILE;
    if (previous.VERA_SESSIONS_DIR === undefined) delete process.env.VERA_SESSIONS_DIR;
    else process.env.VERA_SESSIONS_DIR = previous.VERA_SESSIONS_DIR;
    if (previous.VERA_BACKUPS_DIR === undefined) delete process.env.VERA_BACKUPS_DIR;
    else process.env.VERA_BACKUPS_DIR = previous.VERA_BACKUPS_DIR;
    if (previous.VERA_BACKUP_MANIFEST_HMAC_KEY === undefined) delete process.env.VERA_BACKUP_MANIFEST_HMAC_KEY;
    else process.env.VERA_BACKUP_MANIFEST_HMAC_KEY = previous.VERA_BACKUP_MANIFEST_HMAC_KEY;
    if (previous.VERA_MAX_BACKUP_AGE_MS === undefined) delete process.env.VERA_MAX_BACKUP_AGE_MS;
    else process.env.VERA_MAX_BACKUP_AGE_MS = previous.VERA_MAX_BACKUP_AGE_MS;
  };
}

test("long-term memory quarantines corrupted JSON", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-mem-"));
  const restoreEnv = setMemoryEnv(root);
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "longterm.json"), "{broken json", "utf8");

    clearModule("../memory/storage.js");
    clearModule("../memory/longTermMemory.js");
    const longTerm = require("../memory/longTermMemory.js");

    const facts = longTerm.getFacts();
    assert.deepEqual(facts, []);

    const files = fs.readdirSync(root);
    assert.ok(files.some((name) => name.startsWith("longterm.json.corrupt-")));
    const repaired = JSON.parse(fs.readFileSync(path.join(root, "longterm.json"), "utf8"));
    assert.deepEqual(repaired, []);
  } finally {
    restoreEnv();
  }
});

test("short-term memory load survives corruption and save rewrites safely", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-stm-"));
  const restoreEnv = setMemoryEnv(root);
  try {
    fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(root, "sessions", "abc.json"), "not-json", "utf8");

    clearModule("../memory/storage.js");
    clearModule("../memory/shortTermMemory.js");
    const shortTerm = require("../memory/shortTermMemory.js");

    const loaded = shortTerm.loadMemory("abc");
    assert.deepEqual(loaded, []);

    const sessionFiles = fs.readdirSync(path.join(root, "sessions"));
    assert.ok(sessionFiles.some((name) => name.startsWith("abc.json.corrupt-")));

    const payload = [{ role: "user", content: "hello" }];
    await shortTerm.saveMemory("abc", payload);
    const persisted = JSON.parse(fs.readFileSync(path.join(root, "sessions", "abc.json"), "utf8"));
    assert.deepEqual(persisted, payload);
  } finally {
    restoreEnv();
  }
});

test("memory controller persists summarized fact objects", async () => {
  const controllerPath = require.resolve("../memory/memoryController.js");
  const deps = [
    require.resolve("../memory/shortTermMemory.js"),
    require.resolve("../memory/longTermMemory.js"),
    require.resolve("../memory/memoryDecider.js"),
    require.resolve("../memory/memorySummarizer.js"),
  ];

  const originals = new Map();
  for (const dep of deps) {
    originals.set(dep, require.cache[dep]);
  }
  const originalController = require.cache[controllerPath];

  let capturedFact = null;
  require.cache[deps[0]] = {
    id: deps[0],
    filename: deps[0],
    loaded: true,
    exports: { loadMemory: () => [], saveMemory: async () => {} },
  };
  require.cache[deps[1]] = {
    id: deps[1],
    filename: deps[1],
    loaded: true,
    exports: {
      getFacts: () => [],
      addFact: async (fact) => {
        capturedFact = fact;
      },
      deleteFact: async () => false,
    },
  };
  require.cache[deps[2]] = {
    id: deps[2],
    filename: deps[2],
    loaded: true,
    exports: {
      shouldRemember: () => ({ shouldSave: true, fact: "abcde" }),
      shouldForget: () => ({ shouldDelete: false }),
    },
  };
  require.cache[deps[3]] = {
    id: deps[3],
    filename: deps[3],
    loaded: true,
    exports: {
      runMemorySummarizer: async () => ({ text: "remembered preference", type: "preference", subject: "user" }),
    },
  };

  try {
    delete require.cache[controllerPath];
    const controller = require("../memory/memoryController.js");
    const updates = await controller.processUserMessage("remember this", "s1");
    assert.equal(capturedFact.text, "remembered preference");
    assert.ok(updates.some((entry) => entry.includes("remembered preference")));
  } finally {
    delete require.cache[controllerPath];
    if (originalController) require.cache[controllerPath] = originalController;
    for (const dep of deps) {
      const original = originals.get(dep);
      if (original) require.cache[dep] = original;
      else delete require.cache[dep];
    }
  }
});

test("backup and restore round-trip memory state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-bak-"));
  const restoreEnv = setMemoryEnv(root);
  try {
    fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(root, "longterm.json"), JSON.stringify([{ text: "before" }], null, 2));
    fs.writeFileSync(path.join(root, "sessions", "s1.json"), JSON.stringify([{ role: "user", content: "x" }], null, 2));

    clearModule("../memory/storage.js");
    clearModule("../memory/backupManager.js");
    const backupManager = require("../memory/backupManager.js");

    await backupManager.createBackup();
    const validation = backupManager.validateLatestBackup();
    assert.equal(validation.valid, true);
    fs.writeFileSync(path.join(root, "longterm.json"), JSON.stringify([{ text: "after" }], null, 2));
    fs.rmSync(path.join(root, "sessions"), { recursive: true, force: true });
    fs.mkdirSync(path.join(root, "sessions"), { recursive: true });

    const restored = await backupManager.restoreLatestBackup();
    assert.equal(restored, true);
    const longterm = JSON.parse(fs.readFileSync(path.join(root, "longterm.json"), "utf8"));
    const session = JSON.parse(fs.readFileSync(path.join(root, "sessions", "s1.json"), "utf8"));
    assert.equal(longterm[0].text, "before");
    assert.equal(session[0].content, "x");
  } finally {
    restoreEnv();
  }
});

test("backup validation detects checksum tampering", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-bak-tamper-"));
  const restoreEnv = setMemoryEnv(root);
  try {
    fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(root, "longterm.json"), JSON.stringify([{ text: "safe" }], null, 2));
    fs.writeFileSync(path.join(root, "sessions", "s1.json"), JSON.stringify([{ role: "user", content: "hello" }], null, 2));

    clearModule("../memory/storage.js");
    clearModule("../memory/backupManager.js");
    const backupManager = require("../memory/backupManager.js");

    const backupPath = await backupManager.createBackup();
    fs.writeFileSync(path.join(backupPath, "sessions", "s1.json"), JSON.stringify([{ role: "user", content: "tampered" }], null, 2));

    const result = backupManager.validateLatestBackup();
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((entry) => entry.includes("Checksum mismatch")));
  } finally {
    restoreEnv();
  }
});

test("backup validation detects stale backup age", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-bak-age-"));
  const restoreEnv = setMemoryEnv(root);
  try {
    fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(root, "longterm.json"), JSON.stringify([{ text: "safe" }], null, 2));
    fs.writeFileSync(path.join(root, "sessions", "s1.json"), JSON.stringify([{ role: "user", content: "hello" }], null, 2));

    clearModule("../memory/storage.js");
    clearModule("../memory/backupManager.js");
    const backupManager = require("../memory/backupManager.js");
    const backupPath = await backupManager.createBackup();

    const manifestPath = path.join(backupPath, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.createdAt = "2000-01-01T00:00:00.000Z";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = backupManager.validateLatestBackup({ maxAgeMs: 1000 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((entry) => entry.includes("older than allowed")));
  } finally {
    restoreEnv();
  }
});

test("signed manifest detects signature mismatch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vera-bak-sign-"));
  const restoreEnv = setMemoryEnv(root);
  process.env.VERA_BACKUP_MANIFEST_HMAC_KEY = "test-secret-key";
  try {
    fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(root, "longterm.json"), JSON.stringify([{ text: "safe" }], null, 2));
    fs.writeFileSync(path.join(root, "sessions", "s1.json"), JSON.stringify([{ role: "user", content: "hello" }], null, 2));

    clearModule("../memory/storage.js");
    clearModule("../memory/backupManager.js");
    const backupManager = require("../memory/backupManager.js");
    const backupPath = await backupManager.createBackup();

    const manifestPath = path.join(backupPath, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.createdAt = "1999-12-31T00:00:00.000Z";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = backupManager.validateLatestBackup();
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((entry) => entry.includes("Manifest signature mismatch")));
  } finally {
    restoreEnv();
  }
});
