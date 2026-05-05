import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const evaluationPath = path.join(root, "docs", "pdfa-pdfx-engine-evaluation.md");
const releaseBoundaryPath = path.join(root, "docs", "release-claim-boundary.md");
const scorePath = path.join(root, "docs", "acrobat-replacement-score.md");

const evaluation = await fs.readFile(evaluationPath, "utf8");
const releaseBoundary = await fs.readFile(releaseBoundaryPath, "utf8");
const score = await fs.readFile(scorePath, "utf8");

for (const phrase of [
  "Current status: **validator-backed report plus PDF/X-3 fixup**",
  "PDF/A-certified output",
  "PDF/X-certified output",
  "PDF/UA-compliant editor",
  "PDF/A fixups",
  "PDF/X-3 fixup",
  "Ghostscript",
  "verapdf",
  "standardsValidation",
  "pdfxValidation",
]) {
  if (!evaluation.includes(phrase)) {
    throw new Error(`validator evaluation must include boundary phrase: ${phrase}`);
  }
}

for (const forbidden of ["Full PDF/A or PDF/X certification", "Full PDF/UA editor or validator"]) {
  if (!releaseBoundary.includes(forbidden)) {
    throw new Error(`release boundary must forbid ${forbidden}`);
  }
}

if (!score.includes("Ghostscript-backed PDF/X-3 fixup")) {
  throw new Error("replacement score must include PDF/X-3 fixup evidence");
}

console.log(
  JSON.stringify({
    ok: true,
    validatorBoundary: "veraPDF report path and Ghostscript PDF/X-3 fixup integrated; broad certification/fixup claims remain blocked",
    evaluationPath,
  }),
);
