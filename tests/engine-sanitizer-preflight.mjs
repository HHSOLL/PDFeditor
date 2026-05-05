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
if (
  !before.metadataPresent ||
  !before.xmpPresent ||
  before.embeddedFileCount !== 1 ||
  before.javascriptCount < 1 ||
  before.javascriptNameTreeCount < 1 ||
  before.hiddenLayerCount < 1 ||
  before.commentAnnotationCount < 1 ||
  before.fileAttachmentAnnotationCount < 1 ||
  before.annotationActionCount < 1 ||
  before.linkActionCount < 1 ||
  before.embeddedSearchIndexCount < 1 ||
  before.staleIncrementalSaveCount < 1 ||
  before.unreferencedObjectSignalCount < 1
) {
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
      fileAttachmentAnnotations: true,
      javascript: true,
      javascriptNameTree: true,
      annotationActions: true,
      comments: true,
      hiddenLayers: true,
      embeddedSearchIndex: true,
      staleIncrementalUpdates: true,
      unreferencedObjects: true,
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
if (
  after.metadataPresent ||
  after.xmpPresent ||
  after.embeddedFileCount !== 0 ||
  after.javascriptCount !== 0 ||
  after.javascriptNameTreeCount !== 0 ||
  after.hiddenLayerCount !== 0 ||
  after.commentAnnotationCount !== 0 ||
  after.fileAttachmentAnnotationCount !== 0 ||
  after.annotationActionCount !== 0 ||
  after.linkActionCount !== 0 ||
  after.embeddedSearchIndexCount !== 0 ||
  after.staleIncrementalSaveCount !== 0 ||
  after.unreferencedObjectSignalCount !== 0
) {
  throw new Error(`hidden data was not sanitized: ${JSON.stringify(after)}`);
}

const text = await extractText(outputPath);
if (!text.includes("Visible safe text")) {
  throw new Error(`sanitizer removed visible page text unexpectedly: ${text}`);
}

const raw = await fs.readFile(outputPath);
for (const needle of [
  "SECRET_TITLE",
  "SECRET_AUTHOR",
  "SECRET_XMP",
  "SECRET_ATTACHMENT",
  "SECRET_JS",
  "SECRET_OCG_LAYER",
  "SECRET_COMMENT",
  "SECRET_ANNOT_ACTION",
  "SECRET_FILE_ANNOT",
  "SECRET_LINK_ACTION",
  "SECRET_JS_NAME",
  "SECRET_JS_NAME_TREE",
  "SECRET_SEARCH_INDEX",
  "SECRET_STALE_INCREMENTAL",
  "SECRET_UNREFERENCED_OBJECT",
]) {
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
      "doc.add_ocg('SECRET_OCG_LAYER', on=True)",
      "doc.set_metadata({'title': 'SECRET_TITLE', 'author': 'SECRET_AUTHOR', 'subject': 'SECRET_SUBJECT', 'keywords': 'SECRET_KEYWORDS'})",
      "doc.set_xml_metadata('<x:xmpmeta>SECRET_XMP</x:xmpmeta>')",
      "doc.xref_set_key(doc.pdf_catalog(), 'OpenAction', '<< /S /JavaScript /JS (app.alert(\"SECRET_JS\")) >>')",
      "doc.xref_set_key(doc.pdf_catalog(), 'PieceInfo', '<< /Private << /SearchIndex (SECRET_SEARCH_INDEX) >> >>')",
      "unreferenced = doc.get_new_xref()",
      "doc.update_object(unreferenced, '<< /UnreferencedSanitizerSignal (SECRET_UNREFERENCED_OBJECT) >>')",
      "comment = page.add_text_annot((72, 140), 'SECRET_COMMENT')",
      "file_annot = page.add_file_annot((72, 160), b'SECRET_FILE_ANNOT', 'secret-annot.txt')",
      "page.insert_link({'kind': fitz.LINK_URI, 'from': fitz.Rect(72, 180, 210, 200), 'uri': 'https://example.com/SECRET_LINK_ACTION'})",
      "doc.xref_set_key(comment.xref, 'AA', '<< /D << /S /JavaScript /JS (SECRET_ANNOT_ACTION) >> >>')",
      "js_tree = doc.get_new_xref()",
      "doc.update_object(js_tree, '<< /Names [(SECRET_JS_NAME) << /S /JavaScript /JS (SECRET_JS_NAME_TREE) >>] >>')",
      "doc.xref_set_key(doc.pdf_catalog(), 'Names', f'<< /JavaScript {js_tree} 0 R >>')",
      "doc.embfile_add('secret.txt', b'SECRET_ATTACHMENT', filename='secret.txt', desc='secret attachment')",
      "doc.save(sys.argv[1])",
      "doc.close()",
      "doc = fitz.open(sys.argv[1])",
      "doc.set_metadata({'title': 'Clean title', 'subject': 'SECRET_STALE_INCREMENTAL'})",
      "doc.saveIncr()",
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
