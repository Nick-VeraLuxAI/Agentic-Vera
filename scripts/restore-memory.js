const { restoreLatestBackup, validateLatestBackup } = require("../memory/backupManager");

(async () => {
  try {
    const dryRun = process.argv.includes("--dry-run");
    const maxAgeArg = process.argv.find((arg) => arg.startsWith("--max-age-ms="));
    const maxAgeMs = maxAgeArg ? Number(maxAgeArg.split("=")[1]) : undefined;
    const validation = validateLatestBackup({
      maxAgeMs: Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : undefined,
    });
    if (!validation.valid) {
      console.error("Backup validation failed:", validation.errors?.join("; ") || "unknown error");
      process.exit(1);
    }

    if (dryRun) {
      console.log(`Dry-run OK for backup: ${validation.backupName}`);
      console.log(`Checked files: ${validation.checkedFiles}`);
      process.exit(0);
    }

    const ok = await restoreLatestBackup({
      maxAgeMs: Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : undefined,
    });
    if (!ok) {
      console.error("No backup available to restore.");
      process.exit(1);
    }
    console.log("Restored latest memory backup.");
  } catch (err) {
    console.error("Restore failed:", err.message);
    process.exit(1);
  }
})();
