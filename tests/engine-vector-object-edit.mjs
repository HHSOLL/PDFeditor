import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  inspectPdf,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-vector-object-edit");
const inputPath = path.join(workDir, "vector-source.pdf");
const outputPath = path.join(workDir, "vector-output.pdf");
const movedPath = path.join(workDir, "vector-moved-output.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createVectorFixture(inputPath);

const before = await inspectPdf(inputPath);
if (before.pages[0].drawings < 2) {
  throw new Error(`vector fixture did not expose drawing objects: ${JSON.stringify(before.pages[0])}`);
}

await applyEngine(inputPath, outputPath, createPayload(), "vector-object-edit");
await applyEngine(inputPath, movedPath, createMovePayload(), "vector-object-move");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`vector delete output failed validation: ${JSON.stringify(validation)}`);
}

const after = await inspectPdf(outputPath);
if (after.pages[0].drawings >= before.pages[0].drawings) {
  throw new Error(`vector delete should reduce drawing object count: before=${before.pages[0].drawings} after=${after.pages[0].drawings}`);
}
if (!after.pages[0].text.includes("Vector deletion keeps text searchable")) {
  throw new Error(`vector delete removed unrelated text: ${after.pages[0].text}`);
}

const movedValidation = await validatePdf(movedPath);
if (!movedValidation.ok || !movedValidation.qpdfChecked) {
  throw new Error(`vector move output failed validation: ${JSON.stringify(movedValidation)}`);
}
const moved = await inspectPdf(movedPath);
if (!moved.pages[0].text.includes("Vector deletion keeps text searchable")) {
  throw new Error(`vector move removed unrelated text: ${moved.pages[0].text}`);
}
if (moved.pages[0].drawings < 1) {
  throw new Error(`vector move should reinsert a real drawing object: ${JSON.stringify(moved.pages[0])}`);
}

async function createVectorFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Vector deletion keeps text searchable', fontsize=18)",
      "page.draw_rect(fitz.Rect(72, 130, 240, 260), color=(1, 0, 0), fill=(1, 0.9, 0.9), width=4)",
      "page.draw_line(fitz.Point(80, 280), fitz.Point(240, 340), color=(0, 0, 1), width=5)",
      "doc.save(sys.argv[1], deflate=False, clean=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

function createPayload() {
  return {
    saveOptions: {
      annotationMode: "flatten",
      redactionMode: "textOnly",
      validate: true,
    },
    operations: [
      {
        type: "deleteVector",
        pageIndex: 0,
        x: 68 / 612,
        y: 126 / 792,
        width: 176 / 612,
        height: 138 / 792,
      },
    ],
  };
}

function createMovePayload() {
  return {
    saveOptions: {
      annotationMode: "flatten",
      redactionMode: "textOnly",
      validate: true,
    },
    operations: [
      {
        type: "moveVector",
        pageIndex: 0,
        x: 300 / 612,
        y: 140 / 792,
        width: 150 / 612,
        height: 100 / 792,
        color: "#176b58",
        opacity: 1,
        strokeWidth: 3,
        eraseOriginal: {
          x: 68 / 612,
          y: 126 / 792,
          width: 176 / 612,
          height: 138 / 792,
        },
      },
    ],
  };
}
