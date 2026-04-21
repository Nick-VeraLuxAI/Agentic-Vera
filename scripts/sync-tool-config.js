const fs = require("fs");
const path = require("path");
const { buildToolConfigJson } = require("../tools/manifest");

const out = path.join(__dirname, "..", "tools", "tool_config.json");
fs.writeFileSync(out, `${JSON.stringify(buildToolConfigJson(), null, 2)}\n`, "utf8");
console.log(`Wrote ${out} (generated from tools/manifest.js)`);
