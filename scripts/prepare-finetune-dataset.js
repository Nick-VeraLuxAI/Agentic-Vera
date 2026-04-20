const path = require("path");
const { buildDataset, writeDatasetJsonl } = require("../training/fineTuneDataset");

const includeUnapproved = process.argv.includes("--include-unapproved");
const maxArg = process.argv.find((arg) => arg.startsWith("--max-examples="));
const maxExamples = maxArg ? Number(maxArg.split("=")[1]) : undefined;

try {
  const examples = buildDataset({
    approvedOnly: !includeUnapproved,
    maxExamples: Number.isFinite(maxExamples) && maxExamples > 0 ? maxExamples : undefined,
  });
  const outputFile = writeDatasetJsonl(examples);
  console.log(`Prepared ${examples.length} fine-tune examples.`);
  console.log(`Dataset path: ${path.relative(process.cwd(), outputFile)}`);
} catch (err) {
  console.error("Failed to prepare fine-tune dataset:", err.message);
  process.exit(1);
}
