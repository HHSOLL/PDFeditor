import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const replacementScore = await readDoc("docs/acrobat-replacement-score.md");
const releaseBoundary = await readDoc("docs/release-claim-boundary.md");
const manualReport = await readDoc("docs/manual-compatibility-report.md");
const gapPlan = await readDoc("docs/gap-closure-plan.md");
const corpusManifest = JSON.parse(await fs.readFile(path.join(root, "tests", "corpus", "manifest.json"), "utf8"));

const externalScore = extractScore(replacementScore, /External replacement readiness:\s+\*\*(\d+)\s*\/\s*100/);
const localScore = extractScore(replacementScore, /Local automated baseline:\s+\*\*(\d+)\s*\/\s*100/);
const manualPending = /\|\s*Adobe Acrobat Pro \/ Reader\s*\|\s*Pending/.test(manualReport)
  || /\|\s*macOS Preview\s*\|\s*Pending/.test(manualReport)
  || /\|\s*Google Chrome PDF viewer\s*\|\s*Pending/.test(manualReport)
  || /\|\s*Microsoft Edge PDF viewer\s*\|\s*Pending/.test(manualReport);

if (manualPending && externalScore >= 90) {
  throw new Error(`external score ${externalScore} is not allowed while manual compatibility rows are pending`);
}

if (localScore < externalScore) {
  throw new Error(`external score ${externalScore} cannot exceed local automated baseline ${localScore}`);
}

const forbiddenClaims = [
  "Full Acrobat Pro replacement",
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

if (!releaseBoundary.includes("Compatibility with Acrobat/Preview/Chrome/Edge unless")) {
  throw new Error("release boundary must block external viewer compatibility claims without manual records");
}

if (!gapPlan.includes("Full Acrobat Pro replacement") || !gapPlan.includes("External replacement readiness above 90")) {
  throw new Error("gap closure plan must keep full replacement and external 90+ claims blocked");
}

const plannedExternalEntries = corpusManifest.categories.reduce((total, category) => total + category.requiredCount, 0);
if (plannedExternalEntries < 100) {
  throw new Error(`external corpus manifest plans only ${plannedExternalEntries} entries`);
}

if (corpusManifest.claimPolicy?.manualSmokeRequiredForFullCredit !== true) {
  throw new Error("corpus manifest must require manual smoke for full credit");
}

if (!replacementScore.includes("External 90+ claim: **not claimable yet**")) {
  throw new Error("replacement score must keep external 90+ claim blocked while manual smoke is pending");
}

console.log(
  JSON.stringify({
    ok: true,
    localScore,
    externalScore,
    manualPending,
    plannedExternalEntries,
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
