import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  enginePath,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-accessibility-report");
const inputPath = path.join(workDir, "accessibility-source.pdf");
const outputPath = path.join(workDir, "accessibility-output.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createAccessibilityFixture(inputPath);
await applyEngine(inputPath, outputPath, {
  metadata: {
    title: "Accessible Contract Draft",
    language: "ko-KR",
  },
  saveOptions: { annotationMode: "flatten", redactionMode: "textOnly", validate: true },
  operations: [],
}, "accessibility-report");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`accessibility output did not validate: ${JSON.stringify(validation)}`);
}

const { stdout } = await runProcess("python3", [
  enginePath,
  "accessibility",
  "--input",
  outputPath,
  "--stdout",
]);
const report = JSON.parse(stdout);
if (!report.titlePresent || report.language !== "ko-KR") {
  throw new Error(`accessibility report did not see title/language: ${JSON.stringify(report)}`);
}
if (!report.warnings.includes("tag tree is missing")) {
  throw new Error(`accessibility report should still mark missing tag tree as a gap: ${JSON.stringify(report)}`);
}

async function createAccessibilityFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Accessibility report fixture', fontsize=18)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}
