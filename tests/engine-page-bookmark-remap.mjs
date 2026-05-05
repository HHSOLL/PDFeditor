import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-page-bookmark-remap");
const inputPath = path.join(workDir, "bookmark-source.pdf");
const outputPath = path.join(workDir, "bookmark-output.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createBookmarkFixture(inputPath);
await applyEngine(inputPath, outputPath, createPayload(), "bookmark-remap");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked || validation.pageCount !== 3) {
  throw new Error(`bookmark remap output failed validation: ${JSON.stringify(validation)}`);
}

const toc = await readToc(outputPath);
const chapterC = toc.find((row) => row[1] === "Chapter C");
const chapterA = toc.find((row) => row[1] === "Chapter A");
if (!chapterC || chapterC[2] !== 1) {
  throw new Error(`Chapter C outline should remap to output page 1: ${JSON.stringify(toc)}`);
}
if (!chapterA || chapterA[2] !== 2) {
  throw new Error(`Chapter A outline should remap to output page 2: ${JSON.stringify(toc)}`);
}

async function createBookmarkFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "for label in ['A', 'B', 'C']:",
      "    page = doc.new_page(width=612, height=792)",
      "    page.insert_text((72, 96), f'Page {label}', fontsize=24)",
      "doc.set_toc([[1, 'Chapter A', 1], [1, 'Chapter B', 2], [1, 'Chapter C', 3]])",
      "doc.save(sys.argv[1], garbage=4, deflate=False, clean=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function readToc(filePath) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "doc = fitz.open(sys.argv[1])",
      "print(json.dumps(doc.get_toc(), ensure_ascii=False))",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
  return JSON.parse(stdout);
}

function createPayload() {
  return {
    pages: [
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 1, rotation: 0 },
    ],
    saveOptions: {
      annotationMode: "flatten",
      redactionMode: "textOnly",
      validate: true,
    },
    operations: [],
  };
}
