const fs = require("fs");
const path = require("path");
const { runLocalModel } = require("../tools/localInfer");

const identityPath = path.join(__dirname, "../prompts/memoryIdentity.md");
const systemInstruction = fs.readFileSync(identityPath, "utf-8").trim();

function parseMetadata(text) {
  const result = {};
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.includes(":")) continue;

    const [key, ...rest] = trimmed.split(":");
    const cleanKey = key.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (["type", "subject", "sentiment", "confidence", "original", "text"].includes(cleanKey)) {
      result[cleanKey] = value;
    }
  }

  if (result.confidence) {
    const num = parseFloat(result.confidence);
    if (!isNaN(num)) result.confidence = num;
  }

  return result;
}

async function runMemorySummarizer(rawFact) {
  const prompt = `

${systemInstruction}

Sentence: ${rawFact}

`.trim();

  console.log("🧪 Final Prompt Sent:\n", prompt);

  try {
    const result = await runLocalModel(prompt);
    console.log("🧠 Raw Output from Model:\n", result);

    const parsed = parseMetadata(result);
    if (!parsed.type || !parsed.subject || !parsed.text) {
      console.warn("⚠️ Incomplete metadata, skipping:", parsed);
      console.warn("🔎 Raw model output was:\n", result);
      return null;
    }
    return parsed;

  } catch (err) {
    console.error("🧠 Summarizer error:", err);
    return null;
  }
}

module.exports = { runMemorySummarizer };
