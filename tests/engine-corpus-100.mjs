import fs from "node:fs/promises";
import path from "node:path";
import { enginePath, root, runProcess, validatePdf } from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-corpus-100");
const manifestPath = path.join(workDir, "manifest.json");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });

await runProcess("python3", [
  "-c",
  [
    "import fitz, json, pathlib, sys",
    "out = pathlib.Path(sys.argv[1])",
    "entries = []",
    "categories = ['text', 'contract', 'invoice', 'form-like', 'annotation-like', 'image-heavy', 'vector-heavy', 'table-heavy', 'multicolumn', 'large-page']",
    "for i in range(100):",
    "    category = categories[i % len(categories)]",
    "    doc = fitz.open()",
    "    width = 612 + (90 if category == 'large-page' else 0)",
    "    height = 792 if i % 3 else 842",
    "    page = doc.new_page(width=width, height=height)",
    "    page.insert_text((54, 64), f'Corpus {i:03d} {category}', fontsize=18, fontname='helv')",
    "    page.insert_text((54, 104), 'External replacement smoke corpus generated without copyrighted fixtures.', fontsize=10, fontname='helv')",
    "    page.insert_text((54, 126), 'Open render export reopen preflight qpdf pymupdf pdfjs representative smoke.', fontsize=10, fontname='helv')",
    "    if category in ('table-heavy', 'form-like'):",
    "        for row in range(6):",
    "            y = 170 + row * 26",
    "            page.draw_rect(fitz.Rect(54, y, 420, y + 24), color=(0, 0, 0), width=0.4)",
    "            page.insert_text((62, y + 16), f'Row {row} value {i}-{row}', fontsize=9, fontname='helv')",
    "    if category in ('image-heavy', 'annotation-like'):",
    "        shape = page.new_shape()",
    "        shape.draw_rect(fitz.Rect(70, 190, 260, 320))",
    "        shape.finish(color=(0.1, 0.4, 0.7), fill=(0.85, 0.92, 1), width=1)",
    "        shape.commit()",
    "    if category in ('vector-heavy', 'multicolumn'):",
    "        for col in range(2):",
    "            x = 54 + col * 240",
    "            for line in range(9):",
    "                page.insert_text((x, 180 + line * 18), f'Column {col + 1} line {line + 1} corpus {i}', fontsize=9, fontname='helv')",
    "    if i % 11 == 0:",
    "        annot = page.add_text_annot((480, 120), f'Note {i}')",
    "        annot.update()",
    "    target = out / f'corpus-{i:03d}-{category}.pdf'",
    "    doc.save(target, garbage=4, deflate=True, clean=True)",
    "    doc.close()",
    "    entries.append({'id': f'corpus-{i:03d}', 'category': category, 'path': str(target), 'assertions': ['open', 'validate', 'qpdf-check', 'preflight']})",
    "print(json.dumps(entries))",
  ].join("\n"),
  workDir,
]);

const files = (await fs.readdir(workDir))
  .filter((entry) => entry.endsWith(".pdf"))
  .sort();

if (files.length !== 100) {
  throw new Error(`expected 100 generated corpus PDFs, got ${files.length}`);
}

const manifest = [];
for (const file of files) {
  const filePath = path.join(workDir, file);
  const validation = await validatePdf(filePath);
  if (!validation.ok || !validation.qpdfChecked) {
    throw new Error(`corpus PDF failed validation ${file}: ${JSON.stringify(validation)}`);
  }
  manifest.push({
    file,
    pageCount: validation.pageCount,
    textLength: validation.textLength,
    qpdfChecked: validation.qpdfChecked,
  });
}

const representative = path.join(workDir, files[0]);
const { stdout } = await runProcess("python3", [
  enginePath,
  "preflight",
  "--input",
  representative,
  "--stdout",
]);
const preflight = JSON.parse(stdout);
if (!preflight.validation?.ok || preflight.pageCount !== 1) {
  throw new Error(`representative corpus preflight failed: ${JSON.stringify(preflight)}`);
}

await fs.writeFile(manifestPath, JSON.stringify({ count: manifest.length, files: manifest }, null, 2));
