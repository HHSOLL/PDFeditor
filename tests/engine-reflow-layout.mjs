import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const root = process.cwd();
const enginePython = process.env.PDF_ENGINE_PYTHON ||
  (existsSync(path.join(root, ".venv", "bin", "python")) ? path.join(root, ".venv", "bin", "python") : "python3");

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command === "python3" ? enginePython : command, args, {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    if (options.stdin) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

async function createFixture(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Original editable paragraph", { x: 72, y: 700, size: 16, font });
  page.drawText("Follower paragraph moved structurally", { x: 72, y: 650, size: 13, font });
  await fs.writeFile(filePath, await document.save());
}

async function extractText(filePath) {
  const script = [
    "import fitz, sys",
    "doc = fitz.open(sys.argv[1])",
    "print('\\n'.join(page.get_text() for page in doc))",
    "doc.close()",
  ].join("\n");
  return run("python3", ["-c", script, filePath]);
}

const input = path.join(root, "tmp", "engine-reflow-layout-input.pdf");
const output = path.join(root, "tmp", "engine-reflow-layout-output.pdf");
const opsPath = path.join(root, "tmp", "engine-reflow-layout-ops.json");
await createFixture(input);

const operations = {
  pages: [{ sourceIndex: 0, rotation: 0 }],
  operations: [
    {
      type: "text",
      pageIndex: 0,
      x: 72 / 612,
      y: (792 - 700 - 18) / 792,
      width: 360 / 612,
      height: 62 / 792,
      text: "Replacement editable paragraph with a structural added line",
      fontSize: 18,
      fontFamily: "Helvetica",
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
      lineHeight: 1.25,
      eraseOriginal: {
        x: 72 / 612,
        y: (792 - 700 - 18) / 792,
        width: 240 / 612,
        height: 22 / 792,
      },
    },
    {
      type: "text",
      pageIndex: 0,
      x: 72 / 612,
      y: (792 - 590 - 16) / 792,
      width: 330 / 612,
      height: 20 / 792,
      text: "Follower paragraph moved structurally",
      fontSize: 13,
      fontFamily: "Helvetica",
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
      lineHeight: 1.25,
      eraseOriginal: {
        x: 72 / 612,
        y: (792 - 650 - 16) / 792,
        width: 250 / 612,
        height: 20 / 792,
      },
    },
  ],
  saveOptions: { saveMode: "flatten", redactionMode: "textOnly" },
};
await fs.writeFile(opsPath, JSON.stringify(operations), "utf8");

await run("python3", [
  path.join(root, "engine", "pdf_engine.py"),
  "apply",
  "--input",
  input,
  "--ops",
  opsPath,
  "--output",
  output,
]);

const text = await extractText(output);
if (!text.includes("Replacement editable paragraph")) {
  throw new Error("replacement paragraph was not searchable after structural reflow save");
}
if (!text.includes("Follower paragraph moved structurally")) {
  throw new Error("moved downstream paragraph was not searchable after structural reflow save");
}
if (text.includes("Original editable paragraph")) {
  throw new Error("original paragraph text remained extractable after structural replacement");
}

if (process.env.REQUIRE_QPDF === "1") {
  await run("qpdf", ["--check", output]);
}

console.log("engine reflow layout structural save passed");
