#!/usr/bin/env node
/**
 * Minimal admin CLI: health, ready, metrics (GET only; localhost by default).
 * Usage: node scripts/vera-cli.js health [--url http://127.0.0.1:3000]
 */
const http = require("http");
const https = require("https");

const argv = process.argv.slice(2);
const urlIdx = argv.indexOf("--url");
const base = urlIdx >= 0 && argv[urlIdx + 1] ? argv[urlIdx + 1].replace(/\/$/, "") : "http://127.0.0.1:3000";
const cmd = argv[0] || "health";

function get(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      u,
      { method: "GET", headers: { Accept: "application/json" } },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(body) });
          } catch (_e) {
            resolve({ status: res.statusCode, text: body });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const path =
    cmd === "ready"
      ? "/ready"
      : cmd === "metrics"
        ? "/metrics"
        : cmd === "router"
          ? "/api/router/status"
          : "/health";
  const out = await get(path);
  process.stdout.write(`${JSON.stringify(out.json || { status: out.status, body: out.text }, null, 2)}\n`);
  if (out.status && out.status >= 400) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
