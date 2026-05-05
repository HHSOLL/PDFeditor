import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  extractText,
  inspectPdf,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-page-ops");
const inputPath = path.join(workDir, "page-ops-source.pdf");
const outputPath = path.join(workDir, "page-ops-output.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createPageOpsFixture(inputPath);
await applyEngine(inputPath, outputPath, createPayload(), "page-ops");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked || validation.pageCount !== 4) {
  throw new Error(`page operation validation failed: ${JSON.stringify(validation)}`);
}

const info = await inspectPdf(outputPath);
if (info.pageCount !== 4) {
  throw new Error(`expected 4 pages, got ${info.pageCount}`);
}
if (info.pages[0].rotation !== 90 || info.pages[1].rotation !== 0 || info.pages[3].rotation !== 180) {
  throw new Error(`page rotations were not preserved: ${JSON.stringify(info.pages.map((page) => page.rotation))}`);
}
if (Math.round(info.pages[0].width) === Math.round(info.pages[1].width)) {
  throw new Error(`mixed page geometry was not preserved: ${JSON.stringify(info.pages)}`);
}
if (Math.round(info.pages[1].width) !== 459 || Math.round(info.pages[1].height) !== 594) {
  throw new Error(`cropPage did not persist the expected crop box: ${JSON.stringify(info.pages[1])}`);
}
if (Math.round(info.pages[2].width) !== 360 || Math.round(info.pages[2].height) !== 420) {
  throw new Error(`blank page insertion and resizePage did not preserve requested size: ${JSON.stringify(info.pages[2])}`);
}
if (Math.round(info.pages[3].width) !== 612 || Math.round(info.pages[3].height) !== 792) {
  throw new Error(`duplicated page geometry was not preserved: ${JSON.stringify(info.pages[3])}`);
}

const text = await extractText(outputPath);
const cIndex = text.indexOf("Page C");
const aIndex = text.indexOf("Page A");
if (cIndex < 0 || aIndex < 0 || cIndex > aIndex) {
  throw new Error(`page reorder did not preserve expected text order: ${text}`);
}
if ((text.match(/Page A/g) ?? []).length !== 2) {
  throw new Error(`duplicated Page A was not present twice: ${text}`);
}
if (!text.includes("Inserted on blank page")) {
  throw new Error(`blank page content was not inserted as searchable text: ${text}`);
}

async function createPageOpsFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Page A', fontsize=24)",
      "page = doc.new_page(width=400, height=400)",
      "page.insert_text((72, 92), 'Page B', fontsize=24)",
      "page = doc.new_page(width=500, height=700)",
      "page.insert_text((72, 92), 'Page C', fontsize=24)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

function createPayload() {
  return {
    pages: [
      { sourceIndex: 2, rotation: 90 },
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: -1, rotation: 0, width: 300, height: 300 },
      { sourceIndex: 0, rotation: 180 },
    ],
    metadata: {
      title: "Page Ops Fixture",
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
        pageIndex: 1,
        x: 72 / 612,
        y: 126 / 792,
        width: 180 / 612,
        height: 28 / 792,
        text: "Inserted after reorder",
        fontSize: 14,
        color: "#172026",
        opacity: 1,
        strokeWidth: 1,
      },
      {
        type: "cropPage",
        pageIndex: 1,
        x: 0,
        y: 0,
        width: 0.75,
        height: 0.75,
      },
      {
        type: "text",
        pageIndex: 2,
        x: 40 / 360,
        y: 80 / 420,
        width: 220 / 360,
        height: 40 / 420,
        text: "Inserted on blank page",
        fontSize: 16,
        color: "#172026",
        opacity: 1,
        strokeWidth: 1,
      },
      {
        type: "resizePage",
        pageIndex: 2,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        targetWidth: 360,
        targetHeight: 420,
      },
    ],
  };
}
