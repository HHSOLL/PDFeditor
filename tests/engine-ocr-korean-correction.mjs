import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  extractText,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-ocr-korean-correction");
const inputPath = path.join(workDir, "korean-scan.pdf");
const ocrPath = path.join(workDir, "korean-ocr.pdf");
const correctedPath = path.join(workDir, "korean-corrected.pdf");
const correctionsPath = path.join(workDir, "corrections.json");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });

const status = await ocrStatus();
if (!status.ok) {
  if (process.env.REQUIRE_OCR === "1") {
    throw new Error(`Korean OCR runtime is required but unavailable: ${JSON.stringify(status)}`);
  }
  console.log(`Skipping Korean OCR correction test: ${status.errors.join("; ")}`);
  process.exit(0);
}

await createKoreanScannedPdf(inputPath);
const beforeText = await extractText(inputPath);
if (beforeText.trim()) {
  throw new Error(`Korean scanned fixture unexpectedly contains text before OCR: ${beforeText}`);
}

const { stdout } = await runProcess("python3", [
  enginePath,
  "ocr",
  "--input",
  inputPath,
  "--output",
  ocrPath,
  "--language",
  "kor+eng",
  "--dpi",
  "260",
  "--force",
]);
const report = JSON.parse(stdout);
if (!report.ok || report.ocrPageCount !== 1 || !report.validation?.qpdfChecked) {
  throw new Error(`Korean OCR report did not pass: ${JSON.stringify(report)}`);
}

const ocrText = normalize(await extractText(ocrPath));
if (!ocrText.includes("계약서") || !ocrText.includes("123")) {
  throw new Error(`Korean OCR did not produce expected searchable tokens: ${ocrText}`);
}

await fs.writeFile(
  correctionsPath,
  JSON.stringify([
    {
      pageIndex: 0,
      x: 70 / 612,
      y: 180 / 792,
      width: 470 / 612,
      height: 110 / 792,
      text: "한글 계약서 456",
      fontSize: 28,
    },
  ]),
);

const { stdout: correctionStdout } = await runProcess("python3", [
  enginePath,
  "ocr-correct",
  "--input",
  ocrPath,
  "--output",
  correctedPath,
  "--corrections",
  correctionsPath,
  "--dpi",
  "220",
]);
const correctionReport = JSON.parse(correctionStdout);
if (!correctionReport.ok || correctionReport.correctedPageCount !== 1 || !correctionReport.validation?.qpdfChecked) {
  throw new Error(`OCR correction report did not pass: ${JSON.stringify(correctionReport)}`);
}

const validation = await validatePdf(correctedPath);
if (!validation.ok || !validation.qpdfChecked || validation.textLength < 6) {
  throw new Error(`OCR-corrected PDF failed validation: ${JSON.stringify(validation)}`);
}

const correctedText = normalize(await extractText(correctedPath));
for (const token of ["한글", "계약서", "456"]) {
  if (!correctedText.includes(token)) {
    throw new Error(`OCR correction did not expose ${token}: ${correctedText}`);
  }
}
if (correctedText.includes("123")) {
  throw new Error(`OCR correction should replace stale OCR text layer instead of appending to it: ${correctedText}`);
}

async function ocrStatus() {
  const { stdout } = await runProcess("python3", [
    enginePath,
    "ocr-status",
    "--language",
    "kor+eng",
    "--stdout",
  ]);
  return JSON.parse(stdout);
}

async function createKoreanScannedPdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, pathlib, sys",
      "root = pathlib.Path(sys.argv[2])",
      "font = root / 'public' / 'fonts' / 'AppleGothic.ttf'",
      "text_doc = fitz.open()",
      "text_page = text_doc.new_page(width=612, height=792)",
      "text_page.insert_text((72, 220), '한글 계약서 123', fontsize=60, fontname='apple', fontfile=str(font))",
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
    root,
  ]);
}

function normalize(value) {
  return value.replace(/\s+/g, " ").trim();
}
