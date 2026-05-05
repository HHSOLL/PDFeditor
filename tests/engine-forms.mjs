import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { applyEngine, enginePath, runProcess, validatePdf } from "./helpers/pdf-engine-test-utils.mjs";

const root = process.cwd();
const workDir = path.join(root, "tmp", "engine-forms");
const inputPath = path.join(workDir, "input.pdf");
const filledPath = path.join(workDir, "filled.pdf");
const flattenedPath = path.join(workDir, "flattened.pdf");
const createdPath = path.join(workDir, "created.pdf");
const xfaSignaturePath = path.join(workDir, "xfa-signature.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createFormPdf(inputPath);

const before = await readWidgets(inputPath);
if (before.length !== 6) {
  throw new Error(`expected six widgets in form fixture: ${JSON.stringify(before)}`);
}
const departmentField = requireWidget(before, "department");
const regionField = requireWidget(before, "region");
const yearlyRadio = before.find((widget) => widget.name === "payCycle" && widget.on === "1");
if (!yearlyRadio) {
  throw new Error(`expected yearly radio widget: ${JSON.stringify(before)}`);
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
      defaultValue: "Default Name",
      required: true,
      tabIndex: 2,
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
      tabIndex: 1,
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
    {
      ...widgetOperationBase(departmentField),
      fieldName: "department",
      fieldType: "combo",
      fieldValue: "Engineering",
      defaultValue: "Design",
      required: true,
      options: ["Engineering", "Design", "Legal"],
    },
    {
      ...widgetOperationBase(regionField),
      fieldName: "region",
      fieldType: "list",
      fieldValue: "Busan",
      defaultValue: "Seoul",
      options: ["Seoul", "Busan", "Jeju"],
    },
    {
      ...widgetOperationBase(yearlyRadio),
      fieldName: "payCycle",
      fieldType: "radio",
      fieldValue: "1",
      checked: true,
      exportValue: "1",
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
const department = filledWidgets.find((widget) => widget.name === "department");
const region = filledWidgets.find((widget) => widget.name === "region");
const monthly = filledWidgets.find((widget) => widget.name === "payCycle" && widget.on === "0");
const yearly = filledWidgets.find((widget) => widget.name === "payCycle" && widget.on === "1");
if (
  name?.value !== "Bob Builder" ||
  agree?.value !== "Off" ||
  department?.value !== "Engineering" ||
  region?.value !== "Busan" ||
  monthly?.value !== "Off" ||
  yearly?.value !== "1" ||
  !name.required ||
  name.defaultValue !== "Default Name" ||
  !name.hasAppearance ||
  !department.required ||
  department.defaultValue !== "Design" ||
  !department.hasAppearance ||
  !region.hasAppearance
) {
  throw new Error(`filled widget values were not preserved: ${JSON.stringify(filledWidgets)}`);
}
const filledValidation = await validatePdf(filledPath);
if (!filledValidation.ok) {
  throw new Error(`filled form failed validation: ${JSON.stringify(filledValidation)}`);
}
const tabOrder = await readTabOrder(filledPath);
if (tabOrder.tabs !== "/A" || tabOrder.names[0] !== "agree" || tabOrder.names[1] !== "name") {
  throw new Error(`form tab order was not persisted: ${JSON.stringify(tabOrder)}`);
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

await applyEngine(inputPath, createdPath, {
  pages: [{ sourceIndex: 0, rotation: 0 }],
  operations: [
    {
      type: "formField",
      create: true,
      pageIndex: 0,
      x: 340 / 612,
      y: 78 / 792,
      width: 180 / 612,
      height: 24 / 792,
      fieldName: "createdText",
      fieldType: "text",
      fieldValue: "Created value",
      defaultValue: "Created default",
      required: true,
      tabIndex: 3,
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
    {
      type: "formField",
      create: true,
      pageIndex: 0,
      x: 340 / 612,
      y: 126 / 792,
      width: 18 / 612,
      height: 18 / 792,
      fieldName: "createdCheck",
      fieldType: "checkbox",
      fieldValue: "Yes",
      checked: true,
      exportValue: "Yes",
      tabIndex: 4,
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
    {
      type: "formField",
      create: true,
      pageIndex: 0,
      x: 340 / 612,
      y: 172 / 792,
      width: 140 / 612,
      height: 24 / 792,
      fieldName: "createdCombo",
      fieldType: "combo",
      fieldValue: "B",
      options: ["A", "B", "C"],
      tabIndex: 5,
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
    {
      type: "formField",
      create: true,
      pageIndex: 0,
      x: 340 / 612,
      y: 218 / 792,
      width: 140 / 612,
      height: 48 / 792,
      fieldName: "createdList",
      fieldType: "list",
      fieldValue: "North",
      options: ["North", "South"],
      tabIndex: 6,
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
    {
      type: "formField",
      create: true,
      pageIndex: 0,
      x: 340 / 612,
      y: 296 / 792,
      width: 18 / 612,
      height: 18 / 792,
      fieldName: "createdRadio",
      fieldType: "radio",
      fieldValue: "Yes",
      checked: true,
      exportValue: "Yes",
      tabIndex: 7,
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
  ],
  metadata: fillPayload.metadata,
  saveOptions: fillPayload.saveOptions,
}, "form-create");
const createdWidgets = await readWidgets(createdPath);
const createdText = requireWidget(createdWidgets, "createdText");
const createdCheck = requireWidget(createdWidgets, "createdCheck");
const createdCombo = requireWidget(createdWidgets, "createdCombo");
const createdList = requireWidget(createdWidgets, "createdList");
const createdRadio = requireWidget(createdWidgets, "createdRadio");
if (
  createdText.value !== "Created value" ||
  !createdText.required ||
  createdText.defaultValue !== "Created default" ||
  !createdText.hasAppearance ||
  createdCheck.value !== "Yes" ||
  createdCombo.value !== "B" ||
  JSON.stringify(createdCombo.choices) !== JSON.stringify(["A", "B", "C"]) ||
  createdList.value !== "North" ||
  JSON.stringify(createdList.choices) !== JSON.stringify(["North", "South"]) ||
  createdRadio.value !== "Yes"
) {
  throw new Error(`created form fields were not persisted: ${JSON.stringify(createdWidgets)}`);
}
const createdValidation = await validatePdf(createdPath);
if (!createdValidation.ok) {
  throw new Error(`created form failed validation: ${JSON.stringify(createdValidation)}`);
}

await createXfaSignatureFixture(xfaSignaturePath);
const xfaSignaturePreflight = await preflight(xfaSignaturePath);
if (!xfaSignaturePreflight.xfaPresent || xfaSignaturePreflight.signatureFieldCount !== 1) {
  throw new Error(`XFA/signature fixture was not reported: ${JSON.stringify(xfaSignaturePreflight)}`);
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
  page.drawText("Department:", { x: 72, y: 606, size: 12, font });
  const department = form.createDropdown("department");
  department.addOptions(["Engineering", "Design", "Legal"]);
  department.select("Design");
  department.addToPage(page, { x: 160, y: 596, width: 140, height: 24 });
  page.drawText("Region:", { x: 72, y: 552, size: 12, font });
  const region = form.createOptionList("region");
  region.addOptions(["Seoul", "Busan", "Jeju"]);
  region.select("Seoul");
  region.addToPage(page, { x: 160, y: 528, width: 140, height: 48 });
  page.drawText("Pay cycle:", { x: 72, y: 494, size: 12, font });
  const payCycle = form.createRadioGroup("payCycle");
  payCycle.addOptionToPage("Monthly", page, { x: 160, y: 488, width: 16, height: 16 });
  payCycle.addOptionToPage("Yearly", page, { x: 210, y: 488, width: 16, height: 16 });
  payCycle.select("Monthly");
  await fs.writeFile(filePath, await document.save());
}

async function readWidgets(filePath) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "doc = fitz.open(sys.argv[1])",
      "def pdf_string(entry):",
      "    kind, value = entry",
      "    if kind == 'string':",
      "        return value",
      "    return value[1:-1] if isinstance(value, str) and value.startswith('(') and value.endswith(')') else ''",
      "items = []",
      "for page in doc:",
      "    for widget in page.widgets() or []:",
      "        ap = doc.xref_get_key(widget.xref, 'AP')[1] if widget.xref else 'null'",
      "        dv = doc.xref_get_key(widget.xref, 'DV')[1] if widget.xref else 'null'",
      "        flags = int(getattr(widget, 'field_flags', 0) or 0)",
      "        flags = int(doc.xref_get_key(widget.xref, 'Ff')[1] if doc.xref_get_key(widget.xref, 'Ff')[1] != 'null' else flags)",
      "        items.append({'name': widget.field_name, 'type': widget.field_type_string, 'value': widget.field_value, 'on': widget.on_state() if hasattr(widget, 'on_state') else None, 'choices': widget.choice_values, 'rect': [widget.rect.x0, widget.rect.y0, widget.rect.x1, widget.rect.y1], 'required': bool(flags & 2), 'defaultValue': pdf_string(doc.xref_get_key(widget.xref, 'DV')), 'hasAppearance': ap != 'null'})",
      "print(json.dumps(items, ensure_ascii=False))",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
  return JSON.parse(stdout);
}

async function readTabOrder(filePath) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, re, sys",
      "doc = fitz.open(sys.argv[1])",
      "page = doc[0]",
      "tabs = doc.xref_get_key(page.xref, 'Tabs')[1]",
      "annots = doc.xref_get_key(page.xref, 'Annots')[1]",
      "names = []",
      "for xref in [int(match.group(1)) for match in re.finditer(r'(\\d+)\\s+0\\s+R', annots)]:",
      "    kind, value = doc.xref_get_key(xref, 'T')",
      "    if kind != 'string':",
      "        parent_kind, parent = doc.xref_get_key(xref, 'Parent')",
      "        if parent_kind == 'xref':",
      "            kind, value = doc.xref_get_key(int(parent.split()[0]), 'T')",
      "    names.append(value if kind == 'string' else '')",
      "print(json.dumps({'tabs': tabs, 'names': names}, ensure_ascii=False))",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
  return JSON.parse(stdout);
}

async function createXfaSignatureFixture(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 96), 'XFA and signature fixture', fontsize=12)",
      "widget = doc.get_new_xref()",
      "page_xref = page.xref",
      "doc.update_object(widget, f'<< /Type /Annot /Subtype /Widget /FT /Sig /T (approvalSig) /Rect [72 650 220 690] /F 4 /P {page_xref} 0 R >>')",
      "doc.xref_set_key(page_xref, 'Annots', f'[{widget} 0 R]')",
      "doc.xref_set_key(doc.pdf_catalog(), 'AcroForm', f'<< /Fields [{widget} 0 R] /XFA (SECRET_XFA_PACKET) >>')",
      "doc.save(sys.argv[1])",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function preflight(filePath) {
  const { stdout } = await runProcess("python3", [
    enginePath,
    "preflight",
    "--input",
    filePath,
    "--stdout",
  ]);
  return JSON.parse(stdout);
}

function requireWidget(widgets, name) {
  const widget = widgets.find((candidate) => candidate.name === name);
  if (!widget) {
    throw new Error(`missing widget ${name}: ${JSON.stringify(widgets)}`);
  }
  return widget;
}

function widgetOperationBase(widget) {
  const [x0, y0, x1, y1] = widget.rect;
  return {
    type: "formField",
    pageIndex: 0,
    x: x0 / 612,
    y: y0 / 792,
    width: (x1 - x0) / 612,
    height: (y1 - y0) / 792,
    color: "#172026",
    opacity: 1,
    strokeWidth: 1,
  };
}
