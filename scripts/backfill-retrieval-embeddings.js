const { getDb } = require("../memory/db");
const { embedText } = require("../memory/embeddings");
const { embedChunkForIndexAsync, getEmbeddingFingerprint } = require("../memory/embeddingProvider");

async function run() {
  const db = getDb();
  const useHttp = String(process.env.VERA_EMBEDDING_HTTP_URL || "").trim();
  const fpTarget = getEmbeddingFingerprint();
  const fpHashFallback = `hash:${Number(process.env.VERA_RETRIEVAL_EMBED_DIM || 128)}`;
  const rows = db.prepare(`SELECT id, text, embedding, embedding_fp FROM chunks`).all();
  const update = db.prepare(`UPDATE chunks SET embedding = ?, embedding_fp = ? WHERE id = ?`);

  let updated = 0;
  for (const row of rows) {
    let needs = true;
    if (row.embedding && row.embedding_fp === fpTarget) {
      try {
        const parsed = JSON.parse(row.embedding);
        if (Array.isArray(parsed) && parsed.length) needs = false;
      } catch (_e) {
        needs = true;
      }
    }
    if (!needs) continue;

    let emb = null;
    let fpRow = fpTarget;
    try {
      emb = useHttp ? await embedChunkForIndexAsync(row.text) : embedText(row.text);
    } catch (err) {
      console.warn(`Chunk ${row.id}: HTTP embed failed (${err.message}), using hash.`);
      emb = embedText(row.text);
      fpRow = fpHashFallback;
    }
    if (!emb) continue;
    update.run(JSON.stringify(emb), fpRow, row.id);
    updated += 1;
  }

  console.log(`Embedding backfill complete. Updated ${updated} chunk(s). Fingerprint target: ${fpTarget}`);
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error("Embedding backfill failed:", err.message);
    process.exit(1);
  }
})();
