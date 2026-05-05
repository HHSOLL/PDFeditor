import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  enginePath,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-form-signature-field");
const inputPath = path.join(workDir, "signature-field-source.pdf");
const outputPath = path.join(workDir, "signature-field-output.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createSourcePdf(inputPath);
await applyEngine(inputPath, outputPath, createPayload(), "signature-field");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`signature field output failed validation: ${JSON.stringify(validation)}`);
}

const preflight = await inspectPreflight(outputPath);
if (preflight.signatureFieldCount !== 1 || preflight.formFieldCount !== 1) {
  throw new Error(`signature widget was not persisted as an AcroForm field: ${JSON.stringify(preflight)}`);
}

async function createSourcePdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 96), 'Signature field creation fixture', fontsize=18)",
      "doc.save(sys.argv[1], garbage=4, deflate=False, clean=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function inspectPreflight(filePath) {
  const { stdout } = await runProcess("python3", [
    enginePath,
    "preflight",
    "--input",
    filePath,
    "--stdout",
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
        type: "formField",
        create: true,
        fieldName: "SignerApproval",
        fieldType: "signature",
        pageIndex: 0,
        x: 72 / 612,
        y: 140 / 792,
        width: 220 / 612,
        height: 64 / 792,
        color: "#172026",
        opacity: 1,
        strokeWidth: 1,
      },
    ],
  };
}
