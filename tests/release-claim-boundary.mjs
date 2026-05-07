import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const replacementScore = await readDoc("docs/acrobat-replacement-score.md");
const releaseBoundary = await readDoc("docs/release-claim-boundary.md");
const manualReport = await readDoc("docs/manual-compatibility-report.md");
const gapPlan = await readDoc("docs/gap-closure-plan.md");
const final100Gap = await readDoc("docs/final-100-gap-closure-plan.md");
const corpusCoverage = await readDoc("docs/corpus-coverage.md");
const corpusManifest = JSON.parse(await fs.readFile(path.join(root, "tests", "corpus", "manifest.json"), "utf8"));

const externalScore = extractScore(replacementScore, /External replacement readiness:\s+\*\*(\d+)\s*\/\s*100/);
const localScore = extractScore(replacementScore, /Local automated baseline:\s+\*\*(\d+)\s*\/\s*100/);
const manualPending = /\|\s*Adobe Acrobat Pro \/ Reader\s*\|\s*Pending/.test(manualReport)
  || /\|\s*macOS Preview\s*\|\s*Pending/.test(manualReport)
  || /\|\s*Google Chrome PDF viewer\s*\|\s*Pending/.test(manualReport)
  || /\|\s*Microsoft Edge PDF viewer\s*\|\s*Pending/.test(manualReport);
const representativeManualViewerSmoke = manualReport.includes("200 out of 200")
  && manualReport.includes("tmp/manual-viewer-smoke/2026-05-05T20-00-36-400Z/")
  && manualReport.includes("Representative open/render pass");
const representativeManualEvidence = await readManualSmokeEvidence(
  "tmp/manual-viewer-smoke/2026-05-05T20-00-36-400Z/results.json",
  {
    expectedPassCount: 200,
    expectedFailCount: 0,
    expectedViewerCount: 4,
    expectedFileCount: 50,
    requiredViewers: ["acrobat", "preview", "chrome", "edge"],
  },
);
const sequentialAcrobatEvidence = await readManualSmokeEvidence(
  "tmp/manual-viewer-smoke/2026-05-05T19-35-35-632Z/results.json",
  {
    expectedPassCount: 50,
    expectedFailCount: 0,
    expectedViewerCount: 1,
    expectedFileCount: 50,
    requiredViewers: ["acrobat"],
  },
);

if (manualPending && externalScore >= 90) {
  throw new Error(`external score ${externalScore} is not allowed while manual compatibility rows are pending`);
}

if (externalScore >= 90 && !representativeManualViewerSmoke) {
  throw new Error(`external score ${externalScore} requires representative manual viewer smoke evidence`);
}

if (externalScore >= 90 && (!representativeManualEvidence.ok || !sequentialAcrobatEvidence.ok)) {
  throw new Error("external 90-point claim requires live manual smoke JSON artifacts, screenshots, and sequential Acrobat evidence");
}

if (externalScore > 90) {
  throw new Error(`external score ${externalScore} is not allowed before deep feature-panel manual smoke closes`);
}

const required100Gates = [
  ["real-world-corpus", "real-world corpus"],
  ["deep-manual-smoke", "deep manual smoke"],
  ["desktop-production-package", "desktop"],
  ["validator-preflight", "validator"],
  ["ltv-signatures", "LTV"],
  ["complete-sanitizer", "sanitizer"],
  ["pdfua-accessibility", "PDF/UA"],
];

const gateStatus = new Map();
for (const line of final100Gap.split(/\r?\n/)) {
  const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*Yes\s*\|\s*([^|]+?)\s*\|/);
  if (match) {
    gateStatus.set(match[1], match[2].trim());
  }
}

const incomplete100Gates = [];
for (const [gateId, evidencePhrase] of required100Gates) {
  if (!final100Gap.includes(evidencePhrase)) {
    throw new Error(`final 100 gap document must describe ${evidencePhrase} evidence`);
  }
  const status = gateStatus.get(gateId);
  if (!status) {
    throw new Error(`final 100 gap document is missing required gate ${gateId}`);
  }
  if (status !== "Complete") {
    incomplete100Gates.push(gateId);
  }
}

const fullReplacementBlocked = final100Gap.includes("Current 100/full replacement status: **blocked**")
  && replacementScore.includes("External 100-point/full replacement claim: **blocked")
  && releaseBoundary.includes("Final 100/full replacement wording remains blocked")
  && manualReport.includes("mandatory before any 100/100 or full")
  && corpusCoverage.includes("cannot support a 100/100 or full Acrobat Pro replacement claim");

if (incomplete100Gates.length > 0 && !fullReplacementBlocked) {
  throw new Error(`100/full replacement claims must stay blocked while these gates are incomplete: ${incomplete100Gates.join(", ")}`);
}

if (incomplete100Gates.length > 0 && /100\s*\/\s*100\s+external replacement readiness:\s+\*\*claimable/i.test(final100Gap)) {
  throw new Error("final 100 gap document cannot mark a 100/100 external claim claimable while required gates are incomplete");
}

const allowedClaims = sectionBetween(releaseBoundary, "## Allowed Claims", "## Forbidden Claims");
for (const disallowedAllowedClaim of ["Full Acrobat Pro replacement", "100/100 external replacement readiness"]) {
  if (allowedClaims.includes(disallowedAllowedClaim)) {
    throw new Error(`allowed claims must not include ${disallowedAllowedClaim} while final 100 gates are incomplete`);
  }
}

const forbiddenClaims = [
  "Full Acrobat Pro replacement",
  "100/100 external replacement readiness",
  "100% Acrobat-compatible",
  "External Acrobat Pro replacement score above 90",
  "Full PDF/A or PDF/X certification",
  "Full PDF/UA editor or validator",
  "Production-ready SaaS or native packaged desktop release",
];

for (const claim of forbiddenClaims) {
  if (!releaseBoundary.includes(claim)) {
    throw new Error(`release boundary must forbid claim: ${claim}`);
  }
}

if (!releaseBoundary.includes("Deep feature-panel compatibility with Acrobat/Preview/Chrome/Edge beyond the")) {
  throw new Error("release boundary must block deep external viewer compatibility claims without feature-specific manual records");
}

if (!gapPlan.includes("Full Acrobat Pro replacement") || !gapPlan.includes("External replacement readiness above 90") || !gapPlan.includes("Final claim gate")) {
  throw new Error("gap closure plan must keep full replacement, final claim, and external 90+ claims blocked");
}

const plannedExternalEntries = corpusManifest.categories.reduce((total, category) => total + category.requiredCount, 0);
if (plannedExternalEntries < 100) {
  throw new Error(`external corpus manifest plans only ${plannedExternalEntries} entries`);
}

if (corpusManifest.claimPolicy?.manualSmokeRequiredForFullCredit !== true) {
  throw new Error("corpus manifest must require manual smoke for full credit");
}

if (!replacementScore.includes("External 90-point claim: **claimable") || !replacementScore.includes("External score above 90: **not claimable yet**")) {
  throw new Error("replacement score must allow the 90-point smoke-backed claim while keeping scores above 90 blocked");
}

console.log(
  JSON.stringify({
    ok: true,
    localScore,
    externalScore,
    manualPending,
    representativeManualEvidence: {
      passCount: representativeManualEvidence.passCount,
      viewerCount: representativeManualEvidence.viewerCount,
      fileCount: representativeManualEvidence.fileCount,
    },
    sequentialAcrobatEvidence: {
      passCount: sequentialAcrobatEvidence.passCount,
      viewerCount: sequentialAcrobatEvidence.viewerCount,
      fileCount: sequentialAcrobatEvidence.fileCount,
    },
    plannedExternalEntries,
    incomplete100Gates,
    claimBoundary: "overclaim prevention active",
  }),
);

async function readDoc(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

function extractScore(text, pattern) {
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`could not extract score with pattern ${pattern}`);
  }
  return Number(match[1]);
}

function sectionBetween(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  if (start === -1) {
    throw new Error(`missing section ${startHeading}`);
  }
  const end = text.indexOf(endHeading, start + startHeading.length);
  if (end === -1) {
    throw new Error(`missing section ${endHeading}`);
  }
  return text.slice(start, end);
}

async function readManualSmokeEvidence(relativePath, expectations) {
  const evidencePath = path.join(root, relativePath);
  const summary = JSON.parse(await fs.readFile(evidencePath, "utf8"));
  if (summary.passCount !== expectations.expectedPassCount || summary.failCount !== expectations.expectedFailCount) {
    throw new Error(`manual smoke evidence ${relativePath} has unexpected pass/fail counts: ${summary.passCount}/${summary.failCount}`);
  }
  if (summary.viewerCount !== expectations.expectedViewerCount || summary.fileCount !== expectations.expectedFileCount) {
    throw new Error(`manual smoke evidence ${relativePath} has unexpected dimensions: viewers=${summary.viewerCount}, files=${summary.fileCount}`);
  }
  const viewerIds = new Set(summary.results.map((result) => result.viewerId));
  for (const viewerId of expectations.requiredViewers) {
    if (!viewerIds.has(viewerId)) {
      throw new Error(`manual smoke evidence ${relativePath} is missing viewer ${viewerId}`);
    }
  }
  const missingScreenshot = [];
  for (const result of summary.results) {
    if (!result.pass) {
      throw new Error(`manual smoke evidence ${relativePath} includes failed result ${result.id}/${result.viewerId}: ${result.notes}`);
    }
    if (!result.screenshotPath) {
      missingScreenshot.push(`${result.viewerId}:${result.id}:missing path`);
      continue;
    }
    const stat = await fs.stat(result.screenshotPath).catch(() => null);
    if (!stat || stat.size <= 50_000) {
      missingScreenshot.push(`${result.viewerId}:${result.id}:${result.screenshotPath}`);
    }
  }
  if (missingScreenshot.length) {
    throw new Error(`manual smoke evidence ${relativePath} has missing/empty screenshots: ${missingScreenshot.slice(0, 5).join(", ")}`);
  }
  return {
    ok: true,
    passCount: summary.passCount,
    viewerCount: summary.viewerCount,
    fileCount: summary.fileCount,
  };
}
