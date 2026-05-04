import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = process.cwd();
const workDir = path.join(root, "tmp", "engine-smoke");
const inputPath = path.join(workDir, "input.pdf");
const cliOutputPath = path.join(workDir, "cli-output.pdf");
const apiOutputPath = path.join(workDir, "api-output.pdf");
const opsPath = path.join(workDir, "ops.json");
const renderPath = path.join(workDir, "api-output.png");
const enginePath = path.join(root, "engine", "pdf_engine.py");
const replacementText = "상용 엔진 수정 완료";

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createSamplePdf(inputPath);
const operations = createOperations();
await fs.writeFile(opsPath, JSON.stringify({ operations }, null, 2));

await runProcess("python3", [
  enginePath,
  "apply",
  "--input",
  inputPath,
  "--ops",
  opsPath,
  "--output",
  cliOutputPath,
]);
await assertExtractedText(cliOutputPath);

const server = spawn(process.execPath, [path.join(root, "server", "pdf-engine-server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: "8799" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  await waitForHealth();
  const response = await fetch("http://127.0.0.1:8799/api/pdf/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pdfBase64: await fs.readFile(inputPath, "base64"),
      pages: [{ sourceIndex: 0, rotation: 0 }],
      operations,
    }),
  });
  if (!response.ok) {
    throw new Error(`engine API returned ${response.status}: ${await response.text()}`);
  }
  const result = await response.json();
  if (!result || typeof result.pdfBase64 !== "string") {
    throw new Error("engine API did not return pdfBase64");
  }
  await fs.writeFile(apiOutputPath, Buffer.from(result.pdfBase64, "base64"));
  await assertExtractedText(apiOutputPath);
  await renderFirstPage(apiOutputPath, renderPath);
  const rendered = await fs.stat(renderPath);
  if (rendered.size < 1000) {
    throw new Error("rendered engine output is unexpectedly small");
  }
} finally {
  server.kill();
}

async function createSamplePdf(filePath) {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Original contract title", {
    x: 72,
    y: 700,
    size: 24,
    font,
    color: rgb(0.1, 0.12, 0.15),
  });
  page.drawText("This paragraph remains intact after engine edits.", {
    x: 72,
    y: 650,
    size: 12,
    font,
  });
  page.drawText("Amount: $1,200", { x: 72, y: 610, size: 14, font });
  await fs.writeFile(filePath, await document.save());
}

function createOperations() {
  return [
    {
      type: "text",
      pageIndex: 0,
      x: 72 / 612,
      y: 66 / 792,
      width: 270 / 612,
      height: 48 / 792,
      text: replacementText,
      fontSize: 24,
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
      eraseOriginal: {
        x: 68 / 612,
        y: 62 / 792,
        width: 292 / 612,
        height: 56 / 792,
      },
    },
    {
      type: "highlight",
      pageIndex: 0,
      x: 72 / 612,
      y: 134 / 792,
      width: 270 / 612,
      height: 22 / 792,
      color: "#ffe45c",
      opacity: 0.35,
      strokeWidth: 1,
    },
    {
      type: "flowSlice",
      pageIndex: 0,
      x: 0,
      y: 150 / 792,
      sourceY: 132 / 792,
      width: 1,
      height: 260 / 792,
      color: "#ffffff",
      opacity: 1,
      strokeWidth: 0,
    },
    {
      type: "rect",
      pageIndex: 0,
      x: 68 / 612,
      y: 56 / 792,
      width: 300 / 612,
      height: 70 / 792,
      color: "#176b58",
      opacity: 1,
      strokeWidth: 1.5,
    },
  ];
}

async function assertExtractedText(filePath) {
  const { stdout } = await runProcess("python3", [enginePath, "extract", "--input", filePath]);
  const extracted = JSON.parse(stdout);
  const text = extracted.pages
    .flatMap((page) => page.spans.map((span) => span.text))
    .join(" ");
  if (!text.includes(replacementText)) {
    throw new Error(`replacement text was not extracted from ${filePath}: ${text}`);
  }
  if (text.includes("Original contract title")) {
    throw new Error(`original text was still extractable from ${filePath}: ${text}`);
  }
}

async function renderFirstPage(pdfPath, imagePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open(sys.argv[1])",
      "pix = doc[0].get_pixmap(matrix=fitz.Matrix(0.75, 0.75), alpha=False)",
      "pix.save(sys.argv[2])",
      "doc.close()",
    ].join("; "),
    pdfPath,
    imagePath,
  ]);
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8799/api/health");
      if (response.ok) {
        return;
      }
    } catch {
      await delay(100);
    }
  }
  throw new Error("engine API server did not become healthy");
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}\n${output.stderr}`));
        return;
      }
      resolve(output);
    });
  });
}
