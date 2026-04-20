const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ensureDirSync, atomicWriteJsonSync, withMemoryLock } = require("./storage");

const MEMORY_DIR = __dirname;
const LONGTERM_FILE = process.env.VERA_LONGTERM_FILE || path.join(MEMORY_DIR, "longterm.json");
const SESSIONS_DIR = process.env.VERA_SESSIONS_DIR || path.join(MEMORY_DIR, "sessions");
const BACKUPS_DIR = process.env.VERA_BACKUPS_DIR || path.join(MEMORY_DIR, "backups");
const MAX_BACKUPS = Number(process.env.VERA_MAX_MEMORY_BACKUPS || 10);
const MAX_BACKUP_AGE_MS = Number(process.env.VERA_MAX_BACKUP_AGE_MS || 0);
const MANIFEST_HMAC_KEY = process.env.VERA_BACKUP_MANIFEST_HMAC_KEY || "";
const MANIFEST_FILE = "manifest.json";

function ensurePaths() {
  ensureDirSync(BACKUPS_DIR);
  ensureDirSync(SESSIONS_DIR);
  if (!fs.existsSync(LONGTERM_FILE)) atomicWriteJsonSync(LONGTERM_FILE, []);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function collectFilesRecursive(rootDir, currentDir = rootDir, out = []) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursive(rootDir, fullPath, out);
    } else {
      out.push(path.relative(rootDir, fullPath));
    }
  }
  return out.sort();
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function buildManifest(backupDir) {
  const files = collectFilesRecursive(backupDir).filter((f) => f !== MANIFEST_FILE);
  const checksums = {};
  for (const rel of files) {
    checksums[rel] = sha256File(path.join(backupDir, rel));
  }
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    files,
    checksums,
  };
}

function buildManifestPayload(manifest) {
  return {
    version: manifest.version,
    createdAt: manifest.createdAt,
    files: manifest.files,
    checksums: manifest.checksums,
  };
}

function signManifest(manifest) {
  if (!MANIFEST_HMAC_KEY) return null;
  const payload = JSON.stringify(buildManifestPayload(manifest));
  return crypto.createHmac("sha256", MANIFEST_HMAC_KEY).update(payload).digest("hex");
}

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

function pruneBackups() {
  const backups = fs
    .readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const overflow = backups.length - MAX_BACKUPS;
  if (overflow <= 0) return;
  for (const dir of backups.slice(0, overflow)) {
    fs.rmSync(path.join(BACKUPS_DIR, dir), { recursive: true, force: true });
  }
}

async function createBackup() {
  return withMemoryLock(async () => {
    ensurePaths();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(BACKUPS_DIR, `backup-${stamp}`);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(LONGTERM_FILE, path.join(target, "longterm.json"));
    copyDirRecursive(SESSIONS_DIR, path.join(target, "sessions"));
    const manifest = buildManifest(target);
    if (MANIFEST_HMAC_KEY) {
      manifest.signatureAlg = "hmac-sha256";
      manifest.signature = signManifest(manifest);
    }
    atomicWriteJsonSync(path.join(target, MANIFEST_FILE), manifest);
    pruneBackups();
    return target;
  });
}

function listBackups() {
  ensurePaths();
  return fs
    .readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function restoreBackup(backupName, options = {}) {
  return withMemoryLock(async () => {
    ensurePaths();
    const source = path.join(BACKUPS_DIR, backupName);
    if (!fs.existsSync(source)) return false;
    const validation = validateBackup(backupName, options);
    if (!validation.valid) {
      const err = new Error("Backup validation failed.");
      err.details = validation;
      throw err;
    }
    fs.copyFileSync(path.join(source, "longterm.json"), LONGTERM_FILE);
    fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
    copyDirRecursive(path.join(source, "sessions"), SESSIONS_DIR);
    return true;
  });
}

async function restoreLatestBackup(options = {}) {
  const backups = listBackups();
  if (!backups.length) return false;
  return restoreBackup(backups[backups.length - 1], options);
}

function validateBackup(backupName, options = {}) {
  ensurePaths();
  const source = path.join(BACKUPS_DIR, backupName);
  if (!fs.existsSync(source)) {
    return { valid: false, errors: ["Backup not found."], backupName };
  }

  const manifestPath = path.join(source, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return { valid: false, errors: ["Missing backup manifest."], backupName };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return { valid: false, errors: ["Invalid manifest JSON."], backupName };
  }

  const errors = [];
  const maxAgeMs = Number(options.maxAgeMs ?? MAX_BACKUP_AGE_MS);
  const createdAtMs = Date.parse(manifest.createdAt || "");
  if (!Number.isFinite(createdAtMs)) {
    errors.push("Invalid manifest createdAt.");
  } else if (maxAgeMs > 0 && Date.now() - createdAtMs > maxAgeMs) {
    errors.push(`Backup is older than allowed max age (${maxAgeMs}ms).`);
  }

  if (MANIFEST_HMAC_KEY) {
    if (!manifest.signature || manifest.signatureAlg !== "hmac-sha256") {
      errors.push("Missing or invalid manifest signature.");
    } else {
      const expectedSignature = signManifest(manifest);
      if (!safeEqualHex(manifest.signature, expectedSignature)) {
        errors.push("Manifest signature mismatch.");
      }
    }
  }

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const rel of files) {
    const fullPath = path.join(source, rel);
    if (!fs.existsSync(fullPath)) {
      errors.push(`Missing file: ${rel}`);
      continue;
    }
    const expected = manifest.checksums?.[rel];
    const actual = sha256File(fullPath);
    if (!expected || expected !== actual) {
      errors.push(`Checksum mismatch: ${rel}`);
    }
    if (rel.endsWith(".json")) {
      try {
        JSON.parse(fs.readFileSync(fullPath, "utf8"));
      } catch {
        errors.push(`Invalid JSON payload: ${rel}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    backupName,
    checkedFiles: files.length,
    ageMs: Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : null,
    errors,
  };
}

function validateLatestBackup(options = {}) {
  const backups = listBackups();
  if (!backups.length) {
    return { valid: false, errors: ["No backup available."], backupName: null };
  }
  return validateBackup(backups[backups.length - 1], options);
}

module.exports = {
  createBackup,
  listBackups,
  restoreBackup,
  restoreLatestBackup,
  validateBackup,
  validateLatestBackup,
};
