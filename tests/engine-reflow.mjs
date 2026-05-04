import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  extractText,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-reflow");
const inputPath = path.join(workDir, "reflow-source.pdf");
const outputPath = path.join(workDir, "reflow-output.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createReflowFixture(inputPath);
await applyEngine(inputPath, outputPath, createPayload(), "semantic-reflow");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked || validation.pageCount !== 2) {
  throw new Error(`semantic reflow validation failed: ${JSON.stringify(validation)}`);
}

const text = await extractText(outputPath);
if (!text.includes("Edited semantic paragraph")) {
  throw new Error(`edited paragraph missing after export: ${text}`);
}
if (!text.includes("Moved downstream searchable text")) {
  throw new Error(`moved downstream text missing after export: ${text}`);
}
if (text.includes("Downstream original text")) {
  throw new Error(`original downstream text still extractable after cross-page move: ${text}`);
}

async function createReflowFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Editable semantic paragraph', fontsize=18)",
      "page.insert_text((72, 650), 'Downstream original text', fontsize=14)",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Second page anchor', fontsize=18)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

function createPayload() {
  return {
    pages: [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 1, rotation: 0 },
    ],
    metadata: {
      title: "Semantic Reflow Fixture",
      creator: "PDF Studio",
      producer: "PDF Studio Engine",
    },
    saveOptions: {
      annotationMode: "flatten",
      redactionMode: "textOnly",
      validate: true,
    },
    operations: [
      {
        type: "text",
        pageIndex: 0,
        x: 72 / 612,
        y: 70 / 792,
        width: 320 / 612,
        height: 80 / 792,
        text: "Edited semantic paragraph",
        fontSize: 18,
        color: "#172026",
        opacity: 1,
        strokeWidth: 1,
        lineHeight: 1.25,
        eraseOriginal: {
          x: 70 / 612,
          y: 60 / 792,
          width: 340 / 612,
          height: 38 / 792,
        },
      },
      {
        type: "redact",
        pageIndex: 0,
        x: 70 / 612,
        y: 626 / 792,
        width: 280 / 612,
        height: 34 / 792,
        color: "#ffffff",
        opacity: 1,
        strokeWidth: 0,
      },
      {
        type: "text",
        pageIndex: 1,
        x: 72 / 612,
        y: 130 / 792,
        width: 320 / 612,
        height: 38 / 792,
        text: "Moved downstream searchable text",
        fontSize: 14,
        color: "#172026",
        opacity: 1,
        strokeWidth: 1,
        lineHeight: 1.25,
      },
    ],
  };
}
