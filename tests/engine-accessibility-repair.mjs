import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-accessibility-repair");
const inputPath = path.join(workDir, "accessibility-source.pdf");
const outputPath = path.join(workDir, "accessibility-repaired.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createImageFixture(inputPath);

const before = await accessibilityReport(inputPath);
if (before.titlePresent || before.language || before.tagged || before.imageAltTextCount !== 0) {
  throw new Error(`accessibility fixture should start with missing title/language/tags/alt text: ${JSON.stringify(before)}`);
}

const { stdout } = await runProcess("python3", [
  enginePath,
  "accessibility-repair",
  "--input",
  inputPath,
  "--output",
  outputPath,
  "--title",
  "Accessible Image Contract",
  "--language",
  "ko-KR",
  "--alt-text-json",
  JSON.stringify([{ pageIndex: 0, imageIndex: 0, altText: "Company seal image" }]),
]);
const repairReport = JSON.parse(stdout);
if (!repairReport.ok || repairReport.appliedAltTextCount !== 1) {
  throw new Error(`accessibility repair should clear basic report warnings: ${JSON.stringify(repairReport)}`);
}

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`accessibility-repaired PDF failed validation: ${JSON.stringify(validation)}`);
}

const after = await accessibilityReport(outputPath);
if (!after.titlePresent || after.language !== "ko-KR" || !after.tagged || after.imageAltTextCount !== after.imageCount) {
  throw new Error(`accessibility repair did not persist title/language/tagged/alt-text signals: ${JSON.stringify(after)}`);
}

async function accessibilityReport(filePath) {
  const { stdout } = await runProcess("python3", [
    enginePath,
    "accessibility",
    "--input",
    filePath,
    "--stdout",
  ]);
  return JSON.parse(stdout);
}

async function createImageFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "image_doc = fitz.open()",
      "image_page = image_doc.new_page(width=180, height=90)",
      "image_page.draw_rect(fitz.Rect(0, 0, 180, 90), color=(0.1, 0.3, 0.7), fill=(0.8, 0.9, 1), width=2)",
      "image_page.insert_text((18, 52), 'SEAL', fontsize=30, fontname='helv')",
      "pix = image_page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)",
      "image_bytes = pix.tobytes('png')",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_image(fitz.Rect(72, 120, 252, 210), stream=image_bytes, keep_proportion=False)",
      "doc.save(sys.argv[1], garbage=4, deflate=True, clean=True)",
      "doc.close()",
      "image_doc.close()",
    ].join("\n"),
    filePath,
  ]);
}
