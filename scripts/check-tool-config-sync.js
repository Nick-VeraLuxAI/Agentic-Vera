const fs = require("fs");
const path = require("path");
const { buildToolConfigJson } = require("../tools/manifest");

const configPath = path.join(__dirname, "..", "tools", "tool_config.json");
const expected = buildToolConfigJson();
let actual;
try {
  actual = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (err) {
  console.error("check-tool-config-sync: cannot read tool_config.json:", err.message);
  process.exit(1);
}

const a = JSON.stringify(expected, Object.keys(expected).sort());
const b = JSON.stringify(actual, Object.keys(actual).sort());
if (a !== b) {
  console.error("check-tool-config-sync: tools/tool_config.json is out of sync with tools/manifest.js");
  console.error("Run: npm run tools:sync-config");
  process.exit(1);
}
console.log("check-tool-config-sync: OK");
