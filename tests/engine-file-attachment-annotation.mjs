import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  enginePath,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-file-attachment-annotation");
const inputPath = path.join(workDir, "attachment-source.pdf");
const outputPath = path.join(workDir, "attachment-output.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createSourcePdf(inputPath);
await applyEngine(inputPath, outputPath, createPayload(), "file-attachment");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`file attachment annotation output failed validation: ${JSON.stringify(validation)}`);
}

const preflightReport = await readPreflight(outputPath);
if (preflightReport.fileAttachmentAnnotationCount !== 1 || preflightReport.commentAnnotationCount !== 1) {
  throw new Error(`file attachment comment was not persisted as an annotation: ${JSON.stringify(preflightReport)}`);
}

const attachment = await inspectAttachment(outputPath);
if (attachment.subtype !== "FileAttachment" || !attachment.content.includes("review-notes.txt")) {
  throw new Error(`file attachment annotation metadata was not readable: ${JSON.stringify(attachment)}`);
}

async function createSourcePdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 96), 'File attachment annotation fixture', fontsize=18)",
      "doc.save(sys.argv[1], garbage=4, deflate=False, clean=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function readPreflight(filePath) {
  const { stdout } = await runProcess("python3", [
    enginePath,
    "preflight",
    "--input",
    filePath,
    "--stdout",
  ]);
  return JSON.parse(stdout);
}

async function inspectAttachment(filePath) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "doc = fitz.open(sys.argv[1])",
      "page = doc[0]",
      "annot = list(page.annots())[0]",
      "print(json.dumps({'subtype': annot.type[1], 'content': annot.info.get('content', '')}, ensure_ascii=False))",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
  return JSON.parse(stdout);
}

function createPayload() {
  return {
    saveOptions: {
      annotationMode: "native",
      redactionMode: "textOnly",
      validate: true,
    },
    operations: [
      {
        type: "fileAttachment",
        pageIndex: 0,
        x: 90 / 612,
        y: 140 / 792,
        width: 24 / 612,
        height: 24 / 792,
        fileName: "review-notes.txt",
        fileBase64: Buffer.from("attached review note").toString("base64"),
        description: "review-notes.txt",
      },
    ],
  };
}
