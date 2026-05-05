import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  inspectPdf,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-image-move");
const inputPath = path.join(workDir, "image-move-source.pdf");
const outputPath = path.join(workDir, "image-move-output.pdf");
const redPng = path.join(workDir, "red.png");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createPng(redPng);
await createImageFixture(inputPath, redPng);
await applyEngine(inputPath, outputPath, createPayload(), "image-move");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`moved image PDF did not validate: ${JSON.stringify(validation)}`);
}
const info = await inspectPdf(outputPath);
if (info.pages[0].images !== 1) {
  throw new Error(`moving an image should remove the source occurrence and leave one image: ${JSON.stringify(info.pages[0])}`);
}
const original = await sampleColor(outputPath, { x0: 80, y0: 120, x1: 180, y1: 200 });
const moved = await sampleColor(outputPath, { x0: 260, y0: 320, x1: 360, y1: 400 });
if (!(original.red > 240 && original.green > 240 && original.blue > 240)) {
  throw new Error(`source image area was not cleared: ${JSON.stringify(original)}`);
}
if (!(moved.red > 180 && moved.red > moved.blue * 2)) {
  throw new Error(`moved image target area is not red: ${JSON.stringify(moved)}`);
}

async function createPng(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import struct, sys, zlib",
      "def chunk(tag, data):",
      "    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)",
      "width = height = 24",
      "raw = b''.join(b'\\x00' + bytes([230, 20, 20]) * width for _ in range(height))",
      "png = b'\\x89PNG\\r\\n\\x1a\\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')",
      "open(sys.argv[1], 'wb').write(png)",
    ].join("\n"),
    filePath,
  ]);
}

async function createImageFixture(filePath, imagePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Image move fixture', fontsize=18)",
      "page.insert_image(fitz.Rect(72, 120, 192, 210), filename=sys.argv[2], keep_proportion=False)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
    imagePath,
  ]);
}

async function sampleColor(filePath, rect) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "rect = json.loads(sys.argv[2])",
      "doc = fitz.open(sys.argv[1])",
      "pix = doc[0].get_pixmap(matrix=fitz.Matrix(1, 1), clip=fitz.Rect(rect['x0'], rect['y0'], rect['x1'], rect['y1']), alpha=False)",
      "red = green = blue = count = 0",
      "for index in range(0, len(pix.samples), pix.n):",
      "    red += pix.samples[index]",
      "    green += pix.samples[index + 1]",
      "    blue += pix.samples[index + 2]",
      "    count += 1",
      "print(json.dumps({'red': red / count, 'green': green / count, 'blue': blue / count}))",
      "doc.close()",
    ].join("\n"),
    filePath,
    JSON.stringify(rect),
  ]);
  return JSON.parse(stdout);
}

function createPayload() {
  return {
    saveOptions: {
      annotationMode: "flatten",
      redactionMode: "imagesAndText",
      validate: true,
    },
    operations: [
      {
        type: "moveImage",
        pageIndex: 0,
        sourceImageId: "0:999999:0:0",
        eraseOriginal: {
          x: 72 / 612,
          y: 120 / 792,
          width: 120 / 612,
          height: 90 / 792,
        },
        x: 252 / 612,
        y: 312 / 792,
        width: 120 / 612,
        height: 90 / 792,
      },
    ],
  };
}
