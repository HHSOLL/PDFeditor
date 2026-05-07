import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";

const root = process.cwd();
const distIndex = path.join(root, "dist", "index.html");
const port = Number(process.env.RELEASE_SMOKE_PORT || 8799);

if (!existsSync(distIndex)) {
  throw new Error("dist/index.html is missing; run npm run build before release smoke");
}

const server = spawn(process.execPath, ["server/pdf-engine-server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
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
    throw new Error(`unexpected health response: ${JSON.stringify(health)}`);
  }

  const providerStatus = await fetchJson(`http://127.0.0.1:${port}/api/pdf/provider-status`);
  if (
    !providerStatus.ok ||
    providerStatus.activeProvider !== "pymupdf" ||
    providerStatus.claimGate100?.ready !== false ||
    !providerStatus.claimGate100?.blockers?.some((blocker) => blocker.id === "commercialSdkObjectEditing")
  ) {
    throw new Error(`provider status did not preserve the final claim gate: ${JSON.stringify(providerStatus)}`);
  }

  const page = await fetch(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  if (!page.ok || !html.includes("<!doctype html>")) {
    throw new Error("production server did not serve built UI");
  }

  const ocrStatus = await fetchJson(`http://127.0.0.1:${port}/api/pdf/ocr-status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language: "eng" }),
  });
  if (!ocrStatus.ok || !Array.isArray(ocrStatus.missingLanguages) || ocrStatus.missingLanguages.length !== 0) {
    throw new Error(`OCR runtime is not available through product server: ${JSON.stringify(ocrStatus)}`);
  }

  const leftPdfBase64 = await createPdfBase64("Release smoke left text");
  const rightPdfBase64 = await createPdfBase64("Release smoke right text");
  const compare = await fetchJson(`http://127.0.0.1:${port}/api/pdf/compare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      leftBase64: leftPdfBase64,
      rightBase64: rightPdfBase64,
      report: true,
    }),
  });
  if (!compare.ok || compare.changedPageCount !== 1 || typeof compare.reportBase64 !== "string") {
    throw new Error(`compare endpoint failed through product server: ${JSON.stringify(compare)}`);
  }

  const batch = await fetchJson(`http://127.0.0.1:${port}/api/pdf/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobs: [
        {
          fileName: "release-smoke.pdf",
          pdfBase64: await createPdfBase64("Release smoke RELEASE_SECRET"),
          payload: {
            pdfBase64: leftPdfBase64,
            pages: [{ sourceIndex: 0, rotation: 0 }],
            operations: [
              {
                type: "redactSearch",
                pageIndex: 0,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                text: "RELEASE_SECRET",
                color: "#ffffff",
                opacity: 1,
                strokeWidth: 0,
              },
              {
                type: "text",
                pageIndex: 0,
                x: 0.08,
                y: 0.12,
                width: 0.72,
                height: 0.05,
                text: "Release smoke batch watermark",
                fontSize: 12,
                color: "#295BDB",
                opacity: 1,
                strokeWidth: 1,
              },
            ],
            sourceTexts: [],
            metadata: {
              title: "Release Smoke Batch",
              author: "",
              subject: "",
              keywords: "",
              creator: "PDF Studio",
              producer: "PDF Studio Engine",
            },
            saveOptions: {
              annotationMode: "flatten",
              redactionMode: "textOnly",
              sanitize: false,
              validate: true,
            },
          },
        },
      ],
    }),
  });
  if (!batch.ok || batch.jobCount !== 1 || batch.successCount !== 1 || typeof batch.jobs?.[0]?.pdfBase64 !== "string") {
    throw new Error(`batch endpoint failed through product server: ${JSON.stringify(batch)}`);
  }
} finally {
  server.kill("SIGTERM");
  await delay(250);
}

async function waitForServer(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`server exited early: ${server.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
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
  throw new Error(`server did not become ready\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${body}`);
  }
  return JSON.parse(body);
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
