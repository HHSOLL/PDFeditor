import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  extractText,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-search-redaction");
const inputPath = path.join(workDir, "search-redaction-source.pdf");
const outputPath = path.join(workDir, "search-redaction-output.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createSearchRedactionFixture(inputPath);
await applyEngine(inputPath, outputPath, createPayload(), "search-redaction");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked || validation.pageCount !== 2) {
  throw new Error(`search redaction validation failed: ${JSON.stringify(validation)}`);
}

const text = await extractText(outputPath);
for (const secret of ["SECRET_CODE_123", "TOKEN9999", "WHOLE_PAGE_SECRET"]) {
  if (text.includes(secret)) {
    throw new Error(`redacted secret still appears in extracted text: ${secret} in ${text}`);
  }
}
if (!text.includes("Public text remains")) {
  throw new Error(`non-redacted text was unexpectedly removed: ${text}`);
}

const raw = await fs.readFile(outputPath, "utf8");
for (const secret of ["SECRET_CODE_123", "TOKEN9999", "WHOLE_PAGE_SECRET"]) {
  if (raw.includes(secret)) {
    throw new Error(`redacted secret still appears in raw PDF bytes: ${secret}`);
  }
}

async function createSearchRedactionFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Public text remains', fontsize=18)",
      "page.insert_text((72, 130), 'Literal secret SECRET_CODE_123', fontsize=18)",
      "page.insert_text((72, 168), 'Regex token TOKEN9999', fontsize=18)",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'WHOLE_PAGE_SECRET should be removed by full-page redaction', fontsize=18)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

function createPayload() {
  return {
    saveOptions: {
      annotationMode: "flatten",
      redactionMode: "imagesAndText",
      validate: true,
    },
    operations: [
      {
        type: "redactSearch",
        pageIndex: 0,
        text: "SECRET_CODE_123",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      {
        type: "redactSearch",
        pageIndex: 0,
        pattern: "TOKEN\\d+",
        regex: true,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      {
        type: "redactPage",
        pageIndex: 1,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
    ],
  };
}
