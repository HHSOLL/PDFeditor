import fs from "node:fs/promises";
import path from "node:path";
import { enginePath, runProcess, validatePdf } from "./helpers/pdf-engine-test-utils.mjs";

const root = process.cwd();
const manifestPath = path.join(root, "tests", "corpus", "manifest.json");
const generatedManifestPath = path.join(root, "tmp", "engine-corpus-100", "manifest.json");
const reportDir = path.join(root, "tmp", "corpus-manifest-smoke");
const reportPath = path.join(reportDir, "report.json");
const surrogateDir = path.join(reportDir, "surrogate-pdfs");

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

const requiredTopLevel = ["version", "targetExternalEntries", "claimPolicy", "categories"];
for (const field of requiredTopLevel) {
  if (!(field in manifest)) {
    throw new Error(`corpus manifest missing top-level field ${field}`);
  }
}

if (!Array.isArray(manifest.categories) || manifest.categories.length === 0) {
  throw new Error("corpus manifest must contain categories");
}

const requiredCategoryFields = [
  "slug",
  "idPrefix",
  "requiredCount",
  "sourceOrGeneration",
  "licensePrivacy",
  "storagePolicy",
  "assertions",
  "expectedBehavior",
  "manualSmokeRequired",
];

const requiredCategories = new Set([
  "acrobat-created",
  "acrobat-edited",
  "acrobat-signed",
  "acroform-xfa",
  "preview-annotated",
  "chrome-generated",
  "edge-generated",
  "office-word",
  "office-excel",
  "office-powerpoint",
  "government-contract-bank-tax",
  "scanned-korean-english",
  "cjk-emoji-rtl",
  "tagged-pdfa-pdfx-accessibility",
  "hidden-data-security",
  "malformed-large",
]);

const seenSlugs = new Set();
const plannedEntries = [];
for (const category of manifest.categories) {
  for (const field of requiredCategoryFields) {
    if (!(field in category)) {
      throw new Error(`corpus category ${category.slug ?? "<unknown>"} missing field ${field}`);
    }
  }
  if (seenSlugs.has(category.slug)) {
    throw new Error(`duplicate corpus category slug ${category.slug}`);
  }
  seenSlugs.add(category.slug);
  if (!Number.isInteger(category.requiredCount) || category.requiredCount <= 0) {
    throw new Error(`category ${category.slug} has invalid requiredCount`);
  }
  if (!Array.isArray(category.assertions) || category.assertions.length === 0) {
    throw new Error(`category ${category.slug} must list protected assertions`);
  }
  if (category.manualSmokeRequired !== true) {
    throw new Error(`category ${category.slug} must require manual smoke for external full credit`);
  }
  for (let index = 1; index <= category.requiredCount; index += 1) {
    plannedEntries.push({
      id: `${category.idPrefix}-${String(index).padStart(3, "0")}`,
      category: category.slug,
      status: "pending-acquisition",
      assertions: category.assertions,
      manualSmokeRequired: category.manualSmokeRequired,
    });
  }
}

const missingCategories = [...requiredCategories].filter((slug) => !seenSlugs.has(slug));
if (missingCategories.length > 0) {
  throw new Error(`corpus manifest missing required categories: ${missingCategories.join(", ")}`);
}

if (plannedEntries.length < manifest.targetExternalEntries || plannedEntries.length < 100) {
  throw new Error(
    `corpus manifest only plans ${plannedEntries.length} external entries, target is ${manifest.targetExternalEntries}`,
  );
}

let generatedCorpusCount = 0;
try {
  const generatedManifest = JSON.parse(await fs.readFile(generatedManifestPath, "utf8"));
  generatedCorpusCount = Number(generatedManifest.count ?? generatedManifest.files?.length ?? 0);
  if (generatedCorpusCount !== 100) {
    throw new Error(`expected generated 100-PDF corpus manifest count 100, got ${generatedCorpusCount}`);
  }
} catch (error) {
  throw new Error(
    `generated corpus manifest is missing or invalid; run REQUIRE_QPDF=1 node tests/engine-corpus-100.mjs first: ${error.message}`,
  );
}

const manualCreditViolations = [];
if (manifest.claimPolicy?.manualSmokeRequiredForFullCredit !== true) {
  manualCreditViolations.push("claimPolicy.manualSmokeRequiredForFullCredit must be true");
}
if (manifest.claimPolicy?.privateOrCopyrightedPdfsCommitted !== false) {
  manualCreditViolations.push("claimPolicy.privateOrCopyrightedPdfsCommitted must be false");
}
if (manifest.claimPolicy?.external90PlusBlockedUntilRepresentativeManualSmokePasses !== true) {
  manualCreditViolations.push("claimPolicy.external90PlusBlockedUntilRepresentativeManualSmokePasses must be true");
}
if (manualCreditViolations.length > 0) {
  throw new Error(manualCreditViolations.join("; "));
}

await fs.rm(surrogateDir, { force: true, recursive: true });
await fs.mkdir(surrogateDir, { recursive: true });
const surrogateManifestPath = path.join(surrogateDir, "manifest-input.json");
await fs.writeFile(surrogateManifestPath, JSON.stringify(plannedEntries, null, 2));
await runProcess("python3", [
  "-c",
  [
    "import fitz, json, pathlib, sys",
    "entries = json.loads(pathlib.Path(sys.argv[1]).read_text())",
    "out = pathlib.Path(sys.argv[2])",
    "out.mkdir(parents=True, exist_ok=True)",
    "def add_common(page, entry):",
    "    page.insert_text((54, 58), f\"{entry['id']} {entry['category']}\", fontsize=15, fontname='helv')",
    "    page.insert_text((54, 84), 'PDFeditor reproducible external-corpus surrogate fixture.', fontsize=9, fontname='helv')",
    "    page.insert_text((54, 100), 'This file is generated for automated smoke, not counted as manual compatibility evidence.', fontsize=9, fontname='helv')",
    "    y = 126",
    "    for assertion in entry['assertions'][:8]:",
    "        page.insert_text((70, y), f'- {assertion}', fontsize=9, fontname='helv')",
    "        y += 16",
    "def draw_table(page, x=54, y=220):",
    "    for row in range(5):",
    "        for col in range(3):",
    "            rect = fitz.Rect(x + col * 120, y + row * 26, x + col * 120 + 118, y + row * 26 + 24)",
    "            page.draw_rect(rect, color=(0.2, 0.2, 0.2), width=0.4)",
    "            page.insert_text((rect.x0 + 5, rect.y0 + 16), f'R{row+1} C{col+1}', fontsize=8, fontname='helv')",
    "def draw_vector(page):",
    "    shape = page.new_shape()",
    "    shape.draw_rect(fitz.Rect(74, 240, 220, 330))",
    "    shape.draw_line(fitz.Point(74, 240), fitz.Point(220, 330))",
    "    shape.draw_line(fitz.Point(220, 240), fitz.Point(74, 330))",
    "    shape.finish(color=(0.0, 0.25, 0.65), fill=(0.86, 0.92, 1.0), width=1.2)",
    "    shape.commit()",
    "for i, entry in enumerate(entries):",
    "    doc = fitz.open()",
    "    page_count = 2 if entry['category'] in ('malformed-large', 'acrobat-edited', 'office-excel') else 1",
    "    for pno in range(page_count):",
    "        page = doc.new_page(width=612 if i % 4 else 640, height=792 if i % 5 else 842)",
    "        add_common(page, entry)",
    "        page.insert_text((54, 188), f'Page {pno + 1} generated category sample with searchable text.', fontsize=10, fontname='helv')",
    "        category = entry['category']",
    "        if category in ('acrobat-created', 'acrobat-edited', 'office-word', 'cjk-emoji-rtl'):",
    "            page.insert_text((54, 230), 'Paragraph one keeps structure for reflow and extraction tests.', fontsize=10, fontname='helv')",
    "            page.insert_text((54, 250), 'Paragraph two follows downstream and should remain searchable after export.', fontsize=10, fontname='helv')",
    "            page.insert_text((54, 276), 'Korean sample: 안녕하세요 PDF 편집 테스트', fontsize=10, fontname='helv')",
    "        if category in ('acroform-xfa', 'government-contract-bank-tax', 'office-excel'):",
    "            draw_table(page)",
    "        if category in ('preview-annotated',):",
    "            annot = page.add_text_annot((470, 120), f\"Preview-style note {entry['id']}\")",
    "            annot.update()",
    "            page.add_highlight_annot(fitz.Rect(54, 188, 300, 204))",
    "        if category in ('chrome-generated', 'edge-generated'):",
    "            link_rect = fitz.Rect(54, 226, 260, 244)",
    "            page.insert_text((link_rect.x0, link_rect.y1 - 4), 'https://example.test/pdfeditor', fontsize=10, fontname='helv')",
    "            page.insert_link({'kind': fitz.LINK_URI, 'from': link_rect, 'uri': 'https://example.test/pdfeditor'})",
    "        if category in ('office-powerpoint', 'hidden-data-security'):",
    "            draw_vector(page)",
    "        if category in ('scanned-korean-english',):",
    "            page.draw_rect(fitz.Rect(54, 226, 420, 350), color=(0.45, 0.45, 0.45), fill=(0.96, 0.96, 0.96), width=0.8)",
    "            page.insert_text((72, 270), 'Simulated scan text: OCR surrogate English Korean 안녕', fontsize=12, fontname='helv')",
    "        if category in ('tagged-pdfa-pdfx-accessibility',):",
    "            doc.set_metadata({'title': f\"Tagged surrogate {entry['id']}\", 'author': 'PDFeditor tests', 'subject': 'accessibility preflight surrogate'})",
    "        if category in ('acrobat-signed',):",
    "            page.draw_rect(fitz.Rect(54, 250, 300, 306), color=(0, 0, 0), width=0.6)",
    "            page.insert_text((66, 282), 'Signature field surrogate - certificate smoke required manually', fontsize=9, fontname='helv')",
    "    if entry['category'] == 'hidden-data-security':",
    "        doc.set_metadata({'keywords': f\"hidden-data-surrogate {entry['id']}\", 'creator': 'PDFeditor corpus smoke'})",
    "    target = out / f\"{entry['id']}-{entry['category']}.pdf\"",
    "    doc.save(target, garbage=4, deflate=True, clean=True)",
    "    doc.close()",
  ].join("\n"),
  surrogateManifestPath,
  surrogateDir,
]);

const surrogateFiles = (await fs.readdir(surrogateDir))
  .filter((entry) => entry.endsWith(".pdf"))
  .sort();
if (surrogateFiles.length !== plannedEntries.length) {
  throw new Error(`expected ${plannedEntries.length} surrogate PDFs, got ${surrogateFiles.length}`);
}

const surrogateSmoke = [];
for (const file of surrogateFiles) {
  const filePath = path.join(surrogateDir, file);
  const validation = await validatePdf(filePath);
  if (!validation.ok || !validation.qpdfChecked || validation.pageCount < 1) {
    throw new Error(`surrogate PDF failed validation ${file}: ${JSON.stringify(validation)}`);
  }
  surrogateSmoke.push({
    file,
    pageCount: validation.pageCount,
    textLength: validation.textLength,
    qpdfChecked: validation.qpdfChecked,
  });
}

const representative = path.join(surrogateDir, surrogateFiles[0]);
const { stdout } = await runProcess("python3", [
  enginePath,
  "preflight",
  "--input",
  representative,
  "--stdout",
]);
const preflight = JSON.parse(stdout);
if (!preflight.validation?.ok || preflight.pageCount < 1) {
  throw new Error(`representative surrogate preflight failed: ${JSON.stringify(preflight)}`);
}

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(
  reportPath,
  JSON.stringify(
    {
      ok: true,
      generatedCorpusCount,
      plannedExternalEntries: plannedEntries.length,
      surrogateGeneratedEntries: surrogateSmoke.length,
      surrogateDirectory: surrogateDir,
      categories: manifest.categories.map((category) => ({
        slug: category.slug,
        requiredCount: category.requiredCount,
        assertions: category.assertions,
        manualSmokeRequired: category.manualSmokeRequired,
      })),
      plannedEntries,
      surrogateSmoke,
      claimBoundary:
        "Generated surrogate PDFs prove automated coverage plumbing only. External 90+ and full Acrobat replacement claims remain blocked until real/reproducible corpus entries and representative manual smoke records pass.",
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify({
    ok: true,
    generatedCorpusCount,
    plannedExternalEntries: plannedEntries.length,
    surrogateGeneratedEntries: surrogateSmoke.length,
    reportPath,
  }),
);
