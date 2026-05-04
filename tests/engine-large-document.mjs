import fs from "node:fs/promises";
import path from "node:path";
import {
  inspectPdf,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-large-document");
const pageCounts = [100, 300, 500];

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });

for (const pageCount of pageCounts) {
  const filePath = path.join(workDir, `generated-${pageCount}-pages.pdf`);
  const started = Date.now();
  await createLargeFixture(filePath, pageCount);
  const validation = await validatePdf(filePath);
  if (!validation.ok || !validation.qpdfChecked || validation.pageCount !== pageCount) {
    throw new Error(`large document validation failed for ${pageCount}: ${JSON.stringify(validation)}`);
  }
  const info = await inspectPdf(filePath);
  if (info.pageCount !== pageCount) {
    throw new Error(`large document page count mismatch: expected ${pageCount}, got ${info.pageCount}`);
  }
  const elapsed = Date.now() - started;
  if (pageCount === 100 && elapsed > 10_000) {
    throw new Error(`100 page fixture validation is too slow for local gate: ${elapsed}ms`);
  }
}

async function createLargeFixture(filePath, pageCount) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "path = sys.argv[1]",
      "page_count = int(sys.argv[2])",
      "doc = fitz.open()",
      "for index in range(page_count):",
      "    page = doc.new_page(width=612, height=792)",
      "    page.insert_text((72, 92), f'Generated large PDF page {index + 1}', fontsize=16)",
      "    page.insert_text((72, 130), 'This page is intentionally lightweight for viewport performance regression.', fontsize=10)",
      "doc.save(path, deflate=True)",
      "doc.close()",
    ].join("\n"),
    filePath,
    String(pageCount),
  ]);
}
