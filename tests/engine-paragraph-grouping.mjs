import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const root = process.cwd();
const enginePython = process.env.PDF_ENGINE_PYTHON ||
  (existsSync(path.join(root, ".venv", "bin", "python")) ? path.join(root, ".venv", "bin", "python") : "python3");

function run(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command === "python3" ? enginePython : command, args, { cwd: root });
    const stdout = [];
    const stderr = [];
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
  page.drawText("Header should be excluded", { x: 72, y: 752, size: 9, font });
  page.drawText("First body sentence keeps order.", { x: 72, y: 650, size: 12, font });
  page.drawText("Second body sentence joins softly.", { x: 72, y: 636, size: 12, font });
  page.drawText("Figure 1. Caption stays separate.", { x: 72, y: 580, size: 10, font });
  page.drawText("1", { x: 304, y: 36, size: 10, font });
  await fs.writeFile(filePath, await document.save());
}

function roleFor(block, medianFontSize) {
  const text = block.text.trim();
  if (block.y < 0.055 && block.height < 0.06) return "header";
  if (block.y > 0.89 || /^[\s-]*\d+[\s-]*$/.test(text)) return "footer";
  if (/^(figure|fig\.|table|표|그림)\s*\d+[\s.:)-]/i.test(text)) return "caption";
  if (block.lineCount <= 2 && block.y < 0.28 && block.fontSize >= medianFontSize * 1.22) return "title";
  return "body";
}

const fixture = path.join(root, "tmp", "engine-paragraph-grouping.pdf");
await createFixture(fixture);
const raw = await run("python3", [
  "-c",
  [
    "import json, fitz, sys",
    "doc = fitz.open(sys.argv[1])",
    "page = doc[0]",
    "items = []",
    "for block in page.get_text('dict')['blocks']:",
    "  if block.get('type') != 0: continue",
    "  for line in block.get('lines', []):",
    "    spans = line.get('spans', [])",
    "    if not spans: continue",
    "    text = ''.join(span.get('text','') for span in spans).strip()",
    "    if not text: continue",
    "    bbox = line['bbox']",
    "    items.append({'text': text, 'x': bbox[0]/612, 'y': bbox[1]/792, 'width': (bbox[2]-bbox[0])/612, 'height': (bbox[3]-bbox[1])/792, 'fontSize': max(span.get('size', 12) for span in spans), 'lineCount': 1})",
    "print(json.dumps(items))",
    "doc.close()",
  ].join("\n"),
  fixture,
]);

const lines = JSON.parse(raw);
const median = [...lines].map((line) => line.fontSize).sort((a, b) => a - b)[Math.floor(lines.length / 2)];
const bodyLines = lines.filter((line) => roleFor(line, median) === "body");
const bodyText = bodyLines.map((line) => line.text).join(" ");
if (bodyText !== "First body sentence keeps order. Second body sentence joins softly.") {
  throw new Error(`body paragraph order was not preserved: ${bodyText}`);
}
if (!lines.some((line) => roleFor(line, median) === "caption" && line.text.startsWith("Figure 1."))) {
  throw new Error("caption was not classified separately from body text");
}
if (!lines.some((line) => roleFor(line, median) === "header")) {
  throw new Error("header was not classified separately");
}
if (!lines.some((line) => roleFor(line, median) === "footer")) {
  throw new Error("footer was not classified separately");
}

console.log("engine paragraph grouping heuristic passed");
