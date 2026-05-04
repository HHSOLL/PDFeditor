import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { applyEngine, runProcess, validatePdf } from "./helpers/pdf-engine-test-utils.mjs";

const root = process.cwd();
const workDir = path.join(root, "tmp", "engine-forms");
const inputPath = path.join(workDir, "input.pdf");
const filledPath = path.join(workDir, "filled.pdf");
const flattenedPath = path.join(workDir, "flattened.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createFormPdf(inputPath);

const before = await readWidgets(inputPath);
if (before.length !== 2) {
  throw new Error(`expected two widgets in form fixture: ${JSON.stringify(before)}`);
}

const fillPayload = {
  pages: [{ sourceIndex: 0, rotation: 0 }],
  operations: [
    {
      type: "formField",
      pageIndex: 0,
      x: 120 / 612,
      y: 78 / 792,
      width: 200 / 612,
      height: 26 / 792,
      fieldName: "name",
      fieldType: "text",
      fieldValue: "Bob Builder",
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
    {
      type: "formField",
      pageIndex: 0,
      x: 120 / 612,
      y: 126 / 792,
      width: 18 / 612,
      height: 18 / 792,
      fieldName: "agree",
      fieldType: "checkbox",
      fieldValue: "Off",
      checked: false,
      exportValue: "Yes",
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
  ],
  metadata: {
    title: "Form fill roundtrip",
    author: "PDF Studio",
    subject: "AcroForm fill/save",
    keywords: "pdf,form",
    creator: "PDF Studio",
    producer: "PDF Studio Engine",
  },
  saveOptions: {
    annotationMode: "flatten",
    redactionMode: "textOnly",
    flattenForms: false,
    validate: true,
  },
};

await applyEngine(inputPath, filledPath, fillPayload, "form-fill");
const filledWidgets = await readWidgets(filledPath);
const name = filledWidgets.find((widget) => widget.name === "name");
const agree = filledWidgets.find((widget) => widget.name === "agree");
if (name?.value !== "Bob Builder" || agree?.value !== "Off") {
  throw new Error(`filled widget values were not preserved: ${JSON.stringify(filledWidgets)}`);
}
const filledValidation = await validatePdf(filledPath);
if (!filledValidation.ok) {
  throw new Error(`filled form failed validation: ${JSON.stringify(filledValidation)}`);
}

await applyEngine(inputPath, flattenedPath, {
  ...fillPayload,
  saveOptions: {
    ...fillPayload.saveOptions,
    flattenForms: true,
  },
}, "form-flatten");
const flattenedWidgets = await readWidgets(flattenedPath);
if (flattenedWidgets.length !== 0) {
  throw new Error(`flattened form still has widgets: ${JSON.stringify(flattenedWidgets)}`);
}
const flattenedValidation = await validatePdf(flattenedPath);
if (!flattenedValidation.ok) {
  throw new Error(`flattened form failed validation: ${JSON.stringify(flattenedValidation)}`);
}

async function createFormPdf(filePath) {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Name:", { x: 72, y: 700, size: 12, font });
  page.drawText("Agree:", { x: 72, y: 654, size: 12, font });
  const form = document.getForm();
  const name = form.createTextField("name");
  name.setText("Alice");
  name.addToPage(page, { x: 120, y: 690, width: 200, height: 24 });
  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 120, y: 650, width: 16, height: 16 });
  agree.check();
  await fs.writeFile(filePath, await document.save());
}

async function readWidgets(filePath) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "doc = fitz.open(sys.argv[1])",
      "items = []",
      "for page in doc:",
      "    for widget in page.widgets() or []:",
      "        items.append({'name': widget.field_name, 'type': widget.field_type_string, 'value': widget.field_value, 'rect': [widget.rect.x0, widget.rect.y0, widget.rect.x1, widget.rect.y1]})",
      "print(json.dumps(items, ensure_ascii=False))",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
  return JSON.parse(stdout);
}
