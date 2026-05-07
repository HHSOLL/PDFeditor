import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const root = process.cwd();
const enginePython = process.env.PDF_ENGINE_PYTHON ||
  (existsSync(path.join(root, ".venv", "bin", "python")) ? path.join(root, ".venv", "bin", "python") : "python3");
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP8z8BQDwAFgwJ/lrW9NwAAAABJRU5ErkJggg==",
  "base64",
);

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
  const image = await document.embedPng(onePixelPng);
  page.drawText("Object reflow lead paragraph", { x: 72, y: 724, size: 16, font });
  page.drawImage(image, { x: 72, y: 420, width: 260, height: 190 });
  page.drawText("Figure 1. Structural object move caption", { x: 72, y: 398, size: 11, font });
  await fs.writeFile(filePath, await document.save());
}

async function extract(filePath) {
  const raw = await run("python3", [path.join(root, "engine", "pdf_engine.py"), "extract", "--input", filePath]);
  return JSON.parse(raw);
}

const input = path.join(root, "tmp", "engine-reflow-object-input.pdf");
const output = path.join(root, "tmp", "engine-reflow-object-output.pdf");
const opsPath = path.join(root, "tmp", "engine-reflow-object-ops.json");
await createFixture(input);

const extracted = await extract(input);
const image = extracted.pages[0].images[0];
if (!image) {
  throw new Error("fixture did not expose an image object");
}
const targetY = Math.min(0.78, image.y + 0.22);
const operations = {
  pages: [{ sourceIndex: 0, rotation: 0 }],
  operations: [
    {
      type: "moveImage",
      pageIndex: 0,
      sourcePageIndex: 0,
      sourceImageId: image.id,
      x: image.x,
      y: targetY,
      width: image.width,
      height: image.height,
      eraseOriginal: {
        x: image.x,
        y: image.y,
        width: image.width,
        height: image.height,
      },
      color: "#ffffff",
      opacity: 1,
      strokeWidth: 0,
    },
    {
      type: "text",
      pageIndex: 0,
      x: 72 / 612,
      y: targetY + image.height + 0.012,
      width: 260 / 612,
      height: 18 / 792,
      text: "Figure 1. Structural object move caption",
      fontSize: 11,
      fontFamily: "Helvetica",
      fontName: "Helvetica",
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
      eraseOriginal: {
        x: 72 / 612,
        y: (792 - 398 - 11) / 792,
        width: 230 / 612,
        height: 16 / 792,
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

const moved = await extract(output);
const movedImage = moved.pages[0].images.find((candidate) => Math.abs(candidate.y - targetY) < 0.035);
if (!movedImage) {
  throw new Error("moved image object was not present at the reflow target");
}
const staleImage = moved.pages[0].images.find((candidate) => Math.abs(candidate.y - image.y) < 0.02);
if (staleImage) {
  throw new Error("original image placement remained after object reflow move");
}

if (process.env.REQUIRE_QPDF === "1") {
  await run("qpdf", ["--check", output]);
}

console.log("engine object reflow structural move passed");
