const { spawn } = require("child_process");
const path = require("path");

const DEFAULT_MODEL_PATH = process.env.VERA_MODEL_PATH || path.join(__dirname, "../models/JSON-llama3-fp16.Q4_K_M.gguf");
const MAIN_BINARY = path.join(__dirname, "../build/bin/llama-cli");

function resolveModelPath(raw) {
  const candidate = String(raw || DEFAULT_MODEL_PATH);
  return path.isAbsolute(candidate) ? candidate : path.resolve(__dirname, "..", candidate);
}

function cleanModelOutput(text) {
  return String(text || "")
    .replace(/^```json/gm, "")
    .replace(/^```/gm, "")
    .replace(/^>+\s*/gm, "")
    .replace(/\u001b\[.*?m/g, "")
    .trim();
}

/**
 * One-shot inference (tool synthesis, verification). Uses the same binary layout as core/verabrain.js.
 * @param {string} prompt
 * @param {{ modelPath?: string, nPredict?: number }} [opts]
 */
function runLocalModel(prompt, opts = {}) {
  const modelPath = resolveModelPath(opts.modelPath);
  const nPredict = Number(opts.nPredict || process.env.VERA_LOCAL_INFER_N_PREDICT || 512);

  return new Promise((resolve, reject) => {
    const args = [
      "--model",
      modelPath,
      "--n-predict",
      String(nPredict),
      "--temp",
      String(opts.temp ?? process.env.VERA_LOCAL_INFER_TEMP ?? "0.35"),
      "--top-p",
      "0.9",
      "--top-k",
      "40",
      "--threads",
      String(opts.threads || process.env.VERA_LOCAL_INFER_THREADS || "8"),
      "--repeat-penalty",
      "1.1",
    ];

    const child = spawn(MAIN_BINARY, args);
    let output = "";
    let error = "";

    child.stdin.setDefaultEncoding?.("utf-8");
    child.stdout.setEncoding("utf-8");

    child.stdin.write(`${String(prompt || "").trim()}\n`);
    child.stdin.end();

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.stderr.on("data", (data) => {
      error += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Model exited with code ${code}: ${error || output}`));
      }
      resolve(cleanModelOutput(output));
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run llama-cli: ${err.message}`));
    });
  });
}

module.exports = { runLocalModel, resolveModelPath, MAIN_BINARY };
