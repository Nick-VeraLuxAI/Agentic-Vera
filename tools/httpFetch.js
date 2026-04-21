const http = require("http");
const https = require("https");
const { URL } = require("url");

const ENABLED = String(process.env.VERA_HTTP_FETCH_ENABLED || "false").toLowerCase() === "true";
const MAX_BYTES = Number(process.env.VERA_HTTP_FETCH_MAX_BYTES || 500000);
const TIMEOUT_MS = Number(process.env.VERA_HTTP_FETCH_TIMEOUT_MS || 15000);

function parseAllowlist() {
  const raw = String(process.env.VERA_HTTP_FETCH_ALLOWLIST || "localhost,127.0.0.1,example.com").trim();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function httpFetch(urlString) {
  if (!ENABLED) {
    return Promise.resolve({ ok: false, error: "http_fetch is disabled. Set VERA_HTTP_FETCH_ENABLED=true and configure VERA_HTTP_FETCH_ALLOWLIST." });
  }
  let u;
  try {
    u = new URL(urlString);
  } catch (_e) {
    return Promise.resolve({ ok: false, error: "Invalid URL." });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return Promise.resolve({ ok: false, error: "Only http(s) URLs are allowed." });
  }
  const allow = parseAllowlist();
  const host = u.hostname.toLowerCase();
  if (!allow.has(host)) {
    return Promise.resolve({
      ok: false,
      error: `Host '${host}' is not in VERA_HTTP_FETCH_ALLOWLIST.`,
    });
  }

  const lib = u.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    const req = lib.request(
      u,
      {
        method: "GET",
        timeout: TIMEOUT_MS,
        headers: { "user-agent": "Agentic-Vera-http_fetch/1.0" },
      },
      (res) => {
        let buf = Buffer.alloc(0);
        res.on("data", (chunk) => {
          if (buf.length + chunk.length > MAX_BYTES) {
            res.destroy();
            resolve({ ok: false, error: `Response exceeded ${MAX_BYTES} bytes.` });
            return;
          }
          buf = Buffer.concat([buf, chunk]);
        });
        res.on("end", () => {
          const text = buf.toString("utf8");
          resolve({
            ok: true,
            statusCode: res.statusCode,
            headers: res.headers,
            body: text.slice(0, MAX_BYTES),
            truncated: text.length > MAX_BYTES,
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "Request timed out." });
    });
    req.on("error", (err) => {
      resolve({ ok: false, error: err.message || "request failed" });
    });
    req.end();
  });
}

module.exports = { httpFetch, ENABLED };
