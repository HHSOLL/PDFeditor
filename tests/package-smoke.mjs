import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { validateDesktopReadiness } from "./desktop-readiness-check.mjs";

const root = process.cwd();
const releaseRoot = path.join(root, "release", "pdfeditor-local");
const port = Number(process.env.PACKAGE_SMOKE_PORT || 8801);
const enginePython = process.env.PDF_ENGINE_PYTHON ||
  (existsSync(path.join(root, ".venv", "bin", "python")) ? path.join(root, ".venv", "bin", "python") : "python3");

for (const requiredPath of [
  path.join(releaseRoot, "dist", "index.html"),
  path.join(releaseRoot, "server", "pdf-engine-server.mjs"),
  path.join(releaseRoot, "engine", "pdf_engine.py"),
  path.join(releaseRoot, "run.sh"),
  path.join(releaseRoot, "support-bundle.sh"),
  path.join(releaseRoot, "release-manifest.json"),
  path.join(releaseRoot, "logs", ".gitkeep"),
]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`local package is missing ${requiredPath}; run npm run package:local`);
  }
}

await validateDesktopReadiness(releaseRoot);

const server = spawn(process.execPath, ["server/pdf-engine-server.mjs"], {
  cwd: releaseRoot,
  env: {
    ...process.env,
    PORT: String(port),
    PDF_ENGINE_PYTHON: enginePython,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
server.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForServer(`http://127.0.0.1:${port}/api/health`);
  const health = await fetchJson(`http://127.0.0.1:${port}/api/health`);
  if (!health.ok || health.engine !== "pymupdf") {
    throw new Error(`unexpected package health response: ${JSON.stringify(health)}`);
  }
  const page = await fetch(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  if (!page.ok || !html.includes("<!doctype html>")) {
    throw new Error("local package did not serve the built UI");
  }
  const preflight = await fetchJson(`http://127.0.0.1:${port}/api/pdf/preflight`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pdfBase64: await createPdfBase64("Package smoke preflight") }),
  });
  if (!preflight.validation?.ok || preflight.pageCount !== 1 || !Array.isArray(preflight.warnings)) {
    throw new Error(`package preflight endpoint did not return a valid report: ${JSON.stringify(preflight)}`);
  }
  const manifest = await readPackageManifest();
  if (manifest.claimBoundary?.nativeDesktop !== false || manifest.claimBoundary?.productionSaaS !== false) {
    throw new Error(`local package manifest must keep native/SaaS claims blocked: ${JSON.stringify(manifest)}`);
  }
  if (manifest.runtime?.logs !== "logs/pdfeditor-local.log" || manifest.runtime?.supportBundle !== "support-bundle.sh") {
    throw new Error(`local package manifest is missing log/support paths: ${JSON.stringify(manifest)}`);
  }
} finally {
  server.kill("SIGTERM");
  await delay(250);
}

async function waitForServer(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`package server exited early: ${server.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error(`package server did not become ready\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${body}`);
  }
  return JSON.parse(body);
}

async function readPackageManifest() {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(path.join(releaseRoot, "release-manifest.json"), "utf8"));
}

async function createPdfBase64(text) {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(text, {
    x: 72,
    y: 700,
    size: 16,
    font,
  });
  return Buffer.from(await document.save()).toString("base64");
}
