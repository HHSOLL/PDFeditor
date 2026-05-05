import fs from "node:fs/promises";
import path from "node:path";
import {
  enginePath,
  extractText,
  root,
  runProcess,
  validatePdf,
} from "./helpers/pdf-engine-test-utils.mjs";

const workDir = path.join(root, "tmp", "engine-standards-validator");
const inputPath = path.join(workDir, "standards-validator-input.pdf");
const reportPath = path.join(workDir, "standards-validator-report.pdf");

const verapdfAvailable = await hasVeraPdf();
if (!verapdfAvailable && process.env.REQUIRE_STANDARDS_VALIDATOR) {
  throw new Error("veraPDF is required for this standards validator test but was not found on PATH");
}
if (!verapdfAvailable) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "veraPDF not available on PATH" }));
  process.exit(0);
}

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });
await createBasicPdf(inputPath);

const validation = await validatePdf(inputPath);
if (!validation.ok || !validation.qpdfChecked) {
  throw new Error(`standards validator fixture failed qpdf/PyMuPDF validation: ${JSON.stringify(validation)}`);
}

const report = await preflight(inputPath);
assertVeraPdfReport(report);
if (!report.warnings.some((warning) => warning.includes("veraPDF standards validation failed"))) {
  throw new Error(`preflight did not surface veraPDF failure warning: ${JSON.stringify(report.warnings)}`);
}

const { stdout } = await runProcess("python3", [
  enginePath,
  "preflight",
  "--input",
  inputPath,
  "--report",
  reportPath,
  "--stdout",
]);
const reportWithPdf = JSON.parse(stdout);
assertVeraPdfReport(reportWithPdf);
const reportValidation = await validatePdf(reportPath);
if (!reportValidation.ok || !reportValidation.qpdfChecked || reportValidation.pageCount !== 1) {
  throw new Error(`standards validator report PDF failed validation: ${JSON.stringify(reportValidation)}`);
}
const reportText = await extractText(reportPath);
if (!reportText.includes("veraPDF") || !reportText.includes("failed checks")) {
  throw new Error(`standards validator report PDF did not include veraPDF evidence: ${reportText}`);
}

const requiredUnavailable = await preflightWithUnavailableValidator(inputPath);
if (!requiredUnavailable.standardsValidation?.errors?.some((error) => error.includes("veraPDF is required"))) {
  throw new Error(
    `REQUIRE_STANDARDS_VALIDATOR missing-validator path did not report a blocker: ${JSON.stringify(requiredUnavailable)}`,
  );
}

console.log(
  JSON.stringify({
    ok: true,
    validator: report.standardsValidation.validator,
    validatorVersion: report.standardsValidation.validatorVersion,
    profileName: report.standardsValidation.profileName,
    failedChecks: report.standardsValidation.failedChecks,
    reportPath,
  }),
);

async function hasVeraPdf() {
  try {
    const { stdout } = await runProcess("verapdf", ["--version"]);
    return /veraPDF/i.test(stdout);
  } catch {
    return false;
  }
}

async function createBasicPdf(filePath) {
  await runProcess("python3", [
    "-c",
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 96), 'veraPDF engine integration fixture', fontsize=18)",
      "page.insert_text((72, 126), 'This intentionally simple PDF is not PDF/A-compliant.', fontsize=10)",
      "doc.save(sys.argv[1], garbage=4, deflate=True)",
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

async function preflightWithUnavailableValidator(filePath) {
  const { stdout } = await runProcess(
    "python3",
    [
      enginePath,
      "preflight",
      "--input",
      filePath,
      "--stdout",
    ],
    {
      env: {
        PATH: "",
        REQUIRE_QPDF: "",
        REQUIRE_STANDARDS_VALIDATOR: "1",
      },
    },
  );
  return JSON.parse(stdout);
}

function assertVeraPdfReport(report) {
  const standards = report.standardsValidation;
  if (!standards?.available || standards.validator !== "verapdf" || !standards.validatorVersion) {
    throw new Error(`veraPDF validator was not reported as available: ${JSON.stringify(report)}`);
  }
  if (!standards.validated || standards.passed !== false || standards.compliant !== false) {
    throw new Error(`veraPDF validation should complete and reject the fixture: ${JSON.stringify(standards)}`);
  }
  if (!standards.profileName || standards.failedChecks < 1 || !Array.isArray(standards.failures)) {
    throw new Error(`veraPDF failure details were missing: ${JSON.stringify(standards)}`);
  }
  if (!standards.failures[0]?.description && !standards.failures[0]?.errorMessage) {
    throw new Error(`veraPDF first failure was not summarized: ${JSON.stringify(standards.failures[0])}`);
  }
}
