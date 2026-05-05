import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  extractText,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-ocr-searchable");
const inputPath = path.join(workDir, "scanned-source.pdf");
const outputPath = path.join(workDir, "ocr-output.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });

const status = await ocrStatus();
if (!status.ok) {
  if (process.env.REQUIRE_OCR === "1") {
    throw new Error(`OCR runtime is required but unavailable: ${JSON.stringify(status)}`);
  }
  console.log(`Skipping OCR searchable test: ${status.errors.join("; ")}`);
  process.exit(0);
}

await createScannedPdf(inputPath);
const beforeText = await extractText(inputPath);
if (beforeText.trim()) {
  throw new Error(`scanned fixture unexpectedly contains text before OCR: ${beforeText}`);
}

const { stdout } = await runProcess("python3", [
  enginePath,
  "ocr",
  "--input",
  inputPath,
  "--output",
  outputPath,
  "--language",
  "eng",
  "--dpi",
  "220",
  "--force",
]);
const report = JSON.parse(stdout);
if (!report.ok || report.ocrPageCount !== 1 || !report.validation?.qpdfChecked) {
  throw new Error(`OCR report did not pass: ${JSON.stringify(report)}`);
}

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked || validation.textLength < 8) {
  throw new Error(`OCR output did not validate as searchable PDF: ${JSON.stringify(validation)}`);
}

const afterText = normalize(await extractText(outputPath));
for (const token of ["OCR", "TEST", "123"]) {
  if (!afterText.includes(token)) {
    throw new Error(`OCR text did not include ${token}: ${afterText}`);
  }
}

async function ocrStatus() {
  const { stdout } = await runProcess("python3", [
    enginePath,
    "ocr-status",
    "--language",
    "eng",
    "--stdout",
  ]);
  return JSON.parse(stdout);
}

async function createScannedPdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "text_doc = fitz.open()",
      "text_page = text_doc.new_page(width=612, height=792)",
      "text_page.insert_text((72, 220), 'OCR TEST 123', fontsize=56, fontname='helv')",
      "pix = text_page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)",
      "image_bytes = pix.tobytes('png')",
      "scan_doc = fitz.open()",
      "scan_page = scan_doc.new_page(width=612, height=792)",
      "scan_page.insert_image(scan_page.rect, stream=image_bytes)",
      "scan_doc.save(sys.argv[1], garbage=4, deflate=True, clean=True)",
      "scan_doc.close()",
      "text_doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

function normalize(value) {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}
