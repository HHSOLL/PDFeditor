import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  extractText,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-compare");
const leftPath = path.join(workDir, "compare-left.pdf");
const rightPath = path.join(workDir, "compare-right.pdf");
const reportPath = path.join(workDir, "compare-report.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createCompareFixture(leftPath, "Contract amount: 1000 USD", "Stable appendix");
await createCompareFixture(rightPath, "Contract amount: 1200 USD", "Stable appendix");

const { stdout } = await runProcess("python3", [
  enginePath,
  "compare",
  "--input",
  leftPath,
  "--other",
  rightPath,
  "--report",
  reportPath,
  "--stdout",
]);
const result = JSON.parse(stdout);

if (!result.ok) {
  throw new Error(`compare command failed: ${JSON.stringify(result)}`);
}
if (result.leftPageCount !== 2 || result.rightPageCount !== 2 || result.pageCountChanged) {
  throw new Error(`compare page count metrics are wrong: ${JSON.stringify(result)}`);
}
if (result.changedPageCount !== 1 || result.changedPages[0] !== 0) {
  throw new Error(`expected only page 0 to be changed: ${JSON.stringify(result)}`);
}
if (!result.textChanges[0]?.leftPreview.includes("1000") || !result.textChanges[0]?.rightPreview.includes("1200")) {
  throw new Error(`text diff previews did not include old/new values: ${JSON.stringify(result.textChanges)}`);
}
if (!result.renderChanges.some((change) => change.pageIndex === 0 && change.meanPixelDelta > 0)) {
  throw new Error(`render diff did not detect changed page: ${JSON.stringify(result.renderChanges)}`);
}
const changedRegion = result.renderChanges.find((change) => change.pageIndex === 0)?.changedRegion;
if (!Array.isArray(changedRegion) || changedRegion.length !== 4 || changedRegion[2] <= changedRegion[0]) {
  throw new Error(`render diff did not return a changed-area region: ${JSON.stringify(result.renderChanges)}`);
}
if (result.reportPath !== reportPath) {
  throw new Error(`compare report path was not returned: ${JSON.stringify(result)}`);
}
const reportValidation = await validatePdf(reportPath);
if (!reportValidation.ok || !reportValidation.qpdfChecked || reportValidation.pageCount !== 1) {
  throw new Error(`compare report PDF did not validate: ${JSON.stringify(reportValidation)}`);
}
const reportText = await extractText(reportPath);
if (!reportText.includes("PDF Compare Report") || !reportText.includes("1000") || !reportText.includes("1200")) {
  throw new Error(`compare report PDF did not contain expected summary text: ${reportText}`);
}

async function createCompareFixture(filePath, firstPageText, secondPageText) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), sys.argv[2], fontsize=20)",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), sys.argv[3], fontsize=20)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
    firstPageText,
    secondPageText,
  ]);
}
