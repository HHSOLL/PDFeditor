import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-forms-xfdf");
const inputPath = path.join(workDir, "forms.pdf");
const xfdfPath = path.join(workDir, "updated.xfdf");
const outputPath = path.join(workDir, "forms-imported.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createFormPdf(inputPath);

const { stdout: exported } = await runProcess("python3", [
  enginePath,
  "forms-export",
  "--input",
  inputPath,
  "--stdout",
]);
if (!exported.includes('name="employee"') || !exported.includes("Alice")) {
  throw new Error(`XFDF export did not include the expected form value: ${exported}`);
}

await fs.writeFile(
  xfdfPath,
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">',
    "<fields>",
    '<field name="employee"><value>Bob Updated</value></field>',
    '<field name="approved"><value>Yes</value></field>',
    "</fields>",
    "</xfdf>",
  ].join(""),
);

await runProcess("python3", [
  enginePath,
  "forms-import",
  "--input",
  inputPath,
  "--xfdf",
  xfdfPath,
  "--output",
  outputPath,
]);

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`XFDF imported PDF did not validate: ${JSON.stringify(validation)}`);
}

const fields = await inspectFields(outputPath);
if (fields.employee !== "Bob Updated" || fields.approved === "Off") {
  throw new Error(`XFDF import did not update widgets: ${JSON.stringify(fields)}`);
}

async function createFormPdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 80), 'XFDF fixture', fontsize=14)",
      "text = fitz.Widget()",
      "text.field_name = 'employee'",
      "text.field_type = fitz.PDF_WIDGET_TYPE_TEXT",
      "text.rect = fitz.Rect(72, 110, 260, 136)",
      "text.field_value = 'Alice'",
      "text.text_font = 'Helv'",
      "text.text_fontsize = 11",
      "page.add_widget(text)",
      "check = fitz.Widget()",
      "check.field_name = 'approved'",
      "check.field_type = fitz.PDF_WIDGET_TYPE_CHECKBOX",
      "check.rect = fitz.Rect(72, 150, 92, 170)",
      "check.field_value = 'Off'",
      "check.text_font = 'ZaDb'",
      "page.add_widget(check)",
      "doc.save(sys.argv[1], garbage=4, deflate=True, clean=True)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function inspectFields(filePath) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "doc = fitz.open(sys.argv[1])",
      "fields = {}",
      "for page in doc:",
      "    for widget in list(page.widgets() or []):",
      "        fields[widget.field_name] = str(widget.field_value)",
      "print(json.dumps(fields))",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
  return JSON.parse(stdout);
}
