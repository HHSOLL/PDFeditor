import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  root,
  runProcess,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-batch-100");
const inputPath = path.join(workDir, "batch-source.pdf");
const manifestPath = path.join(workDir, "manifest.json");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createSourcePdf(inputPath);
await fs.writeFile(manifestPath, JSON.stringify(createManifest(), null, 2));

const { stdout } = await runProcess("python3", [
  enginePath,
  "batch",
  "--manifest",
  manifestPath,
  "--stdout",
]);
const report = JSON.parse(stdout);
if (!report.ok || report.jobCount !== 100 || report.successCount !== 100 || report.failureCount !== 0) {
  throw new Error(`100-file batch manifest did not complete cleanly: ${JSON.stringify(report)}`);
}

async function createSourcePdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=240, height=180)",
      "page.insert_text((32, 60), 'Batch source', fontsize=14)",
      "doc.save(sys.argv[1], garbage=4, deflate=True, clean=True)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

function createManifest() {
  return {
    jobs: Array.from({ length: 100 }, (_, index) => ({
      input: inputPath,
      output: path.join(workDir, `outputs/job-${String(index + 1).padStart(3, "0")}.pdf`),
      payload: {
        saveOptions: {
          annotationMode: "flatten",
          redactionMode: "textOnly",
          validate: true,
        },
        operations: [
          {
            type: "text",
            pageIndex: 0,
            x: 32 / 240,
            y: 82 / 180,
            width: 150 / 240,
            height: 24 / 180,
            text: `Batch job ${index + 1}`,
            fontSize: 10,
            color: "#172026",
            opacity: 1,
            strokeWidth: 1,
          },
        ],
      },
    })),
  };
}
