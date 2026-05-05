import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-digital-signature");
const inputPath = path.join(workDir, "signature-source.pdf");
const outputPath = path.join(workDir, "signature-signed.pdf");
const tamperedPath = path.join(workDir, "signature-tampered.pdf");
const certPath = path.join(workDir, "signer.crt");
const keyPath = path.join(workDir, "signer.key");

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createSourcePdf(inputPath);
await createCertificate(certPath, keyPath);

const { stdout: signStdout } = await runProcess("python3", [
  enginePath,
  "cert-sign",
  "--input",
  inputPath,
  "--output",
  outputPath,
  "--cert",
  certPath,
  "--key",
  keyPath,
  "--field-name",
  "ApprovalSignature",
  "--signer-name",
  "PDFEdit Test Signer",
  "--reason",
  "Regression approval",
  "--location",
  "Local QA",
  "--page-index",
  "0",
  "--rect",
  "72,130,250,82",
  "--lock-policy",
  "formFill",
]);
const signReport = JSON.parse(signStdout);
if (!signReport.ok || !signReport.signatureValidation?.ok || signReport.signatureLength < 512) {
  throw new Error(`certificate signing did not produce a valid CMS signature: ${JSON.stringify(signReport)}`);
}

const validation = await validatePdf(outputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`signed PDF failed structural validation: ${JSON.stringify(validation)}`);
}

const { stdout: validateStdout } = await runProcess("python3", [
  enginePath,
  "signature-validate",
  "--input",
  outputPath,
  "--stdout",
]);
const signatureValidation = JSON.parse(validateStdout);
if (
  !signatureValidation.ok ||
  signatureValidation.signatureCount !== 1 ||
  signatureValidation.signedWidgetCount !== 1 ||
  !signatureValidation.signatures[0]?.cmsVerified ||
  !signatureValidation.signatures[0]?.docMDP ||
  signatureValidation.signatures[0]?.lockPolicy !== "formFill"
) {
  throw new Error(`signature validation failed: ${JSON.stringify(signatureValidation)}`);
}

await writeTamperedPdf(outputPath, tamperedPath);
const { stdout: tamperedStdout } = await runProcess("python3", [
  enginePath,
  "signature-validate",
  "--input",
  tamperedPath,
  "--stdout",
]);
const tamperedValidation = JSON.parse(tamperedStdout);
if (tamperedValidation.ok || tamperedValidation.signatures[0]?.cmsVerified) {
  throw new Error(`tampered signed PDF should not validate: ${JSON.stringify(tamperedValidation)}`);
}

async function createSourcePdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 96), 'Certificate signature fixture', fontsize=18)",
      "page.insert_text((72, 340), 'This visible content is covered by the CMS ByteRange.', fontsize=12)",
      "doc.save(sys.argv[1], garbage=4, deflate=False, clean=False)",
      "doc.close()",
    ].join("\n"),
    filePath,
  ]);
}

async function createCertificate(certFile, keyFile) {
  await runProcess("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyFile,
    "-out",
    certFile,
    "-subj",
    "/CN=PDFEdit Test Signer",
    "-days",
    "3",
  ]);
}

async function writeTamperedPdf(sourcePath, targetPath) {
  const bytes = await fs.readFile(sourcePath);
  const needle = Buffer.from("Regression approval");
  const replacement = Buffer.from("Regression approvas");
  const offset = bytes.indexOf(needle);
  if (offset < 0 || replacement.length !== needle.length) {
    throw new Error("could not locate fixed-length tamper target in signed PDF");
  }
  const tampered = Buffer.from(bytes);
  replacement.copy(tampered, offset);
  await fs.writeFile(targetPath, tampered);
}
