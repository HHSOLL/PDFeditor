import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  extractText,
  inspectPdf,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-signature-simple");
const inputPath = path.join(workDir, "signature-source.pdf");
const outputPath = path.join(workDir, "signature-output.pdf");
const signaturePng = path.join(workDir, "signature.png");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createSourcePdf(inputPath);
await createSignaturePng(signaturePng);
const signatureDataUrl = `data:image/png;base64,${(await fs.readFile(signaturePng)).toString("base64")}`;

await applyEngine(inputPath, outputPath, {
  saveOptions: { annotationMode: "flatten", redactionMode: "textOnly", validate: true },
  operations: [
    {
      type: "typedSignature",
      pageIndex: 0,
      x: 72 / 612,
      y: 140 / 792,
      width: 220 / 612,
      height: 36 / 792,
      signerName: "Typed Signature: Hong Gildong",
      fontSize: 16,
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
    {
      type: "drawnSignature",
      pageIndex: 0,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      color: "#111111",
      opacity: 1,
      strokeWidth: 3,
      points: [
        { x: 72 / 612, y: 220 / 792 },
        { x: 110 / 612, y: 205 / 792 },
        { x: 150 / 612, y: 225 / 792 },
        { x: 210 / 612, y: 205 / 792 },
      ],
    },
    {
      type: "signatureImage",
      pageIndex: 0,
      x: 72 / 612,
      y: 260 / 792,
      width: 160 / 612,
      height: 60 / 792,
      dataUrl: signatureDataUrl,
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
  ],
}, "signature-simple");

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`simple signature PDF did not validate: ${JSON.stringify(validation)}`);
}
const text = await extractText(outputPath);
if (!text.includes("Typed Signature: Hong Gildong")) {
  throw new Error(`typed signature was not saved as searchable text: ${text}`);
}
const info = await inspectPdf(outputPath);
if (info.pages[0].drawings < 1 || info.pages[0].images < 1) {
  throw new Error(`drawn/image signatures were not saved as page content: ${JSON.stringify(info.pages[0])}`);
}

async function createSourcePdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Simple signature fixture', fontsize=18)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function createSignaturePng(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import struct, sys, zlib",
      "def chunk(tag, data):",
      "    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)",
      "width, height = 80, 30",
      "rows = []",
      "for y in range(height):",
      "    row = bytearray()",
      "    row.append(0)",
      "    for x in range(width):",
      "        ink = abs(y - (10 + (x % 30) // 4)) < 2",
      "        row.extend((20, 20, 20) if ink else (255, 255, 255))",
      "    rows.append(bytes(row))",
      "raw = b''.join(rows)",
      "png = b'\\x89PNG\\r\\n\\x1a\\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')",
      "open(sys.argv[1], 'wb').write(png)",
    ].join("\n"),
    filePath,
  ]);
}
