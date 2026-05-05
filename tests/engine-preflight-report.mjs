import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  extractText,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-preflight-report");
const inputPath = path.join(workDir, "preflight-input.pdf");
const reportPath = path.join(workDir, "preflight-report.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createPreflightFixture(inputPath);

const { stdout } = await runProcess("python3", [
  enginePath,
  "preflight",
  "--input",
  inputPath,
  "--report",
  reportPath,
  "--stdout",
]);
const result = JSON.parse(stdout);
if (result.reportPath !== reportPath || !result.metadataPresent) {
  throw new Error(`preflight report command did not return expected diagnostics: ${JSON.stringify(result)}`);
}
const validation = await validatePdf(reportPath);
if (!validation.ok || !validation.qpdfChecked || validation.pageCount !== 1) {
  throw new Error(`preflight report PDF did not validate: ${JSON.stringify(validation)}`);
}
const reportText = await extractText(reportPath);
if (!reportText.includes("PDF Preflight Report") || !reportText.includes("document metadata is present")) {
  throw new Error(`preflight report PDF did not contain expected warning: ${reportText}`);
}

async function createPreflightFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Preflight report fixture', fontsize=18)",
      "doc.set_metadata({'title': 'Preflight Metadata Signal'})",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}
