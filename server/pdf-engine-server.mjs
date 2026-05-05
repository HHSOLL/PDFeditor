#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const distRoot = path.join(root, "dist");
const enginePath = path.join(root, "engine", "pdf_engine.py");
const enginePython = process.env.PDF_ENGINE_PYTHON ||
  (existsSync(path.join(root, ".venv", "bin", "python")) ? path.join(root, ".venv", "bin", "python") : "python3");
const port = Number(process.env.PORT || 8787);
const maxBodyBytes = 80 * 1024 * 1024;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      sendEmpty(response, 204);
      return;
    }

    if (request.method === "GET" && request.url === "/api/health") {
      sendJson(response, 200, { ok: true, engine: "pymupdf" });
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/apply") {
      const payload = await readJsonBody(request);
      const result = await runEngine(["apply", "--stdin", "--stdout"], payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/validate") {
      const payload = await readJsonBody(request);
      const result = await runEngine(["validate", "--stdin", "--stdout"], payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/preflight") {
      const payload = await readJsonBody(request);
      const result = await runEngine(["preflight", "--stdin", "--stdout"], payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/preflight-fixup") {
      const payload = await readJsonBody(request);
      const result = await runEngine(["preflight-fixup", "--stdin", "--stdout"], payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/compare") {
      const payload = await readJsonBody(request);
      const result = await runCompare(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/batch") {
      const payload = await readJsonBody(request);
      const result = await runBatch(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/ocr") {
      const payload = await readJsonBody(request);
      const result = await runEngine(["ocr", "--stdin", "--stdout"], payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/ocr-status") {
      const payload = await readJsonBody(request);
      const args = ["ocr-status", "--language", String(payload.language || "eng"), "--stdout"];
      if (payload.tessdata) {
        args.push("--tessdata", String(payload.tessdata));
      }
      const result = await runEngine(args, {});
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/ocr-correct") {
      const payload = await readJsonBody(request);
      const result = await runEngine(["ocr-correct", "--stdin", "--stdout"], payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/accessibility-repair") {
      const payload = await readJsonBody(request);
      const result = await runEngine(["accessibility-repair", "--stdin", "--stdout"], payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/cert-sign") {
      const payload = await readJsonBody(request);
      const result = await runEngine(["cert-sign", "--stdin", "--stdout"], payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/signature-validate") {
      const payload = await readJsonBody(request);
      const result = await runEngine(["signature-validate", "--stdin", "--stdout"], payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/pdf/extract") {
      const payload = await readJsonBody(request);
      const pdfBase64 = String(payload.pdfBase64 || "");
      if (!pdfBase64) {
        sendJson(response, 400, { error: "pdfBase64 is required" });
        return;
      }
      const password = String(payload.password || "");
      const result = await runEngine(["extract-stdin"], { pdfBase64, password });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "method not allowed" });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "unknown engine server error",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`PDF engine server listening on http://127.0.0.1:${port}`);
});

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      throw new Error("request body is too large");
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function runEngine(args, payload) {
  if (args[0] === "extract-stdin") {
    return runExtract(payload);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(enginePython, [enginePath, ...args], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8") || `engine exited ${code}`));
        return;
      }
      try {
        resolve(parseEngineJson(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function parseEngineJson(output) {
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) {
    throw new Error("engine did not return JSON");
  }
  return JSON.parse(output.slice(jsonStart));
}

async function runExtract(payload) {
  const tempDir = path.join(root, "tmp", "engine-api");
  const inputPath = path.join(tempDir, `extract-${Date.now()}.pdf`);
  await import("node:fs/promises").then(async (fs) => {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(inputPath, Buffer.from(String(payload.pdfBase64), "base64"));
  });
  try {
    const args = ["extract", "--input", inputPath];
    if (payload.password) {
      args.push("--password", String(payload.password));
    }
    const output = await runEngine(args, {});
    return output;
  } finally {
    await import("node:fs/promises").then((fs) => fs.rm(inputPath, { force: true }));
  }
}

async function runCompare(payload) {
  const tempDir = path.join(root, "tmp", "engine-api", `compare-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  const leftPath = path.join(tempDir, "left.pdf");
  const rightPath = path.join(tempDir, "right.pdf");
  const reportPath = path.join(tempDir, "compare-report.pdf");
  try {
    await writeFile(leftPath, Buffer.from(String(payload.leftBase64 || ""), "base64"));
    await writeFile(rightPath, Buffer.from(String(payload.rightBase64 || ""), "base64"));
    const args = ["compare", "--input", leftPath, "--other", rightPath, "--stdout"];
    if (payload.report !== false) {
      args.push("--report", reportPath);
    }
    const result = await runEngine(args, {});
    if (existsSync(reportPath)) {
      result.reportBase64 = (await readFile(reportPath)).toString("base64");
    }
    return result;
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function runBatch(payload) {
  const tempDir = path.join(root, "tmp", "engine-api", `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const manifest = { jobs: [] };
  try {
    for (const [index, job] of jobs.entries()) {
      const inputName = `job-${index}-input.pdf`;
      const outputName = `job-${index}-output.pdf`;
      await writeFile(path.join(tempDir, inputName), Buffer.from(String(job.pdfBase64 || ""), "base64"));
      manifest.jobs.push({
        input: inputName,
        output: outputName,
        payload: job.payload || {},
      });
    }
    const manifestPath = path.join(tempDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const result = await runEngine(["batch", "--manifest", manifestPath, "--stdout"], {});
    for (const job of result.jobs || []) {
      if (!job || typeof job.index !== "number") {
        continue;
      }
      const outputPath = path.join(tempDir, `job-${job.index}-output.pdf`);
      if (existsSync(outputPath)) {
        job.pdfBase64 = (await readFile(outputPath)).toString("base64");
      }
    }
    return result;
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...corsHeaders(),
  });
  response.end(body);
}

function sendEmpty(response, status) {
  response.writeHead(status, corsHeaders());
  response.end();
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

async function serveStatic(request, response) {
  const urlPath = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(distRoot, safePath));
  if (!filePath.startsWith(distRoot) || !existsSync(filePath)) {
    const indexPath = path.join(distRoot, "index.html");
    if (existsSync(indexPath)) {
      const body = await readFile(indexPath);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(body);
      return;
    }
    sendJson(response, 404, { error: "not found" });
    return;
  }
  const ext = path.extname(filePath);
  response.writeHead(200, {
    "content-type": mimeTypes.get(ext) || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}
