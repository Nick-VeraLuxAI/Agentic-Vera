const path = require("path");
const { writeExportFile } = require("../memory/exportSnapshot");

const outPath = process.argv[2] || path.join(__dirname, "..", "memory", "export_snapshot.json");

try {
  const written = writeExportFile(outPath);
  console.log(`Wrote memory export: ${written}`);
} catch (err) {
  console.error("Export failed:", err.message);
  process.exit(1);
}
