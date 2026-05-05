import fs from "node:fs/promises";
import path from "node:path";
import {
  applyEngine,
  enginePath,
  root,
  runProcess,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-password-permissions");
const inputPath = path.join(workDir, "plain.pdf");
const outputPath = path.join(workDir, "encrypted.pdf");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createPlainPdf(inputPath);
await applyEngine(inputPath, outputPath, {
  saveOptions: {
    annotationMode: "flatten",
    redactionMode: "textOnly",
    validate: true,
    encrypt: true,
    userPassword: "user-pass",
    ownerPassword: "owner-pass",
    permissions: {
      print: true,
      copy: false,
      annotate: false,
      edit: false,
    },
  },
  operations: [
    {
      type: "text",
      pageIndex: 0,
      x: 72 / 612,
      y: 130 / 792,
      width: 260 / 612,
      height: 32 / 792,
      text: "Encrypted edit remains searchable after auth",
      fontSize: 14,
      color: "#172026",
      opacity: 1,
      strokeWidth: 1,
    },
  ],
}, "password-permissions");

const unauthenticated = await inspectAuth(outputPath, "");
if (!unauthenticated.needsPass || unauthenticated.text) {
  throw new Error(`encrypted PDF should require a password before extraction: ${JSON.stringify(unauthenticated)}`);
}

const authenticated = await inspectAuth(outputPath, "user-pass");
if (!authenticated.text.includes("Encrypted edit remains searchable after auth")) {
  throw new Error(`encrypted PDF did not preserve edited text after auth: ${JSON.stringify(authenticated)}`);
}

const { stdout: validationStdout } = await runProcess("python3", [
  enginePath,
  "validate",
  "--input",
  outputPath,
  "--password",
  "user-pass",
  "--stdout",
]);
const validation = JSON.parse(validationStdout);
if (!validation.ok || !validation.encrypted || !validation.qpdfChecked || validation.pageCount !== 1) {
  throw new Error(`encrypted validation failed: ${JSON.stringify(validation)}`);
}

const encryption = await runProcess("qpdf", [
  "--password=user-pass",
  "--show-encryption",
  outputPath,
]);
if (!/print/.test(encryption.stdout) || /extract for accessibility: allowed/.test(encryption.stdout)) {
  throw new Error(`qpdf encryption permissions output was unexpected:\n${encryption.stdout}`);
}

async function createPlainPdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Password permission fixture', fontsize=18)",
      "doc.save(sys.argv[1], deflate=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function inspectAuth(filePath, password) {
  const { stdout } = await runProcess("python3", [
    "-c",
    [
      "import fitz, json, sys",
      "doc = fitz.open(sys.argv[1])",
      "needs = bool(doc.needs_pass)",
      "auth = doc.authenticate(sys.argv[2]) if sys.argv[2] else 0",
      "text = ''",
      "if not needs or auth:",
      "    text = doc[0].get_text('text')",
      "print(json.dumps({'needsPass': needs, 'auth': auth, 'text': text}))",
      "doc.close()",
    ].join("\n"),
    filePath,
    password,
  ]);
  return JSON.parse(stdout);
}
