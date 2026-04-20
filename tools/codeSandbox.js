const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const SANDBOX_ENABLED = String(process.env.VERA_SANDBOX_ENABLED || "false").toLowerCase() === "true";
const DEFAULT_TIMEOUT_MS = Number(process.env.VERA_SANDBOX_TIMEOUT_MS || 8000);
const DEFAULT_MEMORY_MB = Number(process.env.VERA_SANDBOX_MEMORY_MB || 512);
const DEFAULT_CPU_LIMIT = String(process.env.VERA_SANDBOX_CPU_LIMIT || "1.0");
const MAX_OUTPUT_CHARS = Number(process.env.VERA_SANDBOX_MAX_OUTPUT_CHARS || 20000);
const SANDBOX_HARDENED_DEFAULT = String(process.env.VERA_SANDBOX_HARDENED || "true").toLowerCase() === "true";
const SANDBOX_USER = String(process.env.VERA_SANDBOX_USER || "65532:65532");
const SANDBOX_NOFILE = String(process.env.VERA_SANDBOX_NOFILE || "256:256");
const SANDBOX_USE_IMAGE_LOCK = String(process.env.VERA_SANDBOX_USE_IMAGE_LOCK || "true").toLowerCase() === "true";
const SANDBOX_REQUIRE_LOCK_DIGEST = String(process.env.VERA_SANDBOX_REQUIRE_LOCK_DIGEST || "false").toLowerCase() === "true";
const SANDBOX_IMAGE_LOCK_FILE = process.env.VERA_SANDBOX_IMAGE_LOCK_FILE || path.join(__dirname, "sandbox-images", "images.lock.json");

const DEFAULT_DEDICATED_IMAGES = {
  python: process.env.VERA_SANDBOX_IMAGE_PYTHON || "vera-sandbox-python:stable",
  javascript: process.env.VERA_SANDBOX_IMAGE_JAVASCRIPT || "vera-sandbox-javascript:stable",
  shell: process.env.VERA_SANDBOX_IMAGE_SHELL || "vera-sandbox-shell:stable",
};

const FALLBACK_IMAGES = {
  python: "python:3.11-alpine",
  javascript: "node:20-alpine",
  shell: "alpine:3.20",
};

function checkDockerAvailable() {
  const probe = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 3000,
  });
  return probe.status === 0;
}

function loadImageLock() {
  if (!SANDBOX_USE_IMAGE_LOCK) return null;
  try {
    if (!fs.existsSync(SANDBOX_IMAGE_LOCK_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(SANDBOX_IMAGE_LOCK_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

function resolveImage(languageKey) {
  const lock = loadImageLock();
  const lockedEntry = lock?.images?.[languageKey] || null;
  const lockedImage = lockedEntry?.digest || lockedEntry?.tag;
  if (SANDBOX_REQUIRE_LOCK_DIGEST) {
    if (!SANDBOX_USE_IMAGE_LOCK) {
      throw new Error("Sandbox strict lock mode requires VERA_SANDBOX_USE_IMAGE_LOCK=true.");
    }
    if (!lock) {
      throw new Error(`Sandbox strict lock mode requires lock file at ${SANDBOX_IMAGE_LOCK_FILE}.`);
    }
    if (!lockedEntry || !lockedEntry.digest) {
      throw new Error(`Sandbox strict lock mode requires digest for '${languageKey}' image in lock file.`);
    }
    return lockedEntry.digest;
  }
  if (lockedImage) return lockedImage;
  return DEFAULT_DEDICATED_IMAGES[languageKey] || FALLBACK_IMAGES[languageKey];
}

function languageProfile(language) {
  const normalized = String(language || "").toLowerCase().trim();
  if (normalized === "python" || normalized === "py") {
    return {
      language: "python",
      image: resolveImage("python"),
      filename: "main.py",
      runCommand: ["python", "main.py"],
    };
  }
  if (normalized === "javascript" || normalized === "js" || normalized === "node") {
    return {
      language: "javascript",
      image: resolveImage("javascript"),
      filename: "main.js",
      runCommand: ["node", "main.js"],
    };
  }
  if (normalized === "shell" || normalized === "sh" || normalized === "bash") {
    return {
      language: "shell",
      image: resolveImage("shell"),
      filename: "main.sh",
      runCommand: ["sh", "main.sh"],
    };
  }
  throw new Error("Unsupported sandbox language. Use python, javascript, or shell.");
}

function trimOutput(text) {
  const raw = String(text || "");
  return raw.length > MAX_OUTPUT_CHARS ? `${raw.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated]` : raw;
}

function buildDockerArgs(profile, runtime) {
  const args = [
    "run",
    "--rm",
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "64",
    "--memory",
    `${runtime.memoryMb}m`,
    "--cpus",
    runtime.cpuLimit,
    "--ulimit",
    `nofile=${SANDBOX_NOFILE}`,
  ];

  if (runtime.hardened) {
    args.push(
      "--read-only",
      "--user",
      SANDBOX_USER,
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=64m",
      "--tmpfs",
      "/run:rw,noexec,nosuid,nodev,size=16m"
    );
  }

  args.push(
    "-v",
    `${runtime.tempRoot}:/workspace`,
    "-w",
    "/workspace",
    profile.image,
    ...profile.runCommand
  );

  return args;
}

async function runInSandbox(options = {}) {
  if (!SANDBOX_ENABLED) {
    return {
      ok: false,
      error: "Sandbox is disabled. Set VERA_SANDBOX_ENABLED=true to allow code execution.",
    };
  }
  if (!checkDockerAvailable()) {
    return {
      ok: false,
      error: "Docker is not available on this host.",
    };
  }

  const code = String(options.code || "").trim();
  if (!code) {
    return { ok: false, error: "Sandbox requires non-empty code." };
  }

  const profile = languageProfile(options.language || "python");
  const timeoutMs = Math.max(500, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const memoryMb = Math.max(128, Number(options.memoryMb || DEFAULT_MEMORY_MB));
  const cpuLimit = String(options.cpuLimit || DEFAULT_CPU_LIMIT);
  const stdin = String(options.stdin || "");
  const hardened = typeof options.hardened === "boolean" ? options.hardened : SANDBOX_HARDENED_DEFAULT;

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vera-sandbox-"));
  const sourcePath = path.join(tempRoot, profile.filename);
  fs.writeFileSync(sourcePath, code, "utf8");

  const args = buildDockerArgs(profile, {
    tempRoot,
    memoryMb,
    cpuLimit,
    hardened,
  });

  return new Promise((resolve) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (codeValue) => {
      clearTimeout(timer);
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch (_err) {
        // ignore cleanup errors
      }
      if (timedOut) {
        return resolve({
          ok: false,
          error: `Sandbox timed out after ${timeoutMs}ms`,
          stdout: trimOutput(stdout),
          stderr: trimOutput(stderr),
          timeoutMs,
        });
      }
      return resolve({
        ok: codeValue === 0,
        exitCode: codeValue,
        stdout: trimOutput(stdout),
        stderr: trimOutput(stderr),
        language: profile.language,
        hardened,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch (_err) {
        // ignore cleanup errors
      }
      resolve({
        ok: false,
        error: `Failed to start sandbox process: ${err.message}`,
      });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

module.exports = {
  runInSandbox,
  buildDockerArgs,
  languageProfile,
  resolveImage,
  loadImageLock,
  SANDBOX_REQUIRE_LOCK_DIGEST,
};
