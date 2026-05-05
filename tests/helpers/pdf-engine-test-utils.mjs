import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const root = process.cwd();
export const enginePath = path.join(root, "engine", "pdf_engine.py");
export const enginePython = process.env.PDF_ENGINE_PYTHON ||
  (existsSync(path.join(root, ".venv", "bin", "python")) ? path.join(root, ".venv", "bin", "python") : "python3");

export function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const resolvedCommand = command === "python3" ? enginePython : command;
    const child = spawn(resolvedCommand, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
        reject(new Error(`${resolvedCommand} ${args.join(" ")} exited ${code}\n${output.stderr}`));
        return;
      }
      resolve(output);
    });
  });
}

export async function applyEngine(inputPath, outputPath, payload, name = "ops") {
  const opsPath = path.join(path.dirname(outputPath), `${name}.json`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(opsPath, JSON.stringify(payload, null, 2));
  await runProcess("python3", [
    enginePath,
    "apply",
    "--input",
    inputPath,
    "--ops",
    opsPath,
    "--output",
    outputPath,
  ]);
}

export async function validatePdf(filePath) {
  const { stdout } = await runProcess("python3", [
    enginePath,
    "validate",
    "--input",
    filePath,
    "--stdout",
  ]);
  return JSON.parse(stdout);
}

export async function extractText(filePath, password = "") {
  const args = [enginePath, "extract", "--input", filePath];
  if (password) {
    args.push("--password", password);
  }
  const { stdout } = await runProcess("python3", args);
  const extracted = JSON.parse(stdout);
  return extracted.pages
    .flatMap((page) => page.spans.map((span) => span.text))
    .join(" ");
}

export async function inspectPdf(filePath) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "doc = fitz.open(sys.argv[1])",
      "pages = []",
      "for page in doc:",
      "    pages.append({'rotation': page.rotation, 'width': page.rect.width, 'height': page.rect.height, 'images': len(page.get_images(full=True)), 'drawings': len(page.get_drawings()), 'annots': len(list(page.annots() or [])), 'text': page.get_text('text')})",
      "print(json.dumps({'pageCount': doc.page_count, 'pages': pages}, ensure_ascii=False))",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
  return JSON.parse(stdout);
}

export async function renderDiffMetrics(beforePath, afterPath, rect) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "rect = json.loads(sys.argv[3])",
      "scale = 2",
      "before = fitz.open(sys.argv[1])",
      "after = fitz.open(sys.argv[2])",
      "pix_a = before[0].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)",
      "pix_b = after[0].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)",
      "w, h, n = pix_a.width, pix_a.height, pix_a.n",
      "box = (int(rect['x'] * w), int(rect['y'] * h), int((rect['x'] + rect['width']) * w), int((rect['y'] + rect['height']) * h))",
      "inside_total = outside_total = inside_count = outside_count = 0",
      "data_a = pix_a.samples",
      "data_b = pix_b.samples",
      "for y in range(h):",
      "    for x in range(w):",
      "        idx = (y * w + x) * n",
      "        diff = 0",
      "        for c in range(3):",
      "            diff += abs(data_a[idx + c] - data_b[idx + c])",
      "        diff /= 3",
      "        if box[0] <= x <= box[2] and box[1] <= y <= box[3]:",
      "            inside_total += diff",
      "            inside_count += 1",
      "        else:",
      "            outside_total += diff",
      "            outside_count += 1",
      "print(json.dumps({'insideMean': inside_total / max(1, inside_count), 'outsideMean': outside_total / max(1, outside_count), 'width': w, 'height': h}))",
      "before.close(); after.close()",
    ].join("\n"),
    beforePath,
    afterPath,
    JSON.stringify(rect),
  ]);
  return JSON.parse(stdout);
}

export async function renderClipBrightness(filePath, rect) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "rect = json.loads(sys.argv[2])",
      "doc = fitz.open(sys.argv[1])",
      "page = doc[0]",
      "clip = fitz.Rect(rect['x'] * page.rect.width, rect['y'] * page.rect.height, (rect['x'] + rect['width']) * page.rect.width, (rect['y'] + rect['height']) * page.rect.height)",
      "pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)",
      "data = pix.samples",
      "total = 0",
      "for idx in range(0, len(data), pix.n):",
      "    total += sum(data[idx:idx+3]) / 3",
      "print(json.dumps({'brightness': total / max(1, pix.width * pix.height), 'width': pix.width, 'height': pix.height}))",
      "doc.close()",
    ].join("\n"),
    filePath,
    JSON.stringify(rect),
  ]);
  return JSON.parse(stdout);
}
