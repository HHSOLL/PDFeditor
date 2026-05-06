import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function validateDesktopReadiness(releaseRoot) {
  const requiredPaths = [
    "desktop-readiness.json",
    "desktop/tauri.conf.ready.json",
    "check-runtime.mjs",
    "OFFLINE-POLICY.txt",
  ];

  for (const requiredPath of requiredPaths) {
    const fullPath = path.join(releaseRoot, requiredPath);
    if (!existsSync(fullPath)) {
      throw new Error(`desktop readiness package is missing ${fullPath}`);
    }
  }

  const manifest = await readJson(path.join(releaseRoot, "release-manifest.json"));
  const readiness = await readJson(path.join(releaseRoot, "desktop-readiness.json"));
  const tauriConfig = await readJson(path.join(releaseRoot, "desktop", "tauri.conf.ready.json"));
  const offlinePolicy = await readFile(path.join(releaseRoot, "OFFLINE-POLICY.txt"), "utf8");

  if (manifest.desktopReadiness?.targetShell !== "Tauri" || manifest.desktopReadiness?.tauriFirst !== true) {
    throw new Error(`release manifest must advertise Tauri-first desktop readiness: ${JSON.stringify(manifest)}`);
  }
  if (manifest.desktopReadiness?.rustTauriRequiredForSmoke !== false) {
    throw new Error(`desktop smoke must not require Rust/Tauri: ${JSON.stringify(manifest.desktopReadiness)}`);
  }
  if (manifest.claimBoundary?.nativeDesktop !== false || manifest.claimBoundary?.productionSaaS !== false) {
    throw new Error(`desktop scaffold must keep native/SaaS claims blocked: ${JSON.stringify(manifest.claimBoundary)}`);
  }

  if (readiness.targetShell !== "Tauri" || readiness.status !== "readiness-scaffold") {
    throw new Error(`unexpected desktop readiness status: ${JSON.stringify(readiness)}`);
  }
  if (readiness.nativeDesktopBundleBuilt !== false || readiness.rustTauriRequiredForSmoke !== false) {
    throw new Error(`desktop readiness must not claim a native bundle or Rust/Tauri smoke requirement: ${JSON.stringify(readiness)}`);
  }
  if (readiness.engineLifecycle?.healthEndpoint !== "/api/health" || readiness.engineLifecycle?.bindHost !== "127.0.0.1") {
    throw new Error(`desktop readiness is missing engine lifecycle health/bind config: ${JSON.stringify(readiness.engineLifecycle)}`);
  }
  if (readiness.runtimeDependencyChecks?.script !== "check-runtime.mjs") {
    throw new Error(`desktop readiness is missing runtime dependency check config: ${JSON.stringify(readiness.runtimeDependencyChecks)}`);
  }
  for (const deferred of ["rustc", "cargo", "tauri-cli"]) {
    if (!readiness.runtimeDependencyChecks?.deferredForNativeBuild?.includes(deferred)) {
      throw new Error(`desktop readiness must defer ${deferred}: ${JSON.stringify(readiness.runtimeDependencyChecks)}`);
    }
  }
  if (readiness.support?.mainLog !== "logs/pdfeditor-local.log" || readiness.support?.supportBundleScript !== "support-bundle.sh") {
    throw new Error(`desktop readiness is missing support/log paths: ${JSON.stringify(readiness.support)}`);
  }
  if (!readiness.support?.supportBundleIncludes?.includes("OFFLINE-POLICY.txt")) {
    throw new Error(`desktop readiness support bundle must include offline policy: ${JSON.stringify(readiness.support)}`);
  }
  if (
    readiness.offlinePolicy?.defaultOffline !== true ||
    readiness.offlinePolicy?.remotePdfProcessing !== false ||
    readiness.offlinePolicy?.telemetry !== false ||
    readiness.offlinePolicy?.allowedOutboundHosts?.length !== 0
  ) {
    throw new Error(`desktop readiness offline policy is too broad: ${JSON.stringify(readiness.offlinePolicy)}`);
  }
  if (!readiness.claimBoundary?.blocked?.includes("Packaged native Tauri desktop app")) {
    throw new Error(`desktop readiness must block native desktop claims: ${JSON.stringify(readiness.claimBoundary)}`);
  }

  if (tauriConfig.$schema !== "https://schema.tauri.app/config/2" || tauriConfig.productName !== "PDFeditor") {
    throw new Error(`unexpected Tauri config template: ${JSON.stringify(tauriConfig)}`);
  }
  if (tauriConfig.bundle?.active !== false) {
    throw new Error(`Tauri template must keep bundling inactive until native packaging lands: ${JSON.stringify(tauriConfig.bundle)}`);
  }
  if (tauriConfig.build?.frontendDist !== "../dist") {
    throw new Error(`Tauri template must point at built UI assets: ${JSON.stringify(tauriConfig.build)}`);
  }

  if (!offlinePolicy.includes("127.0.0.1") || !offlinePolicy.includes("remote PDF processing")) {
    throw new Error(`offline policy must document local-only PDF processing: ${offlinePolicy}`);
  }

  const runtimeCheck = spawnSync(process.execPath, ["check-runtime.mjs"], {
    cwd: releaseRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (runtimeCheck.status !== 0) {
    throw new Error(`runtime dependency check failed:\nstdout:\n${runtimeCheck.stdout}\nstderr:\n${runtimeCheck.stderr}`);
  }
  const runtimeReport = JSON.parse(runtimeCheck.stdout);
  if (runtimeReport.nativeBuildPrerequisitesChecked !== false) {
    throw new Error(`runtime check must not inspect native build prerequisites: ${runtimeCheck.stdout}`);
  }
  for (const required of ["node", "python3"]) {
    const check = runtimeReport.checks?.find((entry) => entry.name === required);
    if (!check?.ok || check.required !== true) {
      throw new Error(`runtime check must pass required ${required}: ${runtimeCheck.stdout}`);
    }
  }
  for (const deferred of ["rustc", "cargo", "tauri-cli"]) {
    if (!runtimeReport.nativeBuildPrerequisitesDeferred?.includes(deferred)) {
      throw new Error(`runtime report must defer ${deferred}: ${runtimeCheck.stdout}`);
    }
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
