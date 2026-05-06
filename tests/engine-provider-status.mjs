import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { enginePath, root, runProcess } from "./helpers/pdf-engine-test-utils.mjs";

const cliStatus = await providerStatusFromCli();
assertDefaultProviderStatus(cliStatus);
const configuredMissingSdkStatus = await providerStatusFromCli({
  PDF_ENGINE_COMMERCIAL_PROVIDER: "Example Commercial SDK",
  PDF_ENGINE_COMMERCIAL_SDK_MODULE: "definitely_missing_pdf_sdk_for_status_test",
  PDF_ENGINE_COMMERCIAL_LICENSE_KEY: "test-license-placeholder",
});
assertConfiguredMissingSdkStatus(configuredMissingSdkStatus);

const server = spawn(process.execPath, [path.join(root, "server", "pdf-engine-server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: "8801" },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForProviderStatus();
  const response = await fetch("http://127.0.0.1:8801/api/pdf/provider-status");
  if (!response.ok) {
    throw new Error(`provider status API returned ${response.status}: ${await response.text()}`);
  }
  const apiStatus = await response.json();
  assertDefaultProviderStatus(apiStatus);
} finally {
  server.kill();
}

async function providerStatusFromCli(env = {}) {
  const { stdout } = await runProcess("python3", [
    enginePath,
    "provider-status",
    "--stdout",
  ], { env });
  return JSON.parse(stdout);
}

function assertDefaultProviderStatus(status) {
  if (!status?.ok || status.activeProvider !== "pymupdf" || !Array.isArray(status.providers)) {
    throw new Error(`invalid provider status envelope: ${JSON.stringify(status)}`);
  }
  if (status.claimGate100?.ready !== false || !Array.isArray(status.claimGate100?.blockers)) {
    throw new Error(`provider status must keep the 100-point claim gate blocked: ${JSON.stringify(status)}`);
  }
  for (const blocker of ["commercialSdkObjectEditing", "standardsValidatorPdfA", "timestampedPadesLtv"]) {
    if (!status.claimGate100.blockers.some((entry) => entry.id === blocker)) {
      throw new Error(`provider status is missing 100-point blocker ${blocker}: ${JSON.stringify(status.claimGate100)}`);
    }
  }
  const pymupdf = status.providers.find((provider) => provider.id === "pymupdf");
  if (!pymupdf?.active || !pymupdf.available || !pymupdf.sdkLoaded || typeof pymupdf.version !== "string") {
    throw new Error(`PyMuPDF provider is not reported active: ${JSON.stringify(status)}`);
  }
  if (!Array.isArray(pymupdf.capabilityDetails) || !pymupdf.capabilityDetails.some((capability) => capability.id === "corePdfMutation")) {
    throw new Error(`PyMuPDF provider must include detailed capabilities: ${JSON.stringify(pymupdf)}`);
  }
  const commercial = status.providers.find((provider) => provider.id === "commercial");
  if (!commercial) {
    throw new Error(`commercial provider status is missing: ${JSON.stringify(status)}`);
  }
  if (commercial.active || commercial.available || commercial.sdkLoaded || commercial.capabilities.length !== 0) {
    throw new Error(`commercial provider must not claim active SDK features by default: ${JSON.stringify(commercial)}`);
  }
  if (!commercial.unavailableReason.includes("not configured")) {
    throw new Error(`commercial provider did not explain default unavailability: ${JSON.stringify(commercial)}`);
  }
}

function assertConfiguredMissingSdkStatus(status) {
  const commercial = status.providers.find((provider) => provider.id === "commercial");
  if (!commercial?.configured) {
    throw new Error(`commercial provider did not report env configuration: ${JSON.stringify(status)}`);
  }
  if (commercial.available || commercial.active || commercial.sdkLoaded || commercial.capabilities.length !== 0) {
    throw new Error(`commercial provider must stay unavailable without SDK: ${JSON.stringify(commercial)}`);
  }
  if (!commercial.unavailableReason.includes("not importable")) {
    throw new Error(`commercial provider did not report missing SDK import: ${JSON.stringify(commercial)}`);
  }
}

async function waitForProviderStatus() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch("http://127.0.0.1:8801/api/pdf/provider-status");
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  throw new Error("timed out waiting for provider status API");
}
