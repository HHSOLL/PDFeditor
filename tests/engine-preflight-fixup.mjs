import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  extractText,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-preflight-fixup");
const inputPath = path.join(workDir, "source.pdf");
const outputPath = path.join(workDir, "fixed.pdf");

await ensureGhostscriptOrSkip();
await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createSourcePdf(inputPath);

const { stdout } = await runProcess("python3", [
  enginePath,
  "preflight-fixup",
  "--input",
  inputPath,
  "--output",
  outputPath,
  "--stdout",
]);
const result = JSON.parse(stdout);
if (!result.ok || !result.report?.after?.pdfxValidation?.passed) {
  throw new Error(`preflight fixup did not report PDF/X pass: ${JSON.stringify(result.report)}`);
}
if (!result.report.fixup.engineVersion || result.report.fixup.engine !== "ghostscript") {
  throw new Error(`preflight fixup did not report Ghostscript evidence: ${JSON.stringify(result.report.fixup)}`);
}

const outputBytes = Buffer.from(result.pdfBase64, "base64");
const writtenBytes = await fs.readFile(outputPath);
if (!writtenBytes.equals(outputBytes)) {
  throw new Error("stdout pdfBase64 and --output bytes diverged");
}

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked || validation.textLength < 20) {
  throw new Error(`fixed PDF failed qpdf/PyMuPDF validation: ${JSON.stringify(validation)}`);
}

const text = await extractText(outputPath);
if (!text.includes("Preflight fixup preserves searchable vector text")) {
  throw new Error(`fixed PDF should preserve searchable text, not rasterize the page: ${text}`);
}

const { stdout: preflightStdout } = await runProcess("python3", [
  enginePath,
  "preflight",
  "--input",
  outputPath,
  "--stdout",
]);
const preflight = JSON.parse(preflightStdout);
if (preflight.pdfxClaim !== "PDF/X-3:2002" || preflight.outputIntentCount < 1 || !preflight.pdfxValidation?.passed) {
  throw new Error(`fixed PDF did not remain PDF/X-3 after reopen: ${JSON.stringify(preflight.pdfxValidation)}`);
}

async function createSourcePdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 120), 'Preflight fixup preserves searchable vector text', fontsize=18)",
      "page.draw_rect(fitz.Rect(72, 150, 220, 210), color=(0, 0, 0), fill=None, width=1)",
      "doc.save(sys.argv[1], garbage=4, deflate=True)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function ensureGhostscriptOrSkip() {
  try {
    await runProcess(process.env.GHOSTSCRIPT_BIN || "gs", ["--version"]);
  } catch (error) {
    if (process.env.REQUIRE_PREFLIGHT_FIXUP === "1") {
      throw error;
    }
    console.log("Skipping preflight fixup because Ghostscript is not installed.");
    process.exit(0);
  }
}
