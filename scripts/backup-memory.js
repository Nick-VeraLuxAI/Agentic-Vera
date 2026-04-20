const path = require("path");
const { createBackup } = require("../memory/backupManager");

(async () => {
  try {
    const backupPath = await createBackup();
    console.log(`Backup created at ${path.relative(process.cwd(), backupPath)}`);
  } catch (err) {
    console.error("Backup failed:", err.message);
    process.exit(1);
  }
})();
