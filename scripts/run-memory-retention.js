const { applyRetentionPolicy } = require("../memory/retention");

try {
  const result = applyRetentionPolicy();
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error("Retention failed:", err.message);
  process.exit(1);
}
