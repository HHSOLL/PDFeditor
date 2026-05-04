import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  extractText,
  inspectPdf,
  renderClipBrightness,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-redaction-policy");
const inputPath = path.join(workDir, "redaction-source.pdf");
const textRect = { x: 24 / 300, y: 22 / 200, width: 180 / 300, height: 28 / 200 };
const visualRect = { x: 24 / 300, y: 70 / 200, width: 124 / 300, height: 112 / 200 };

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createRedactionFixture(inputPath);

const expectations = new Map([
  ["textOnly", { imageShouldRemain: true, clipShouldBeClean: null }],
  ["visualArea", { imageShouldRemain: null, clipShouldBeClean: true }],
  ["imagesAndText", { imageShouldRemain: false, clipShouldBeClean: true }],
]);

for (const [mode, expectation] of expectations.entries()) {
  const outputPath = path.join(workDir, `redacted-${mode}.pdf`);
  await applyEngine(inputPath, outputPath, createPayload(mode), mode);

  const validation = await validatePdf(outputPath);
  if (!validation.ok || !validation.qpdfChecked) {
    throw new Error(`${mode} validation failed: ${JSON.stringify(validation)}`);
  }

  const text = await extractText(outputPath);
  if (text.includes("SECRET_TEXT")) {
    throw new Error(`${mode} left redacted text extractable: ${text}`);
  }

  const raw = await fs.readFile(outputPath, "utf8");
  if (raw.includes("SECRET_TEXT")) {
    throw new Error(`${mode} left redacted text in raw PDF bytes`);
  }

  const info = await inspectPdf(outputPath);
  const imageCount = info.pages[0].images;
  if (expectation.imageShouldRemain === true && imageCount < 1) {
    throw new Error(`${mode} removed images unexpectedly: ${JSON.stringify(info)}`);
  }
  if (expectation.imageShouldRemain === false && imageCount !== 0) {
    throw new Error(`${mode} did not remove touched image objects: ${JSON.stringify(info)}`);
  }

  const clip = await renderClipBrightness(outputPath, visualRect);
  if (expectation.clipShouldBeClean === true && clip.brightness < 245) {
    throw new Error(`${mode} did not clean the visual redaction area: ${JSON.stringify(clip)}`);
  }
}

async function createRedactionFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=300, height=200)",
      "pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 16, 16), False)",
      "pix.clear_with(0xff0000)",
      "page.insert_text((28, 42), 'SECRET_TEXT', fontsize=16, color=(0, 0, 0))",
      "page.insert_image(fitz.Rect(30, 78, 130, 132), pixmap=pix)",
      "page.draw_rect(fitz.Rect(30, 146, 130, 174), color=(0, 0, 1), fill=(0, 0, 1))",
      "page.insert_text((32, 102), 'PUBLIC_IMAGE_LABEL', fontsize=10, color=(1, 1, 1))",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

function createPayload(redactionMode) {
  return {
    pages: [{ sourceIndex: 0, rotation: 0 }],
    metadata: {
      title: `Redaction ${redactionMode}`,
      creator: "PDF Studio",
      producer: "PDF Studio Engine",
    },
    saveOptions: {
      annotationMode: "flatten",
      redactionMode,
      validate: true,
    },
    operations: [
      {
        type: "redact",
        pageIndex: 0,
        ...textRect,
      },
      {
        type: "redact",
        pageIndex: 0,
        ...visualRect,
      },
    ],
  };
}
