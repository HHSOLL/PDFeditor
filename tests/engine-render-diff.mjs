import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  extractText,
  renderDiffMetrics,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-render-diff");
const inputPath = path.join(workDir, "render-source.pdf");
const outputPath = path.join(workDir, "render-output.pdf");
const editRect = { x: 68 / 612, y: 62 / 792, width: 300 / 612, height: 62 / 792 };

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createRenderFixture(inputPath);
await applyEngine(inputPath, outputPath, createPayload(), "render-diff");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked || validation.pageCount !== 1) {
  throw new Error(`render output validation failed: ${JSON.stringify(validation)}`);
}

const text = await extractText(outputPath);
if (!text.includes("Edited marker")) {
  throw new Error(`edited text missing after export: ${text}`);
}
if (text.includes("Original marker")) {
  throw new Error(`original text still extractable after export: ${text}`);
}

const diff = await renderDiffMetrics(inputPath, outputPath, editRect);
if (diff.insideMean < 5) {
  throw new Error(`edit area did not visibly change enough: ${JSON.stringify(diff)}`);
}
if (diff.outsideMean > 1.5) {
  throw new Error(`render diff leaked outside edit area: ${JSON.stringify(diff)}`);
}

async function createRenderFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Original marker', fontsize=24, color=(0, 0, 0))",
      "page.insert_text((72, 180), 'Stable marker should not move', fontsize=14, color=(0, 0, 0))",
      "page.draw_rect(fitz.Rect(70, 250, 220, 310), color=(0, 0.4, 0.2), width=1)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

function createPayload() {
  return {
    pages: [{ sourceIndex: 0, rotation: 0 }],
    metadata: {
      title: "Render Diff Fixture",
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
        y: 66 / 792,
        width: 270 / 612,
        height: 44 / 792,
        text: "Edited marker",
        fontSize: 24,
        color: "#172026",
        opacity: 1,
        strokeWidth: 1,
        eraseOriginal: editRect,
      },
    ],
  };
}
