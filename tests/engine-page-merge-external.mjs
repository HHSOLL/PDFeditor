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

const workDir = path.join(root, "tmp", "engine-page-merge-external");
const mainPath = path.join(workDir, "main.pdf");
const donorPath = path.join(workDir, "donor.pdf");
const outputPath = path.join(workDir, "merged.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createPdf(mainPath, ["Main page 1"]);
await createPdf(donorPath, ["Donor page 1", "Donor page 2"]);

await applyEngine(mainPath, outputPath, {
  pages: [
    { sourceIndex: 0, rotation: 0 },
    { sourceIndex: 1, rotation: 0, sourcePdfBase64: await fs.readFile(donorPath, "base64") },
    { sourceIndex: -1, rotation: 0, width: 320, height: 240 },
  ],
  saveOptions: { annotationMode: "flatten", redactionMode: "textOnly", validate: true },
  operations: [
    {
      type: "text",
      pageIndex: 2,
      x: 36 / 320,
      y: 72 / 240,
      width: 240 / 320,
      height: 32 / 240,
      text: "Merged blank appendix",
      fontSize: 14,
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
  ],
}, "page-merge-external");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked || validation.pageCount !== 3) {
  throw new Error(`external merge validation failed: ${JSON.stringify(validation)}`);
}
const info = await inspectPdf(outputPath);
if (Math.round(info.pages[2].width) !== 320 || Math.round(info.pages[2].height) !== 240) {
  throw new Error(`blank merged page geometry was not preserved: ${JSON.stringify(info.pages[2])}`);
}
const text = await extractText(outputPath);
for (const expected of ["Main page 1", "Donor page 2", "Merged blank appendix"]) {
  if (!text.includes(expected)) {
    throw new Error(`merged PDF text missing ${expected}: ${text}`);
  }
}
if (text.indexOf("Main page 1") > text.indexOf("Donor page 2")) {
  throw new Error(`external page order was not preserved: ${text}`);
}

async function createPdf(filePath, labels) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "doc = fitz.open()",
      "for label in json.loads(sys.argv[2]):",
      "    page = doc.new_page(width=612, height=792)",
      "    page.insert_text((72, 92), label, fontsize=20)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
    JSON.stringify(labels),
  ]);
}
