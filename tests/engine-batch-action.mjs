import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  extractText,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-batch-action");
const manifestPath = path.join(workDir, "manifest.json");
const inputA = path.join(workDir, "batch-a.pdf");
const inputB = path.join(workDir, "batch-b.pdf");
const inputC = path.join(workDir, "batch-c.pdf");
const outputA = path.join(workDir, "out-a.pdf");
const outputB = path.join(workDir, "out-b.pdf");
const outputC = path.join(workDir, "out-c.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createBatchFixture(inputA, "Batch file A", {});
await createBatchFixture(inputB, "BATCH_SECRET must be redacted", {});
await createBatchFixture(inputC, "Sanitized document", { title: "SECRET_BATCH_TITLE" });
await fs.writeFile(manifestPath, JSON.stringify(createManifest(), null, 2));

const { stdout } = await runProcess("python3", [
  enginePath,
  "batch",
  "--manifest",
  manifestPath,
  "--stdout",
]);
const result = JSON.parse(stdout);

if (!result.ok || result.jobCount !== 3 || result.successCount !== 3 || result.failureCount !== 0) {
  throw new Error(`batch action failed: ${JSON.stringify(result)}`);
}

for (const outputPath of [outputA, outputB, outputC]) {
  const validation = await validatePdf(outputPath);
  if (!validation.ok || !validation.qpdfChecked) {
    throw new Error(`batch output did not validate: ${outputPath} ${JSON.stringify(validation)}`);
  }
}

const textA = await extractText(outputA);
if (!textA.includes("Batch watermark")) {
  throw new Error(`batch text insertion was not saved as searchable text: ${textA}`);
}

const textB = await extractText(outputB);
if (textB.includes("BATCH_SECRET")) {
  throw new Error(`batch redaction did not remove extracted secret: ${textB}`);
}
const rawB = await fs.readFile(outputB, "utf8");
if (rawB.includes("BATCH_SECRET")) {
  throw new Error("batch redaction did not remove secret from raw bytes");
}

const { stdout: preflightStdout } = await runProcess("python3", [
  enginePath,
  "preflight",
  "--input",
  outputC,
  "--stdout",
]);
const preflight = JSON.parse(preflightStdout);
if (preflight.metadataPresent || preflight.xmpPresent) {
  throw new Error(`batch sanitizer did not remove metadata: ${JSON.stringify(preflight)}`);
}

async function createBatchFixture(filePath, text, metadata) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), sys.argv[2], fontsize=18)",
      "metadata = json.loads(sys.argv[3])",
      "if metadata:",
      "    doc.set_metadata(metadata)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
    text,
    JSON.stringify(metadata),
  ]);
}

function createManifest() {
  return {
    jobs: [
      {
        input: path.basename(inputA),
        output: path.basename(outputA),
        payload: {
          saveOptions: { annotationMode: "flatten", redactionMode: "textOnly", validate: true },
          operations: [
            {
              type: "text",
              pageIndex: 0,
              x: 72 / 612,
              y: 128 / 792,
              width: 220 / 612,
              height: 32 / 792,
              text: "Batch watermark",
              fontSize: 16,
              color: "#172026",
              opacity: 1,
              strokeWidth: 1,
            },
          ],
        },
      },
      {
        input: path.basename(inputB),
        output: path.basename(outputB),
        payload: {
          saveOptions: { annotationMode: "flatten", redactionMode: "textOnly", validate: true },
          operations: [
            {
              type: "redactSearch",
              pageIndex: 0,
              text: "BATCH_SECRET",
              x: 0,
              y: 0,
              width: 0,
              height: 0,
            },
          ],
        },
      },
      {
        input: path.basename(inputC),
        output: path.basename(outputC),
        payload: {
          saveOptions: {
            annotationMode: "flatten",
            redactionMode: "textOnly",
            validate: true,
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
          },
          operations: [],
        },
      },
    ],
  };
}
