import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  extractText,
  inspectPdf,
  renderDiffMetrics,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const root = process.cwd();
const sourcePath = path.join(root, "ex.pdf");
const workDir = path.join(root, "tmp", "ex-pdf-regression");
const outputPath = path.join(workDir, "ex-edited.pdf");
const imageDeletedPath = path.join(workDir, "ex-image-deleted.pdf");
const targetTitle = "Synthetic Computers at Scale for Long-Horizon Productivity Simulation";
const replacementTitle = "EX PDF 엔진 검증 제목";

await fs.access(sourcePath);
await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });

const sourceInfo = await inspectPdf(sourcePath);
if (sourceInfo.pageCount !== 33) {
  throw new Error(`ex.pdf page count changed unexpectedly: ${sourceInfo.pageCount}`);
}
const extracted = await extractEngineDocument(sourcePath);
const firstPageImage = extracted.pages[0]?.images
  ?.slice()
  .sort((left, right) => right.width * right.height - left.width * left.height)[0];
if (!firstPageImage) {
  throw new Error("ex.pdf first page has no extractable source image candidate");
}
const titleRect = await findTextRect(sourcePath, targetTitle);
const page = sourceInfo.pages[0];
const editRegion = {
  x: Math.max(0, (titleRect.x0 - 4) / page.width),
  y: Math.max(0, (titleRect.y0 - 6) / page.height),
  width: Math.min(1, (titleRect.x1 - titleRect.x0 + 8) / page.width),
  height: Math.min(1, (titleRect.y1 - titleRect.y0 + 22) / page.height),
};

await applyEngine(sourcePath, outputPath, {
  pages: Array.from({ length: sourceInfo.pageCount }, (_, index) => ({
    sourceIndex: index,
    rotation: 0,
  })),
  operations: [
    {
      type: "text",
      pageIndex: 0,
      x: editRegion.x,
      y: editRegion.y,
      width: editRegion.width,
      height: editRegion.height,
      text: replacementTitle,
      fontSize: 15,
      fontFamily: "AppleGothic",
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
      lineHeight: 1.25,
      eraseOriginal: editRegion,
    },
  ],
  metadata: {
    title: "ex.pdf regression output",
    author: "PDF Studio",
    subject: "ex.pdf direct verification",
    keywords: "pdf,editor,ex",
    creator: "PDF Studio",
    producer: "PDF Studio Engine",
  },
  saveOptions: {
    annotationMode: "flatten",
    redactionMode: "textOnly",
    validate: true,
  },
}, "ex-title-edit");

const validation = await validatePdf(outputPath);
if (!validation.ok || validation.pageCount !== 33 || !validation.qpdfChecked) {
  throw new Error(`ex.pdf validation failed: ${JSON.stringify(validation)}`);
}

const editedText = await extractText(outputPath);
if (!editedText.includes(replacementTitle)) {
  throw new Error("ex.pdf replacement title is not extractable after export");
}
if (editedText.includes(targetTitle)) {
  throw new Error("ex.pdf original title is still extractable after replacement");
}

const outputInfo = await inspectPdf(outputPath);
if (outputInfo.pages[0].images < page.images) {
  throw new Error(`ex.pdf page 1 images were unexpectedly lost: ${page.images} -> ${outputInfo.pages[0].images}`);
}
if (outputInfo.pages.some((entry, index) => entry.width !== sourceInfo.pages[index].width || entry.height !== sourceInfo.pages[index].height)) {
  throw new Error("ex.pdf page sizes changed during roundtrip");
}

const diff = await renderDiffMetrics(sourcePath, outputPath, editRegion);
if (diff.insideMean <= 0.5) {
  throw new Error(`ex.pdf edit region did not visibly change: ${JSON.stringify(diff)}`);
}
if (diff.outsideMean >= 2.0) {
  throw new Error(`ex.pdf export changed too much outside the edited title region: ${JSON.stringify(diff)}`);
}

await applyEngine(sourcePath, imageDeletedPath, {
  pages: Array.from({ length: sourceInfo.pageCount }, (_, index) => ({
    sourceIndex: index,
    rotation: 0,
  })),
  operations: [
    {
      type: "deleteImage",
      pageIndex: 0,
      x: firstPageImage.x,
      y: firstPageImage.y,
      width: firstPageImage.width,
      height: firstPageImage.height,
      sourceImageId: firstPageImage.id,
      color: "#ffffff",
      opacity: 1,
      strokeWidth: 0,
    },
  ],
  metadata: {
    title: "ex.pdf image deletion regression output",
    author: "PDF Studio",
    subject: "ex.pdf direct image verification",
    keywords: "pdf,editor,ex,image",
    creator: "PDF Studio",
    producer: "PDF Studio Engine",
  },
  saveOptions: {
    annotationMode: "flatten",
    redactionMode: "textOnly",
    validate: true,
  },
}, "ex-image-delete");

const imageDeleteValidation = await validatePdf(imageDeletedPath);
if (!imageDeleteValidation.ok || imageDeleteValidation.pageCount !== 33 || !imageDeleteValidation.qpdfChecked) {
  throw new Error(`ex.pdf image deletion validation failed: ${JSON.stringify(imageDeleteValidation)}`);
}

const imageDeletedInfo = await inspectPdf(imageDeletedPath);
if (imageDeletedInfo.pages[0].images >= sourceInfo.pages[0].images) {
  throw new Error(`ex.pdf source image was not removed: ${sourceInfo.pages[0].images} -> ${imageDeletedInfo.pages[0].images}`);
}

async function findTextRect(filePath, text) {
  const script = [
    "import fitz, json, sys",
    "doc = fitz.open(sys.argv[1])",
    "rects = doc[0].search_for(sys.argv[2])",
    "if not rects:",
    "    raise SystemExit('target text not found')",
    "rect = rects[0]",
    "print(json.dumps({'x0': rect.x0, 'y0': rect.y0, 'x1': rect.x1, 'y1': rect.y1}))",
    "doc.close()",
  ].join("\n");
  const { stdout } = await runProcess("python3", ["-c", script, filePath, text]);
  return JSON.parse(stdout);
}

async function extractEngineDocument(filePath) {
  const { stdout } = await runProcess("python3", [
    path.join(root, "engine", "pdf_engine.py"),
    "extract",
    "--input",
    filePath,
  ]);
  return JSON.parse(stdout);
}
