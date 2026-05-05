import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  extractText,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-pdfx-validation");
const inputPath = path.join(workDir, "source.pdf");
const fixedPath = path.join(workDir, "fixed-pdfx3.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createSourcePdf(inputPath);

const sourceReport = await preflight(inputPath);
if (sourceReport.pdfxValidation?.passed) {
  throw new Error(`plain source should not pass PDF/X validation: ${JSON.stringify(sourceReport.pdfxValidation)}`);
}
if (!sourceReport.pdfxValidation?.errors?.includes("PDF/X claim is missing")) {
  throw new Error(`missing PDF/X claim was not diagnosed: ${JSON.stringify(sourceReport.pdfxValidation)}`);
}

await ensureGhostscriptOrSkip();
await runProcess("python3", [
  enginePath,
  "preflight-fixup",
  "--input",
  inputPath,
  "--output",
  fixedPath,
]);

const fixedValidation = await validatePdf(fixedPath);
if (!fixedValidation.ok || !fixedValidation.qpdfChecked || fixedValidation.pageCount !== 1) {
  throw new Error(`PDF/X fixup output did not validate structurally: ${JSON.stringify(fixedValidation)}`);
}

const fixedReport = await preflight(fixedPath);
if (fixedReport.pdfxClaim !== "PDF/X-3:2002") {
  throw new Error(`PDF/X-3 claim was not detected: ${JSON.stringify(fixedReport)}`);
}
if (!fixedReport.pdfxValidation?.passed || fixedReport.pdfxValidation.outputIntentCount < 1) {
  throw new Error(`PDF/X structural validation did not pass: ${JSON.stringify(fixedReport.pdfxValidation)}`);
}
const text = await extractText(fixedPath);
if (!text.includes("PDF/X validation fixture searchable text")) {
  throw new Error(`PDF/X fixup did not preserve searchable text: ${text}`);
}

async function createSourcePdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 120), 'PDF/X validation fixture searchable text', fontsize=18)",
      "doc.save(sys.argv[1], garbage=4, deflate=True)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function preflight(filePath) {
  const { stdout } = await runProcess("python3", [
    enginePath,
    "preflight",
    "--input",
    filePath,
    "--stdout",
  ]);
  return JSON.parse(stdout);
}

async function ensureGhostscriptOrSkip() {
  try {
    await runProcess(process.env.GHOSTSCRIPT_BIN || "gs", ["--version"]);
  } catch (error) {
    if (process.env.REQUIRE_PREFLIGHT_FIXUP === "1") {
      throw error;
    }
    console.log("Skipping PDF/X fixup validation because Ghostscript is not installed.");
    process.exit(0);
  }
}
