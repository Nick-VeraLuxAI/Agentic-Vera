const { send } = require("./core/verabrain");
const { getFacts } = require("./memory/longTermMemory");
const { loadMemory } = require("./memory/shortTermMemory");

(async () => {
  const testSessionId = `smoke-${Date.now()}`;
  const testMessage = "Please remember I don’t like loud noises.";

  console.log("🚬 Smoke Test: Sending message to Vera...");

  try {
    const reply = await send(testMessage, testSessionId);
    console.log("✅ Response received:", reply);

    const memory = loadMemory(testSessionId);
    console.log("🧠 Short-term memory saved:", memory.length > 0);

    const facts = getFacts();
    const matched = facts.find(f =>
      typeof f === "object" &&
      typeof f.text === "string" &&
      f.text.toLowerCase().includes("don’t like loud noises")
    );
    console.log("🗃️ Long-term fact stored:", !!matched);

    console.log("🎉 Smoke test completed successfully.");
  } catch (err) {
    console.error("🔥 Smoke test failed:", err.message);
    process.exit(1);
  }
})();
