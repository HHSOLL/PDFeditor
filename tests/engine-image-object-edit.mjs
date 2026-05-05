import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  inspectPdf,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-image-object-edit");
const inputPath = path.join(workDir, "image-source.pdf");
const outputPath = path.join(workDir, "image-output.pdf");
const redPng = path.join(workDir, "red.png");
const bluePng = path.join(workDir, "blue.png");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createPng(redPng, 230, 20, 20);
await createPng(bluePng, 20, 80, 230);
await createImageFixture(inputPath, redPng);
const blueDataUrl = `data:image/png;base64,${(await fs.readFile(bluePng)).toString("base64")}`;
await applyEngine(inputPath, outputPath, createPayload(blueDataUrl), "image-object-edit");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked || validation.pageCount !== 1) {
  throw new Error(`image object edit validation failed: ${JSON.stringify(validation)}`);
}

const info = await inspectPdf(outputPath);
if (info.pages[0].images !== 1) {
  throw new Error(`image replacement should leave exactly one image object, got ${info.pages[0].images}`);
}

const color = await sampleImageColor(outputPath);
if (!(color.blue > 150 && color.blue > color.red * 2)) {
  throw new Error(`replacement image is not visibly blue: ${JSON.stringify(color)}`);
}

async function createPng(filePath, red, green, blue) {
  await runProcess("python3", [
    "-c",
    [
      "import struct, sys, zlib",
      "def chunk(tag, data):",
      "    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)",
      "width = height = 24",
      "r, g, b = [int(value) for value in sys.argv[2:5]]",
      "raw = b''.join(b'\\x00' + bytes([r, g, b]) * width for _ in range(height))",
      "png = b'\\x89PNG\\r\\n\\x1a\\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')",
      "open(sys.argv[1], 'wb').write(png)",
    ].join("\n"),
    filePath,
    String(red),
    String(green),
    String(blue),
  ]);
}

async function createImageFixture(filePath, imagePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Image replacement fixture', fontsize=18)",
      "page.insert_image(fitz.Rect(72, 120, 192, 210), filename=sys.argv[2], keep_proportion=False)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
    imagePath,
  ]);
}

async function sampleImageColor(filePath) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "doc = fitz.open(sys.argv[1])",
      "page = doc[0]",
      "clip = fitz.Rect(80, 130, 180, 200)",
      "pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), clip=clip, alpha=False)",
      "data = pix.samples",
      "red = green = blue = count = 0",
      "for index in range(0, len(data), pix.n):",
      "    red += data[index]",
      "    green += data[index + 1]",
      "    blue += data[index + 2]",
      "    count += 1",
      "print(json.dumps({'red': red / count, 'green': green / count, 'blue': blue / count}))",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
  return JSON.parse(stdout);
}

function createPayload(dataUrl) {
  const rect = {
    pageIndex: 0,
    x: 72 / 612,
    y: 120 / 792,
    width: 120 / 612,
    height: 90 / 792,
  };
  return {
    saveOptions: {
      annotationMode: "flatten",
      redactionMode: "imagesAndText",
      validate: true,
    },
    operations: [
      {
        type: "deleteImage",
        ...rect,
      },
      {
        type: "image",
        ...rect,
        dataUrl,
        color: "#172026",
        opacity: 1,
        strokeWidth: 1,
      },
    ],
  };
}
