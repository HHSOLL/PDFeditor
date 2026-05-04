import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  enginePath,
  extractText,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const root = process.cwd();
const workDir = path.join(root, "tmp", "engine-sanitizer-preflight");
const inputPath = path.join(workDir, "hidden-source.pdf");
const outputPath = path.join(workDir, "hidden-sanitized.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createHiddenDataFixture(inputPath);

const before = await preflight(inputPath);
if (!before.metadataPresent || !before.xmpPresent || before.embeddedFileCount !== 1 || before.javascriptCount < 1) {
  throw new Error(`fixture did not expose hidden data: ${JSON.stringify(before)}`);
}

await applyEngine(inputPath, outputPath, {
  pages: [{ sourceIndex: 0, rotation: 0 }],
  operations: [],
  metadata: {
    title: "Should be removed",
    author: "Should be removed",
    subject: "Should be removed",
    keywords: "secret",
    creator: "PDF Studio",
    producer: "PDF Studio Engine",
  },
  saveOptions: {
    annotationMode: "flatten",
    redactionMode: "textOnly",
    flattenForms: false,
    sanitize: true,
    sanitizeOptions: {
      metadata: true,
      xmlMetadata: true,
      embeddedFiles: true,
      javascript: true,
      links: true,
      thumbnails: true,
      resetFormFields: false,
    },
    validate: true,
  },
}, "sanitize-hidden-data");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`sanitized output failed validation: ${JSON.stringify(validation)}`);
}

const after = await preflight(outputPath);
if (after.metadataPresent || after.xmpPresent || after.embeddedFileCount !== 0 || after.javascriptCount !== 0) {
  throw new Error(`hidden data was not sanitized: ${JSON.stringify(after)}`);
}

const text = await extractText(outputPath);
if (!text.includes("Visible safe text")) {
  throw new Error(`sanitizer removed visible page text unexpectedly: ${text}`);
}

const raw = await fs.readFile(outputPath);
for (const needle of ["SECRET_TITLE", "SECRET_AUTHOR", "SECRET_XMP", "SECRET_ATTACHMENT", "SECRET_JS"]) {
  if (raw.includes(Buffer.from(needle))) {
    throw new Error(`sanitized PDF still contains ${needle}`);
  }
}

async function createHiddenDataFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 96), 'Visible safe text', fontsize=14)",
      "doc.set_metadata({'title': 'SECRET_TITLE', 'author': 'SECRET_AUTHOR', 'subject': 'SECRET_SUBJECT', 'keywords': 'SECRET_KEYWORDS'})",
      "doc.set_xml_metadata('<x:xmpmeta>SECRET_XMP</x:xmpmeta>')",
      "doc.embfile_add('secret.txt', b'SECRET_ATTACHMENT', filename='secret.txt', desc='secret attachment')",
      "doc.xref_set_key(doc.pdf_catalog(), 'OpenAction', '<< /S /JavaScript /JS (app.alert(\"SECRET_JS\")) >>')",
      "doc.save(sys.argv[1])",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function preflight(filePath) {
  const { stdout } = await runProcess("python3", [
    enginePath,
    "preflight",
    "--input",
    filePath,
    "--stdout",
  ]);
  return JSON.parse(stdout);
}
