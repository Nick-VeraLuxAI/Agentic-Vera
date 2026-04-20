const fs = require("fs");
const path = require("path");

let lockChain = Promise.resolve();

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function atomicWriteJsonSync(filePath, value) {
  ensureDirSync(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(value, null, 2);
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

function quarantineCorruptFileSync(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
  fs.renameSync(filePath, quarantinePath);
  return quarantinePath;
}

function readJsonSafeSync(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    quarantineCorruptFileSync(filePath);
    atomicWriteJsonSync(filePath, fallbackValue);
    return fallbackValue;
  }
}

function withMemoryLock(task) {
  const run = lockChain.then(() => task());
  lockChain = run.catch(() => {});
  return run;
}

module.exports = {
  ensureDirSync,
  atomicWriteJsonSync,
  readJsonSafeSync,
  withMemoryLock,
};
