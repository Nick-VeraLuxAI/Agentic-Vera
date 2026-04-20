const { spawn } = require("child_process");
const path = require("path");

const MODEL_PATH = path.join(__dirname, "../models/JSON-llama3-fp16.Q4_K_M.gguf");
const MAIN_BINARY = path.join(__dirname, "../main"); // or wherever `llama-cli` was copied

// ✅ Output sanitizer
function cleanModelOutput(text) {
  const cleaned = text
    .replace(/^```json/gm, "")
    .replace(/^```/gm, "")
    .replace(/^>+\s*/gm, "")
    .replace(/\u001b\[.*?m/g, "")  // Remove ANSI color codes
    .trim();

  // 🧠 Attempt to extract just the JSON object from noisy output
  const jsonMatch = cleaned.match(/{[\s\S]+?}/);
  if (jsonMatch) return jsonMatch[0];

  return cleaned;
}

function runLocalModel(prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      "--model", MODEL_PATH,
      "--n-predict", "256",
      "--temp", "0.2",
      "--top-p", "0.9",
      "--top-k", "40",
      "--threads", "8",
      "--repeat-penalty", "1.1"
    ];
    

    const child = spawn(MAIN_BINARY, args);

    let output = "";
    let error = "";

    console.log("🧪 Final Prompt Being Sent:\n", prompt);

    child.stdin.write(`${prompt.trim()}\n\n`);
    child.stdin.end();

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.stderr.on("data", (data) => {
      error += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`❌ Model exited with code ${code}:\n${error}`));
      }

      resolve(cleanModelOutput(output));
    });

    child.on("error", (err) => {
      reject(new Error(`❌ Failed to run subprocess: ${err.message}`));
    });
  });
}

module.exports = { runLocalModel };
