import fs from "node:fs/promises";
import path from "node:path";
import { applyEngine, runProcess, validatePdf } from "./helpers/pdf-engine-test-utils.mjs";

const root = process.cwd();
const workDir = path.join(root, "tmp", "engine-annotations");
const inputPath = path.join(workDir, "input.pdf");
const outputPath = path.join(workDir, "output.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createAnnotatedPdf(inputPath);

const before = await readAnnotations(inputPath);
if (before.length !== 2) {
  throw new Error(`expected two source annotations before edit: ${JSON.stringify(before)}`);
}

await applyEngine(inputPath, outputPath, {
  pages: [{ sourceIndex: 0, rotation: 0 }],
  operations: [
    {
      type: "deleteAnnotation",
      pageIndex: 0,
      x: 60 / 612,
      y: 65 / 792,
      width: 200 / 612,
      height: 55 / 792,
      annotationSubtype: "Highlight",
      sourceAnnotationId: "legacy-highlight",
    },
    {
      type: "deleteAnnotation",
      pageIndex: 0,
      x: 64 / 612,
      y: 112 / 792,
      width: 130 / 612,
      height: 80 / 792,
      annotationSubtype: "Square",
      sourceAnnotationId: "legacy-square",
    },
    {
      type: "rect",
      pageIndex: 0,
      x: 300 / 612,
      y: 120 / 792,
      width: 120 / 612,
      height: 64 / 792,
      color: "#176b58",
      opacity: 1,
      strokeWidth: 2,
    },
  ],
  metadata: {
    title: "Annotation roundtrip",
    author: "PDF Studio",
    subject: "Existing annotation deletion",
    keywords: "pdf,annotation",
    creator: "PDF Studio",
    producer: "PDF Studio Engine",
  },
  saveOptions: {
    annotationMode: "native",
    redactionMode: "textOnly",
    validate: true,
  },
}, "annotation-delete");

const after = await readAnnotations(outputPath);
const legacyAnnotations = after.filter((annotation) => String(annotation.content).includes("legacy"));
if (legacyAnnotations.length > 0) {
  throw new Error(`legacy annotations were still present: ${JSON.stringify(after)}`);
}
if (after.length !== 1 || after[0].type !== "Square") {
  throw new Error(`expected only the replacement native rect annotation: ${JSON.stringify(after)}`);
}

const validation = await validatePdf(outputPath);
if (!validation.ok || validation.annotationCount !== 1) {
  throw new Error(`annotation output failed validation: ${JSON.stringify(validation)}`);
}

async function createAnnotatedPdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 90), 'Annotated source text', fontsize=14)",
      "highlight = page.add_highlight_annot(fitz.Rect(72, 78, 230, 98))",
      "highlight.set_info(content='legacy highlight')",
      "highlight.update()",
      "square = page.add_rect_annot(fitz.Rect(72, 120, 180, 176))",
      "square.set_info(content='legacy square')",
      "square.set_colors(stroke=(1, 0, 0))",
      "square.update()",
      "doc.save(sys.argv[1])",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function readAnnotations(filePath) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "doc = fitz.open(sys.argv[1])",
      "items = []",
      "for annot in doc[0].annots() or []:",
      "    items.append({'type': annot.type[1], 'content': annot.info.get('content', ''), 'xref': annot.xref, 'rect': [annot.rect.x0, annot.rect.y0, annot.rect.x1, annot.rect.y1]})",
      "print(json.dumps(items, ensure_ascii=False))",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
  return JSON.parse(stdout);
}
