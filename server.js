const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const path = require("path");
const { spawn } = require("child_process");
const mammoth = require("mammoth");
const memoryApiDefault = require("./memory/longTermMemory");
const retrievalMemory = require("./memory/retrievalMemory");
const taskQueue = require("./orchestration/taskQueue");
const { createBackup, listBackups, restoreLatestBackup, validateLatestBackup } = require("./memory/backupManager");

const port = 3000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_FILES = 5;
const PYTHON_TOOL_TIMEOUT_MS = 15000;
const BACKUP_INTERVAL_MS = Number(process.env.VERA_BACKUP_INTERVAL_MS || 3600000);
const MAX_EXTRACTED_FILE_TEXT_CHARS = Number(process.env.VERA_MAX_EXTRACTED_FILE_TEXT_CHARS || 50000);
const ADMIN_API_KEY = String(process.env.VERA_ADMIN_API_KEY || "").trim();

function getDefaultBrain() {
  return require("./core/verabrain");
}

function isLoopback(req) {
  const ip = req.ip || req.connection?.remoteAddress || "";
  return ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1";
}

function requireLocalApi(req, res, next) {
  if (!isLoopback(req)) {
    return res.status(403).json({ error: "API access is restricted to localhost." });
  }
  next();
}

function getSessionId(req) {
  const raw = String(req.headers["x-session-id"] || "default").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(raw)) {
    const err = new Error("Invalid session ID format.");
    err.statusCode = 400;
    throw err;
  }
  return raw;
}

function requireScopedAuth(scope = "admin") {
  return (req, res, next) => {
    if (!ADMIN_API_KEY) return next();
    const authHeader = String(req.headers.authorization || "").trim();
    const headerKey = String(req.headers["x-api-key"] || "").trim();
    const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    const provided = bearer || headerKey;
    if (provided && provided === ADMIN_API_KEY) return next();
    return res.status(401).json({ error: `${scope} API key required.` });
  };
}

function createApp(options = {}) {
  const brain = options.brain || getDefaultBrain();
  const memoryApi = options.memoryApi || memoryApiDefault;
  const disableLocalOnly = options.disableLocalOnly === true;

  const app = express();
  app.set("trust proxy", false);
  const bootTime = Date.now();
  const metrics = {
    requests_total: 0,
    requests_failed_total: 0,
    requests_in_flight: 0,
    request_duration_ms_total: 0,
    ai_requests_total: 0,
    ai_requests_failed_total: 0,
    backups_created_total: 0,
    last_backup_at: null,
    router_route_counts: {
      default: 0,
      coder: 0,
      legal: 0,
      file: 0,
      unknown: 0,
    },
    router_last_decision: null,
  };

  function trackRouteDecision(route) {
    if (!route) return;
    const key = route.route || "unknown";
    if (!Object.prototype.hasOwnProperty.call(metrics.router_route_counts, key)) {
      metrics.router_route_counts[key] = 0;
    }
    metrics.router_route_counts[key] += 1;
    metrics.router_last_decision = {
      route: route.route || "unknown",
      reason: route.reason || "unspecified",
      timestamp: new Date().toISOString(),
    };
  }

  app.use(express.static(path.join(__dirname, "ui")));
  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "ui", "index.html"));
  });
  app.get("/libs/dompurify.min.js", (req, res) => {
    res.sendFile(path.join(__dirname, "node_modules", "dompurify", "dist", "purify.min.js"));
  });

  app.use(bodyParser.json());
  if (!disableLocalOnly) {
    app.use("/api", requireLocalApi);
  }
  app.use("/api/admin", requireScopedAuth("admin"));
  app.use("/api/memory", requireScopedAuth("memory"));

  app.use((req, res, next) => {
    const start = Date.now();
    const requestId = req.headers["x-request-id"] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);

    metrics.requests_total += 1;
    metrics.requests_in_flight += 1;

    res.on("finish", () => {
      metrics.requests_in_flight = Math.max(0, metrics.requests_in_flight - 1);
      metrics.request_duration_ms_total += Date.now() - start;
      if (res.statusCode >= 400) metrics.requests_failed_total += 1;
      const entry = {
        level: res.statusCode >= 500 ? "error" : "info",
        ts: new Date().toISOString(),
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      };
      console.log(JSON.stringify(entry));
    });
    next();
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: MAX_UPLOAD_FILES,
    },
  });

  function callPythonTool(scriptPath, fileBuffer, filename) {
    return new Promise((resolve, reject) => {
      const python = spawn("python3", [scriptPath]);
      const timeout = setTimeout(() => {
        python.kill("SIGKILL");
        reject("Python tool timed out.");
      }, PYTHON_TOOL_TIMEOUT_MS);

      python.on("error", (err) => {
        clearTimeout(timeout);
        console.error("❌ Python spawn error:", err);
        return reject("Python process failed to start.");
      });

      const payload = JSON.stringify({
        filename,
        base64: fileBuffer.toString("base64"),
      });

      let output = "";
      let error = "";

      try {
        python.stdin.write(payload);
        python.stdin.end();
      } catch (err) {
        clearTimeout(timeout);
        console.error("🚫 Write error (likely EPIPE):", err);
        return reject("Failed to send data to Python.");
      }

      python.stdout.on("data", (data) => {
        output += data.toString();
      });

      python.stderr.on("data", (data) => {
        error += data.toString();
      });

      python.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(output.trim());
        } else {
          console.error(`⚠️ Python exited with code ${code}`);
          reject(error || "Unknown Python error");
        }
      });
    });
  }

  async function buildFileText(files, sessionId) {
    let fileText = "";
    for (const file of files) {
      const fileLabel = file.originalname;
      try {
        const ext = path.extname(fileLabel || "").toLowerCase();
        const mime = String(file.mimetype || "").toLowerCase();
        let extracted = "";

        if (file.mimetype.startsWith("image/")) {
          const raw = await callPythonTool("./tools/image_tool.py", file.buffer, fileLabel);
          const parsed = JSON.parse(raw);
          extracted = parsed.text?.trim() || "(No text extracted)";
        } else if (file.mimetype === "application/pdf") {
          const raw = await callPythonTool("./tools/pdf_tool.py", file.buffer, fileLabel);
          const parsed = JSON.parse(raw);
          extracted = parsed.text?.trim() || "(No text extracted)";
        } else if (
          mime.startsWith("text/") ||
          mime === "application/json" ||
          mime === "application/javascript" ||
          mime === "application/xml" ||
          [".txt", ".md", ".csv", ".json", ".js", ".ts", ".log", ".xml", ".yaml", ".yml"].includes(ext)
        ) {
          extracted = file.buffer.toString("utf8").trim() || "(No text extracted)";
        } else if (
          mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          ext === ".docx"
        ) {
          const result = await mammoth.extractRawText({ buffer: file.buffer });
          extracted = (result.value || "").trim() || "(No text extracted)";
        } else if (
          mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          ext === ".xlsx"
        ) {
          fileText += `❓ XLSX is currently unsupported for security reasons: ${fileLabel}\n\n`;
          continue;
        } else {
          fileText += `❓ Unsupported file type: ${fileLabel}\n\n`;
          continue;
        }

        const safeExtracted = extracted.slice(0, MAX_EXTRACTED_FILE_TEXT_CHARS);
        fileText += `📎 [${fileLabel}]\n${safeExtracted}\n\n`;
        try {
          await retrievalMemory.addDocuments(sessionId, "file-upload", safeExtracted, {
            filename: fileLabel,
            mime,
          });
        } catch (err) {
          console.error(`⚠️ Retrieval index failed for ${fileLabel}:`, err.message);
        }
      } catch (err) {
        console.error(`❌ Failed to process ${fileLabel}:`, err);
        fileText += `❌ Error extracting from ${fileLabel}\n\n`;
      }
    }
    return fileText;
  }

  app.post("/api/message", upload.array("files"), async (req, res) => {
    try {
      metrics.ai_requests_total += 1;
      const userMessage = req.body.message?.trim() || "";
      const sessionId = getSessionId(req);
      const files = req.files || [];

      if (!userMessage && files.length === 0) {
        return res.json({ reply: "⚠️ Please write a message or attach a file." });
      }

      const fileText = await buildFileText(files, sessionId);
      const finalPrompt = fileText
        ? `${fileText.trim()}\n\n---\nUser asked: ${userMessage}`
        : userMessage;

      const route = typeof brain.getModelRoute === "function"
        ? brain.getModelRoute(finalPrompt, { fileSummary: fileText })
        : null;
      if (route) {
        trackRouteDecision(route);
        res.setHeader("x-model-route", route.route);
      }

      const reply = await brain.send(finalPrompt, sessionId, {
        route,
        metadata: { fileSummary: fileText },
      });
      return res.json({ reply });
    } catch (err) {
      metrics.ai_requests_failed_total += 1;
      console.error("❌ AI Error:", err);
      const statusCode = err.statusCode || 500;
      if (err.retryAfterSeconds) {
        res.setHeader("retry-after", String(err.retryAfterSeconds));
      }
      return res.status(statusCode).json({ error: err.message || "Vera failed to respond. Please try again." });
    }
  });

  app.post("/api/message-stream", upload.array("files"), async (req, res) => {
    try {
      metrics.ai_requests_total += 1;
      const userMessage = req.body.message?.trim() || "";
      const sessionId = getSessionId(req);
      const files = req.files || [];

      if (!userMessage && files.length === 0) {
        return res.status(400).json({ error: "⚠️ Message or file required." });
      }

      const fileText = await buildFileText(files, sessionId);
      const finalPrompt = fileText
        ? `${userMessage}\n\n---\n${fileText.trim()}`
        : userMessage;

      const route = typeof brain.getModelRoute === "function"
        ? brain.getModelRoute(finalPrompt, { fileSummary: fileText })
        : null;
      if (route) {
        trackRouteDecision(route);
        res.setHeader("x-model-route", route.route);
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const controller = {};
      req.on("close", () => {
        controller.cancel?.();
      });

      await brain.sendStream(
        userMessage,
        sessionId,
        (token) => {
          if (token === "[DONE]") {
            res.write("data: [DONE]\n\n");
          } else {
            res.write(`data: ${token}\n\n`);
            res.flush?.();
          }
        },
        controller,
        finalPrompt,
        {
          route,
          metadata: { fileSummary: fileText },
        }
      );
      return res.end();
    } catch (err) {
      metrics.ai_requests_failed_total += 1;
      console.error("❌ Streaming AI error:", err);
      const statusCode = err.statusCode || 500;
      if (!res.headersSent) {
        if (err.retryAfterSeconds) {
          res.setHeader("retry-after", String(err.retryAfterSeconds));
        }
        return res.status(statusCode).json({ error: err.message || "Streaming failed." });
      }
      res.write(`data: [Error] ${err.message || "Streaming failed."}\n\n`);
      res.end();
    }
  });

  app.post("/api/memory/delete", async (req, res) => {
    try {
      const { key } = req.body;
      if (!key) {
        return res.status(400).json({ error: "Missing key to delete." });
      }
      const success = await memoryApi.deleteFact(key);
      if (success) {
        return res.json({ success: true });
      }
      return res.status(404).json({ error: "Key not found." });
    } catch (err) {
      console.error("❌ Failed to delete memory:", err);
      return res.status(500).json({ error: "Failed to delete memory." });
    }
  });

  app.get("/api/memory/longterm", (req, res) => {
    const facts = memoryApi.getFacts();
    res.json(facts);
  });

  app.get("/api/retrieval/status", (req, res) => {
    return res.json(retrievalMemory.getStats());
  });

  app.post("/api/admin/backup", async (req, res) => {
    try {
      const backupPath = await createBackup();
      metrics.backups_created_total += 1;
      metrics.last_backup_at = new Date().toISOString();
      return res.json({ success: true, backupPath });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Backup failed." });
    }
  });

  app.post("/api/admin/restore-latest", async (req, res) => {
    try {
      const dryRun = Boolean(req.body?.dryRun);
      const requestedMaxAgeMs = Number(req.body?.maxAgeMs || 0);
      const validation = validateLatestBackup({
        maxAgeMs: requestedMaxAgeMs > 0 ? requestedMaxAgeMs : undefined,
      });
      if (!validation.valid) {
        return res.status(400).json({
          error: "Backup validation failed.",
          validation,
        });
      }
      if (dryRun) {
        return res.json({
          success: true,
          dryRun: true,
          validation,
        });
      }

      const ok = await restoreLatestBackup({
        maxAgeMs: requestedMaxAgeMs > 0 ? requestedMaxAgeMs : undefined,
      });
      if (!ok) {
        return res.status(404).json({ error: "No backup available." });
      }
      return res.json({ success: true, validation });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Restore failed." });
    }
  });

  app.get("/api/admin/backups/validate-latest", (req, res) => {
    const queryMaxAgeMs = Number(req.query.maxAgeMs || 0);
    const validation = validateLatestBackup({
      maxAgeMs: queryMaxAgeMs > 0 ? queryMaxAgeMs : undefined,
    });
    if (!validation.valid) {
      return res.status(400).json(validation);
    }
    return res.json(validation);
  });

  app.get("/api/admin/backups", (req, res) => {
    return res.json({ backups: listBackups() });
  });

  app.get("/health", (req, res) => {
    return res.json({
      status: "ok",
      uptimeSeconds: Math.floor((Date.now() - bootTime) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/ready", (req, res) => {
    const runtime = typeof brain.getRuntimeStatus === "function" ? brain.getRuntimeStatus() : { modelReady: true };
    if (!runtime.modelReady || runtime.circuitOpen || runtime.queueAvailable === false) {
      return res.status(503).json({
        status: "degraded",
        reason: "Model unavailable or saturated",
        runtime,
      });
    }
    return res.json({ status: "ready", runtime });
  });

  app.get("/metrics", (req, res) => {
    return res.json({
      ...metrics,
      avg_request_duration_ms:
        metrics.requests_total > 0 ? Math.round(metrics.request_duration_ms_total / metrics.requests_total) : 0,
      runtime: typeof brain.getRuntimeStatus === "function" ? brain.getRuntimeStatus() : null,
    });
  });

  app.get("/api/router/status", (req, res) => {
    const routerStatus =
      typeof brain.getRuntimeStatus === "function"
        ? brain.getRuntimeStatus().router
        : { enabled: false };
    return res.json({
      router: routerStatus,
      routeCounts: metrics.router_route_counts,
      lastDecision: metrics.router_last_decision,
    });
  });

  app.post("/api/tasks", async (req, res) => {
    try {
      const { type, payload } = req.body || {};
      if (!type) {
        return res.status(400).json({ error: "Task type is required." });
      }
      const taskId = await taskQueue.enqueueTask(type, payload || {});
      await taskQueue.addCheckpoint(taskId, { event: "task_created" });
      return res.status(202).json({ taskId, status: "queued" });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to enqueue task." });
    }
  });

  app.get("/api/tasks", (req, res) => {
    const limit = Number(req.query.limit || 50);
    return res.json({ tasks: taskQueue.listTasks(limit) });
  });

  app.get("/api/tasks/:id", (req, res) => {
    const task = taskQueue.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Task not found." });
    }
    return res.json(task);
  });

  app.post("/api/tasks/:id/checkpoint", async (req, res) => {
    const ok = await taskQueue.addCheckpoint(req.params.id, req.body || {});
    if (!ok) {
      return res.status(404).json({ error: "Task not found." });
    }
    return res.json({ success: true });
  });

  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      console.error("❌ Unhandled server error:", err);
      return res.status(500).json({ error: "Internal server error." });
    }
    return next();
  });

  if (BACKUP_INTERVAL_MS > 0) {
    const timer = setInterval(async () => {
      try {
        await createBackup();
        metrics.backups_created_total += 1;
        metrics.last_backup_at = new Date().toISOString();
      } catch (err) {
        console.error("❌ Scheduled backup failed:", err.message);
      }
    }, BACKUP_INTERVAL_MS);
    timer.unref?.();
  }

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(port, () => {
    console.log(`🧠 Vera Modular LLM server running at http://localhost:${port}`);
  });
}

module.exports = { createApp };
