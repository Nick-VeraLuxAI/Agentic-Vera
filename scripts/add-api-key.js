#!/usr/bin/env node
/**
 * Register a scoped API key in SQLite (hashed with VERA_API_KEY_PEPPER).
 * Usage: node scripts/add-api-key.js <label> <scope1,scope2,...>
 * Then paste the raw key on stdin (one line).
 *
 * Scopes: admin | memory | tasks | hooks
 */
const readline = require("readline");
const { addKey } = require("../memory/apiKeyStore");

const label = process.argv[2] || "cli";
const scopesArg = process.argv[3] || "memory";
const scopes = scopesArg.split(",").map((s) => s.trim()).filter(Boolean);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Paste raw API key (hidden): ", (raw) => {
  rl.close();
  const key = String(raw || "").trim();
  if (key.length < 8) {
    console.error("Key too short.");
    process.exit(1);
  }
  const id = addKey(key, label, scopes);
  console.log(`Stored key id=${id} label=${label} scopes=${scopes.join(",")}`);
  console.log("Save the raw key securely; it cannot be retrieved from the database.");
});
