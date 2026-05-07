import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const packageDir = path.join(root, "tmp", "manual-compatibility-package");
const manifestPath = path.join(packageDir, "manifest.json");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceRoot = path.join(root, "tmp", "manual-viewer-smoke", runId);
const desktopInputDir = path.join(process.env.HOME || "/Users/sol", "Desktop", "pdfeditor-manual-smoke-input");
const limit = Number(process.env.MANUAL_VIEWER_LIMIT || "0");
const offset = Number(process.env.MANUAL_VIEWER_OFFSET || "0");
const delayMs = Number(process.env.MANUAL_VIEWER_DELAY_MS || "1800");
const commandTimeoutMs = Number(process.env.MANUAL_VIEWER_COMMAND_TIMEOUT_MS || "7000");
const openTimeoutMs = Number(process.env.MANUAL_VIEWER_OPEN_TIMEOUT_MS || commandTimeoutMs);
const closeAfterEach = process.env.MANUAL_VIEWER_CLOSE_AFTER_EACH !== "0";
const quitAcrobatBetweenFiles = process.env.MANUAL_VIEWER_ACROBAT_QUIT_BETWEEN_FILES === "1";
const toolPathPrefix = ["/opt/homebrew/bin", "/usr/local/bin"].filter((directory) => existsSync(directory)).join(":");
const childEnv = {
  ...process.env,
  PATH: [toolPathPrefix, process.env.PATH || ""].filter(Boolean).join(":"),
};

const viewers = [
  {
    id: "acrobat",
    label: "Adobe Acrobat Pro / Reader",
    appName: "Adobe Acrobat",
    activateName: "Acrobat",
    processName: "Acrobat",
    closeBeforeOpen: true,
    openMode: "systemOpen",
    quitBetweenFiles: quitAcrobatBetweenFiles,
    titleScripts: [
      'tell application "Adobe Acrobat" to get name of active doc',
      'tell application "System Events" to tell process "Acrobat" to get name of window 1',
    ],
  },
  {
    id: "preview",
    label: "macOS Preview",
    appName: "Preview",
    activateName: "Preview",
    processName: "Preview",
    closeBeforeOpen: true,
    titleScripts: ['tell application "System Events" to tell process "Preview" to get name of window 1'],
  },
  {
    id: "chrome",
    label: "Google Chrome PDF viewer",
    appName: "Google Chrome",
    activateName: "Google Chrome",
    processName: "Google Chrome",
    newWindowBeforeViewer: true,
    openMode: "browserTab",
    titleScripts: [
      'tell application "Google Chrome" to get title of active tab of front window',
      'tell application "Google Chrome" to get URL of active tab of front window',
    ],
  },
  {
    id: "edge",
    label: "Microsoft Edge PDF viewer",
    appName: "Microsoft Edge",
    activateName: "Microsoft Edge",
    processName: "Microsoft Edge",
    newWindowBeforeViewer: true,
    openMode: "browserTab",
    titleScripts: [
      'tell application "Microsoft Edge" to get title of active tab of front window',
      'tell application "Microsoft Edge" to get URL of active tab of front window',
    ],
  },
];

const requestedViewers = new Set(
  (process.env.MANUAL_VIEWERS || viewers.map((viewer) => viewer.id).join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const selectedViewers = viewers.filter((viewer) => requestedViewers.has(viewer.id));
if (!selectedViewers.length) {
  throw new Error(`No viewer matched MANUAL_VIEWERS=${process.env.MANUAL_VIEWERS || ""}`);
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const startIndex = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
const endIndex = limit > 0 ? startIndex + limit : undefined;
const entries = manifest.entries.slice(startIndex, endIndex);
if (!entries.length) {
  throw new Error(`No manual smoke entries selected with MANUAL_VIEWER_OFFSET=${offset} MANUAL_VIEWER_LIMIT=${limit}`);
}
await fs.mkdir(evidenceRoot, { recursive: true });
await fs.mkdir(desktopInputDir, { recursive: true });

const results = [];
for (const viewer of selectedViewers) {
  if (viewer.newWindowBeforeViewer) {
    await runAllowFailure("osascript", ["-e", `tell application "${viewer.activateName}" to make new window`]);
    await runAllowFailure("osascript", ["-e", `tell application "${viewer.activateName}" to activate`]);
    await sleep(800);
  }
  for (const entry of entries) {
    const sourcePath = entry.path;
    const inputPath = path.join(desktopInputDir, entry.file);
    await fs.copyFile(sourcePath, inputPath);

    const screenshotPath = path.join(evidenceRoot, `${viewer.id}-${entry.id}-${path.basename(entry.file, ".pdf")}.jpg`);
    let title = "";
    let error = "";
    let screenshotBytes = 0;

    try {
      if (viewer.closeBeforeOpen) {
        await closeViewerWindows(viewer);
        await sleep(400);
      }
      if (viewer.openMode === "appleScript") {
        await run("osascript", [
          "-e",
          `tell application "${viewer.activateName}" to open POSIX file "${escapeAppleScriptString(inputPath)}"`,
        ], { timeoutMs: openTimeoutMs });
      } else if (viewer.openMode === "browserTab") {
        await run("osascript", [
          "-e",
          [
            `tell application "${viewer.activateName}"`,
            "activate",
            "if (count of windows) = 0 then make new window",
            `set URL of active tab of front window to "${escapeAppleScriptString(pathToFileURL(inputPath).href)}"`,
            "end tell",
          ].join("\n"),
        ], { timeoutMs: openTimeoutMs });
      } else {
        await run("open", ["-a", viewer.appName, inputPath], { timeoutMs: openTimeoutMs });
      }
      await sleep(delayMs);
      await runAllowFailure("osascript", ["-e", `tell application "${viewer.activateName}" to activate`]);
      await sleep(250);
      await runAllowFailure("osascript", ["-e", 'tell application "System Events" to key code 53']);
      await sleep(250);
      title = await getViewerDocumentIdentity(viewer);
      await run("screencapture", ["-x", "-t", "jpg", screenshotPath], { timeoutMs: commandTimeoutMs });
      const stat = await fs.stat(screenshotPath);
      screenshotBytes = stat.size;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (closeAfterEach) {
        await closeViewerWindows(viewer);
        await sleep(250);
      }
    }

    const baseName = entry.file.replace(/\.pdf$/i, "");
    const externalId = baseName.match(/EXT-[A-Z0-9]+-\d{3}/)?.[0] || "";
    const expectedTokens = [baseName.slice(0, 12), externalId].filter(Boolean);
    const normalizedTitle = title.toLowerCase();
    const titleMatches = expectedTokens.some((token) => normalizedTitle.includes(token.toLowerCase()));
    const screenshotPresent = screenshotBytes > 50_000;
    const pass = !error && titleMatches && screenshotPresent;
    results.push({
      id: entry.id,
      file: entry.file,
      category: entry.category,
      viewer: viewer.label,
      viewerId: viewer.id,
      pass,
      title,
      screenshotPath,
      screenshotBytes,
      notes: pass
        ? "Opened with matching window title and non-empty screenshot."
        : `titleMatches=${titleMatches}; screenshotPresent=${screenshotPresent}; ${error}`,
    });
  }
}

const summary = {
  ok: results.every((result) => result.pass),
  generatedAt: new Date().toISOString(),
  packageDir,
  evidenceRoot,
  desktopInputDir,
  viewerCount: selectedViewers.length,
  fileCount: entries.length,
  offset: startIndex,
  passCount: results.filter((result) => result.pass).length,
  failCount: results.filter((result) => !result.pass).length,
  results,
};

await fs.writeFile(path.join(evidenceRoot, "results.json"), JSON.stringify(summary, null, 2));
await fs.writeFile(path.join(evidenceRoot, "results.md"), renderMarkdown(summary));
console.log(JSON.stringify({
  ok: summary.ok,
  evidenceRoot,
  passCount: summary.passCount,
  failCount: summary.failCount,
  viewerCount: summary.viewerCount,
  fileCount: summary.fileCount,
}));

if (!summary.ok && process.env.MANUAL_VIEWER_REQUIRE_PASS === "1") {
  process.exit(1);
}

function renderMarkdown(summary) {
  const lines = [
    "# Manual Viewer Smoke Results",
    "",
    `Generated: ${summary.generatedAt}`,
    `Package: \`${summary.packageDir}\``,
    `Evidence: \`${summary.evidenceRoot}\``,
    `Offset: ${summary.offset}`,
    `Result: ${summary.passCount} pass / ${summary.failCount} fail`,
    "",
    "| ID | File | Category | Viewer | Result | Window Title | Screenshot | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const result of summary.results) {
    lines.push(
      [
        result.id,
        `\`${result.file}\``,
        result.category,
        result.viewer,
        result.pass ? "Pass" : "Fail",
        escapePipes(result.title || ""),
        `\`${path.relative(root, result.screenshotPath)}\``,
        escapePipes(result.notes || ""),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapePipes(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeAppleScriptString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? commandTimeoutMs;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`));
      }, timeoutMs)
      : null;
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${err || out}`));
        return;
      }
      resolve(out);
    });
  });
}

async function runAllowFailure(command, args) {
  try {
    await run(command, args);
  } catch {
    // Best-effort cleanup for GUI windows; failures are not smoke failures.
  }
}

async function closeViewerWindows(viewer) {
  if (viewer.quitBetweenFiles) {
    await runAllowFailure("osascript", ["-e", `tell application "${viewer.activateName}" to quit`]);
    return;
  }
  if (viewer.id === "acrobat") {
    await runAllowFailure("osascript", [
      "-e",
      [
        `tell application "${viewer.activateName}"`,
        "try",
        "close every document",
        "end try",
        "end tell",
      ].join("\n"),
    ]);
    return;
  }
  const scripts = viewer.openMode === "browserTab"
    ? [
      `tell application "${viewer.activateName}"`,
      "if (count of windows) > 0 then close front window",
      "end tell",
    ]
    : [
      `tell application "${viewer.activateName}"`,
      "if (count of windows) > 0 then close every window",
      "end tell",
    ];
  await runAllowFailure("osascript", ["-e", scripts.join("\n")]);
}

async function getViewerDocumentIdentity(viewer) {
  const scripts = viewer.titleScripts?.length
    ? viewer.titleScripts
    : [`tell application "System Events" to tell process "${viewer.processName}" to get name of window 1`];
  const values = [];
  for (const script of scripts) {
    const value = (await runAllowFailureWithOutput("osascript", ["-e", script], { timeoutMs: commandTimeoutMs })).trim();
    if (value) {
      values.push(value);
    }
  }
  return values.join(" ");
}

async function runAllowFailureWithOutput(command, args, options = {}) {
  try {
    return await run(command, args, options);
  } catch {
    return "";
  }
}
