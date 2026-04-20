const fs = require("fs");
const path = require("path");

const datasetFile = process.env.VERA_FINETUNE_DATASET_FILE || path.join(__dirname, "..", "training", "dataset.jsonl");
const outputDir = process.env.VERA_FINETUNE_OUTPUT_DIR || path.join(__dirname, "..", "training", "artifacts");
const baseModel = process.env.VERA_FINETUNE_BASE_MODEL || path.join(__dirname, "..", "models", "JSON-llama3-fp16.Q4_K_M.gguf");

if (!fs.existsSync(datasetFile)) {
  console.error("Fine-tune dataset not found. Run: npm run prepare:finetune-dataset");
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

console.log("Offline fine-tune pipeline scaffold");
console.log(`Dataset: ${datasetFile}`);
console.log(`Base model: ${baseModel}`);
console.log(`Output dir: ${outputDir}`);
console.log("");
console.log("Next step:");
console.log("Run your local trainer with this dataset and write resulting adapters/checkpoints into output dir.");
console.log("Example (placeholder):");
console.log(`python train_lora.py --base-model "${baseModel}" --dataset "${datasetFile}" --out "${outputDir}"`);
