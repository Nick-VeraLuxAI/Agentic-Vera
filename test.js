const { runLocalModel } = require("./tools/localInfer");

(async () => {
  const prompt = `
You are a labeling assistant. Output the information below in key-value format.

Sentence: Please remember I love grapes

Type:
Subject:
Sentiment:
Confidence:
Original:
Text:
`.trim();

  const output = await runLocalModel(prompt);
  console.log("\n🧠 Final Model Output:\n" + output);
})();
