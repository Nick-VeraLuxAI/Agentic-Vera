const fs = require("fs");
const path = require("path");
const { embedText } = require("../memory/retrievalMemory");

const indexFile = process.env.VERA_RETRIEVAL_INDEX_FILE || path.join(__dirname, "..", "memory", "retrieval_index.json");

function run() {
  if (!fs.existsSync(indexFile)) {
    console.log(`No retrieval index found at ${indexFile}`);
    return;
  }
  const data = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  if (!data || typeof data !== "object" || !Array.isArray(data.documents)) {
    throw new Error("Invalid retrieval index format.");
  }

  let updated = 0;
  for (const doc of data.documents) {
    if (!Array.isArray(doc.embedding) || doc.embedding.length === 0) {
      doc.embedding = embedText(doc.text);
      updated += 1;
    }
  }

  fs.writeFileSync(indexFile, JSON.stringify(data, null, 2), "utf8");
  console.log(`Backfill complete. Updated ${updated} document(s) in ${indexFile}`);
}

try {
  run();
} catch (err) {
  console.error("Embedding backfill failed:", err.message);
  process.exit(1);
}
