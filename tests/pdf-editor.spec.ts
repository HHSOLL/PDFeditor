import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = process.cwd();
const enginePython = process.env.PDF_ENGINE_PYTHON ||
  (existsSync(path.join(root, ".venv", "bin", "python")) ? path.join(root, ".venv", "bin", "python") : "python3");

async function createSamplePdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Original contract title", {
    x: 72,
    y: 700,
    size: 24,
    font,
    color: rgb(0.1, 0.12, 0.15),
  });
  page.drawText("This paragraph can be covered and rewritten.", {
    x: 72,
    y: 650,
    size: 12,
    font,
  });
  page.drawText("Second sentence shares the same paragraph block.", {
    x: 72,
    y: 636,
    size: 12,
    font,
  });
  page.drawText("Amount: $1,200", { x: 72, y: 610, size: 14, font });
  await fs.writeFile(filePath, await document.save());
}

async function createCrossPageFlowPdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const firstPage = document.addPage([612, 792]);
  firstPage.drawText("Flow lead paragraph", {
    x: 72,
    y: 700,
    size: 16,
    font,
    color: rgb(0.1, 0.12, 0.15),
  });
  firstPage.drawText("Stable image-adjacent line", {
    x: 72,
    y: 620,
    size: 13,
    font,
  });
  const secondPage = document.addPage([612, 792]);
  secondPage.drawText("Following page paragraph should move with document reflow", {
    x: 72,
    y: 700,
    size: 14,
    font,
  });
  await fs.writeFile(filePath, await document.save());
}

async function createLongDocumentPdf(filePath: string, pageCount = 12): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`Long document page ${index + 1}`, {
      x: 72,
      y: 700,
      size: 18,
      font,
      color: rgb(0.1, 0.12, 0.15),
    });
    page.drawText(`Body paragraph for page ${index + 1}`, {
      x: 72,
      y: 650,
      size: 12,
      font,
    });
  }
  await fs.writeFile(filePath, await document.save());
}

async function createMixedPageSizePdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const firstPage = document.addPage([612, 792]);
  firstPage.drawText("Mixed size first page", { x: 72, y: 700, size: 18, font });
  const secondPage = document.addPage([792, 612]);
  secondPage.drawText("Mixed size second page landscape", { x: 72, y: 520, size: 18, font });
  await fs.writeFile(filePath, await document.save());
}

async function createImageCollisionPdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP8z8BQDwAFgwJ/lrW9NwAAAABJRU5ErkJggg==",
    "base64",
  );
  const image = await document.embedPng(pngBytes);
  page.drawText("Figure collision lead paragraph", {
    x: 72,
    y: 724,
    size: 16,
    font,
    color: rgb(0.1, 0.12, 0.15),
  });
  page.drawText("Follower paragraph should avoid the figure", {
    x: 72,
    y: 640,
    size: 13,
    font,
  });
  page.drawImage(image, {
    x: 72,
    y: 420,
    width: 260,
    height: 190,
  });
  page.drawText("Figure 1. Protected image area", {
    x: 72,
    y: 398,
    size: 11,
    font,
  });
  await fs.writeFile(filePath, await document.save());
}

function runPython(script: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(enginePython, ["-c", script, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${enginePython} exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

async function createExistingAnnotationPdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await runPython(
    [
      "import fitz, sys",
      "doc = fitz.open()",
      "page = doc.new_page(width=612, height=792)",
      "page.insert_text((72, 92), 'Existing annotation page', fontsize=16)",
      "annot = page.add_rect_annot(fitz.Rect(72, 120, 200, 188))",
      "annot.set_info(content='legacy square annotation')",
      "annot.set_colors(stroke=(1, 0, 0))",
      "annot.update()",
      "doc.save(sys.argv[1])",
      "doc.close()",
    ].join("\n"),
    [filePath],
  );
}

async function createFormPdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Name:", { x: 72, y: 700, size: 12, font });
  page.drawText("Agree:", { x: 72, y: 654, size: 12, font });
  const form = document.getForm();
  const name = form.createTextField("name");
  name.setText("Alice");
  name.addToPage(page, { x: 120, y: 690, width: 200, height: 24 });
  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 120, y: 650, width: 16, height: 16 });
  agree.check();
  await fs.writeFile(filePath, await document.save());
}

async function createChoiceFormPdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Department:", { x: 72, y: 700, size: 12, font });
  page.drawText("Region:", { x: 72, y: 650, size: 12, font });
  const form = document.getForm();
  const department = form.createDropdown("department");
  department.addOptions(["Engineering", "Design", "Legal"]);
  department.select("Design");
  department.addToPage(page, { x: 160, y: 690, width: 160, height: 24 });
  const region = form.createOptionList("region");
  region.addOptions(["Seoul", "Busan", "Jeju"]);
  region.select("Seoul");
  region.addToPage(page, { x: 160, y: 620, width: 160, height: 54 });
  await fs.writeFile(filePath, await document.save());
}

async function annotationCount(filePath: string): Promise<number> {
  const stdout = await runPython(
    [
      "import fitz, sys",
      "doc = fitz.open(sys.argv[1])",
      "print(len(list(doc[0].annots() or [])))",
      "doc.close()",
    ].join("\n"),
    [filePath],
  );
  return Number(stdout.trim());
}

async function widgetValues(filePath: string): Promise<Record<string, string>> {
  const stdout = await runPython(
    [
      "import fitz, json, sys",
      "doc = fitz.open(sys.argv[1])",
      "values = {}",
      "for page in doc:",
      "    for widget in page.widgets() or []:",
      "        values[widget.field_name] = widget.field_value",
      "print(json.dumps(values, ensure_ascii=False))",
      "doc.close()",
    ].join("\n"),
    [filePath],
  );
  return JSON.parse(stdout) as Record<string, string>;
}

async function extractPdfText(filePath: string): Promise<string> {
  return runPython(
    [
      "import fitz, sys",
      "doc = fitz.open(sys.argv[1])",
      "print('\\n'.join(page.get_text('text') for page in doc))",
      "doc.close()",
    ].join("\n"),
    [filePath],
  );
}

async function pageImageCounts(filePath: string): Promise<number[]> {
  const stdout = await runPython(
    [
      "import fitz, json, sys",
      "doc = fitz.open(sys.argv[1])",
      "print(json.dumps([len(page.get_images(full=True)) for page in doc]))",
      "doc.close()",
    ].join("\n"),
    [filePath],
  );
  return JSON.parse(stdout) as number[];
}

async function expectDocumentLoaded(page: Page, pageCountText = "1쪽"): Promise<void> {
  await expect(page.locator("#pageCount")).toHaveText(pageCountText, { timeout: 45_000 });
  await expect(page.locator(".page-stage").first()).toBeVisible({ timeout: 45_000 });
}

test("selects multi-line PDF text as one editable paragraph without repainting the canvas", async ({
  page,
}) => {
  const samplePath = path.resolve("tmp/sample-paragraph.pdf");
  await createSamplePdf(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expectDocumentLoaded(page);

  const paragraphBlock = page.locator(".source-text", {
    hasText: "Second sentence shares the same paragraph block.",
  });
  await expect(paragraphBlock).toBeVisible();

  await page.locator(".page-shell canvas").evaluate((node) => {
    node.setAttribute("data-persist-check", "true");
  });
  await paragraphBlock.click();
  await expect(page.locator(".page-shell canvas")).toHaveAttribute("data-persist-check", "true");
  await expect(page.locator(".source-mask").first()).toBeVisible();

  const editor = page.locator(".annotation.text textarea");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(/This paragraph can be covered and rewritten\..*Second sentence shares/s);
  await expect(page.locator("#fontSize")).toHaveValue("12");
  await page.keyboard.press("Escape");
  await expect(page.locator(".annotation.selected")).toHaveCount(0);
  await expect(page.locator(".annotation.text textarea")).toHaveCount(0);

  await page.locator(".annotation.text").click();
  await page.locator("#fontSize").fill("24");
  await page.locator("#fontSize").press("Enter");
  await expect(page.locator(".page-shell canvas")).toHaveAttribute("data-persist-check", "true");
  await expect(page.locator(".flowed-source-text").first()).toBeVisible();
});

test("edits existing PDF text with auto reflow and exports real PDF text", async ({
  page,
}) => {
  const samplePath = path.resolve("tmp/sample.pdf");
  const exportedPath = path.resolve("tmp/exported.pdf");
  await createSamplePdf(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await expect(page.getByRole("heading", { name: "PDF를 열고 바로 편집하세요" })).toBeVisible();

  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expectDocumentLoaded(page);
  await expect(page.locator(".source-text", { hasText: "Original contract title" })).toBeVisible();

  await page.locator(".source-text", { hasText: "Original contract title" }).click();

  const editor = page.locator(".annotation.text textarea");
  await expect(editor).toBeVisible();
  await editor.fill(
    "수정된 계약 제목입니다. 글씨 크기를 키우면 줄바꿈과 높이가 자동으로 맞춰집니다.",
  );

  const beforeHeight = await page.locator(".annotation.text").evaluate((node) => {
    return node.getBoundingClientRect().height;
  });

  await page.locator("#fontSize").fill("30");
  await page.locator("#fontSize").press("Enter");
  await page.locator("#boxWidth").fill("18");
  await page.locator("#boxWidth").press("Enter");

  const afterHeight = await page.locator(".annotation.text").evaluate((node) => {
    return node.getBoundingClientRect().height;
  });
  expect(afterHeight).toBeGreaterThan(beforeHeight);
  await page.screenshot({ path: "tmp/editor-screen.png", fullPage: true });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 내보내기" }).click();
  const download = await downloadPromise;
  await download.saveAs(exportedPath);

  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(exportedPath);
  await expect(page.locator(".page-shell canvas")).toBeVisible();
  await expect(page.locator(".source-text", { hasText: "수정된" })).toBeVisible();
  const exportedText = (await page.locator(".source-text").allTextContents())
    .join("")
    .replace(/\s+/g, "");
  expect(exportedText).toContain("수정된계약제목입니다");
  expect(exportedText).toContain("글씨크기");
  await expect(page.locator(".source-text", { hasText: "Original contract title" })).toHaveCount(0);
});

test("cascades text reflow to following pages and clears selection with Escape", async ({
  page,
}) => {
  const samplePath = path.resolve("tmp/sample-cross-page-flow.pdf");
  await createCrossPageFlowPdf(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator("#pageCount")).toHaveText("2쪽");

  await page.locator(".source-text", { hasText: "Flow lead paragraph" }).click();
  const editor = page.locator(".annotation.text textarea");
  await expect(editor).toBeVisible();
  await editor.fill("첫 페이지에서 길게 늘어난 문단입니다. ".repeat(18));
  await page.locator("#fontSize").fill("36");
  await page.locator("#fontSize").press("Enter");

  await page.keyboard.press("Escape");
  await expect(page.locator(".annotation.selected")).toHaveCount(0);
  await expect(page.locator(".annotation.text textarea")).toHaveCount(0);

  await page.locator(".thumb").nth(1).click();
  await expect(page.locator(".flowed-source-text", {
    hasText: "Following page paragraph should move with document reflow",
  })).toBeVisible();
});

test("uses a continuous document viewer and thumbnail scrolling", async ({ page }) => {
  const samplePath = path.resolve("tmp/sample-continuous-viewer.pdf");
  await createCrossPageFlowPdf(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);

  await expect(page.locator(".page-stage")).toHaveCount(2);
  await expect(page.locator(".page-stage[data-page-number='1']")).toBeAttached();
  await expect(page.locator(".page-stage[data-page-number='2']")).toBeAttached();
  expect(await page.locator(".menu-bar button:enabled").allTextContents()).toEqual(["파일"]);
  await expect(page.locator(".rail-item:enabled")).toHaveCount(1);

  await page.locator(".thumb").nth(1).click();
  await expect(page.locator(".page-stage.active")).toHaveAttribute("data-page-number", "2");
  await expect(page.locator("#bottomCurrentPage")).toHaveText("2");
  await expect(page.locator(".page-stage")).toHaveCount(2);
});

test("center document viewport scrolls independently", async ({ page }) => {
  const samplePath = path.resolve("tmp/sample-independent-viewport.pdf");
  await createLongDocumentPdf(samplePath, 12);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator(".page-stage")).toHaveCount(12);

  const before = await page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? { top: rect.top, left: rect.left } : null;
    };
    return {
      sidebar: box(".sidebar"),
      inspector: box(".inspector"),
      rail: box(".activity-rail"),
      windowY: window.scrollY,
      canvasTop: document.querySelector<HTMLElement>(".canvas-area")?.scrollTop ?? 0,
    };
  });

  await page.locator(".canvas-area").evaluate((node) => {
    node.scrollTop = 3600;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? { top: rect.top, left: rect.left } : null;
    };
    return {
      sidebar: box(".sidebar"),
      inspector: box(".inspector"),
      rail: box(".activity-rail"),
      windowY: window.scrollY,
      canvasTop: document.querySelector<HTMLElement>(".canvas-area")?.scrollTop ?? 0,
    };
  });

  expect(after.windowY).toBe(0);
  expect(after.canvasTop).toBeGreaterThan(before.canvasTop);
  expect(after.sidebar).toEqual(before.sidebar);
  expect(after.inspector).toEqual(before.inspector);
  expect(after.rail).toEqual(before.rail);
});

test("active thumbnail follows center scroll without moving side panels", async ({ page }) => {
  const samplePath = path.resolve("tmp/sample-thumbnail-sync.pdf");
  await createLongDocumentPdf(samplePath, 12);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator(".page-stage")).toHaveCount(12);

  const sidebarBefore = await page.locator(".sidebar").boundingBox();
  await page.locator(".page-stage[data-page-number='5']").evaluate((node) => {
    node.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(250);

  await expect(page.locator("#bottomCurrentPage")).toHaveText(/[45]/);
  await expect(page.locator(".thumb.active .thumb-meta")).toContainText(/[45]쪽/);
  expect(await page.locator(".sidebar").boundingBox()).toEqual(sidebarBefore);
});

test("thumbnail click scrolls document viewport only", async ({ page }) => {
  const samplePath = path.resolve("tmp/sample-thumbnail-click.pdf");
  await createLongDocumentPdf(samplePath, 12);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator(".page-stage")).toHaveCount(12);

  const inspectorBefore = await page.locator(".inspector").boundingBox();
  const before = await page.locator(".canvas-area").evaluate((node) => node.scrollTop);
  await page.locator(".thumb").nth(7).click();
  const after = await page.locator(".canvas-area").evaluate((node) => node.scrollTop);
  expect(after).toBeGreaterThan(before);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator(".page-stage.active")).toHaveAttribute("data-page-number", "8");
  expect(await page.locator(".inspector").boundingBox()).toEqual(inspectorBefore);
});

test("keeps mixed page overlays page-scoped after zoom", async ({ page }) => {
  const samplePath = path.resolve("tmp/sample-mixed-page-size.pdf");
  await createMixedPageSizePdf(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator(".page-stage")).toHaveCount(2);

  await page.getByRole("button", { name: "텍스트 편집" }).click();
  await page.locator(".page-stage[data-page-number='1'] .annotation-layer").click({ position: { x: 120, y: 120 } });
  await expect(page.locator(".annotation.text")).toHaveCount(1);
  await page.getByRole("button", { name: "텍스트 편집" }).click();
  await page.locator(".thumb").nth(1).click();
  await page.getByRole("button", { name: "텍스트 편집" }).click();
  await page.locator(".page-stage[data-page-number='2'] .annotation-layer").click({ position: { x: 240, y: 160 } });
  await expect(page.locator(".annotation.text")).toHaveCount(2);

  const positionsBefore = await page.locator(".annotation.text").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const pageRect = node.closest(".page-shell")?.getBoundingClientRect();
      return {
        leftRatio: pageRect ? (rect.left - pageRect.left) / pageRect.width : 0,
        topRatio: pageRect ? (rect.top - pageRect.top) / pageRect.height : 0,
      };
    }),
  );
  await page.locator("#zoomInButton").click();
  await page.waitForTimeout(300);
  const positionsAfter = await page.locator(".annotation.text").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const pageRect = node.closest(".page-shell")?.getBoundingClientRect();
      return {
        leftRatio: pageRect ? (rect.left - pageRect.left) / pageRect.width : 0,
        topRatio: pageRect ? (rect.top - pageRect.top) / pageRect.height : 0,
      };
    }),
  );
  expect(positionsAfter[0].leftRatio).toBeCloseTo(positionsBefore[0].leftRatio, 1);
  expect(positionsAfter[1].leftRatio).toBeCloseTo(positionsBefore[1].leftRatio, 1);
});

test("reflows paragraph without overlapping figure and caption when solver has space", async ({ page }) => {
  const samplePath = path.resolve("tmp/sample-image-reflow-solvable.pdf");
  await createImageCollisionPdf(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator(".source-image").first()).toBeVisible();

  await page.locator(".source-text", { hasText: "Figure collision lead paragraph" }).click();
  await page.locator(".annotation.text textarea").fill("이미지 위로 후속 문단이 올라가지 않도록 재배치되는 문단입니다. ".repeat(3));
  await page.locator("#fontSize").fill("20");
  await page.locator("#fontSize").press("Enter");
  await expect(page.locator(".flowed-source-text", { hasText: "Follower paragraph should avoid the figure" })).toBeVisible();

  const overlap = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll<HTMLElement>(".flowed-source-text"));
    const image = document.querySelector<HTMLElement>(".source-image");
    if (!image) return false;
    const imageRect = image.getBoundingClientRect();
    return texts.some((text) => {
      const rect = text.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.right, imageRect.right) - Math.max(rect.left, imageRect.left));
      const y = Math.max(0, Math.min(rect.bottom, imageRect.bottom) - Math.max(rect.top, imageRect.top));
      return x * y > 1;
    });
  });
  expect(overlap).toBe(false);
});

test("blocks export only when semantic layout solver cannot resolve", async ({ page }) => {
  const samplePath = path.resolve("tmp/sample-image-collision.pdf");
  await createImageCollisionPdf(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator(".source-image").first()).toBeVisible();

  await page.locator(".source-text", { hasText: "Figure collision lead paragraph" }).click();
  await page.locator(".annotation.text textarea").fill("이미지 영역과 겹치면 저장되면 안 되는 문단입니다. ".repeat(20));
  await page.locator("#fontSize").fill("48");
  await page.locator("#fontSize").press("Enter");

  await page.getByRole("button", { name: "PDF 내보내기" }).click();
  await expect(page.locator("#toast")).toContainText("레이아웃 충돌");
});

test("edits and exports the repository ex.pdf without losing page structure", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(180_000);
  const samplePath = path.resolve("ex.pdf");
  const exportedPath = path.resolve("tmp/exported-ex.pdf");
  const originalTitle = "Synthetic Computers at Scale for Long-Horizon Productivity Simulation";
  const replacementTitle = "EX PDF UI 검증 제목";
  await fs.access(samplePath);
  const sourceImageCounts = await pageImageCounts(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator("#pageCount")).toHaveText("33쪽", { timeout: 45_000 });
  const titleBlock = page.locator(".source-text", { hasText: "Synthetic Computers at Scale" }).first();
  await expect(titleBlock).toBeVisible({ timeout: 45_000 });

  await titleBlock.click();
  const editor = page.locator(".annotation.text textarea");
  await expect(editor).toBeVisible();
  await editor.fill(replacementTitle);
  await page.keyboard.press("Escape");
  await expect(page.locator(".annotation.selected")).toHaveCount(0);
  await expect(page.locator(".annotation.text textarea")).toHaveCount(0);
  const firstSourceImage = page.locator(".source-image").first();
  await expect(firstSourceImage).toBeVisible({ timeout: 45_000 });
  await firstSourceImage.click();
  await expect(page.locator(".annotation.redact").first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 180_000 });
  await page.getByRole("button", { name: "PDF 내보내기" }).click();
  const download = await downloadPromise;
  await download.saveAs(exportedPath);

  const exported = await PDFDocument.load(await fs.readFile(exportedPath));
  expect(exported.getPageCount()).toBe(33);
  const text = await extractPdfText(exportedPath);
  expect(text).toContain(replacementTitle);
  expect(text).not.toContain(originalTitle);
  const exportedImageCounts = await pageImageCounts(exportedPath);
  expect(exportedImageCounts[0]).toBeLessThan(sourceImageCounts[0]);
});

test("saves metadata and duplicated pages through the advanced save pipeline", async ({
  page,
}) => {
  const samplePath = path.resolve("tmp/sample-advanced.pdf");
  const exportedPath = path.resolve("tmp/exported-advanced.pdf");
  await createSamplePdf(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator(".page-shell canvas")).toBeVisible();

  await page.locator("#saveMode").selectOption("native");
  await page.locator(".metadata-panel summary").click();
  await page.locator("#metaTitle").fill("Advanced PDF Studio Export");
  await page.locator("#metaTitle").blur();
  await page.locator("#metaAuthor").fill("HHSOLL");
  await page.locator("#metaAuthor").blur();

  await page.locator("#duplicatePage").click();
  await expect(page.locator("#pageCount")).toHaveText("2쪽");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 내보내기" }).click();
  const download = await downloadPromise;
  await download.saveAs(exportedPath);

  const exported = await PDFDocument.load(await fs.readFile(exportedPath));
  expect(exported.getPageCount()).toBe(2);
  expect(exported.getTitle()).toBe("Advanced PDF Studio Export");
  expect(exported.getAuthor()).toBe("HHSOLL");
});

test("runs preflight from the inspector without an inert command button", async ({ page }) => {
  const samplePath = path.resolve("tmp/sample-preflight-ui.pdf");
  await createSamplePdf(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator(".page-shell canvas")).toBeVisible();

  await expect(page.locator("#preflightButton")).toBeEnabled();
  await page.locator("#preflightButton").click();
  await expect(page.locator(".preflight-panel")).toContainText("사전 검사");
  await expect(page.locator(".preflight-panel")).toContainText("1쪽");
  await expect(page.locator("#toast")).toContainText("사전 검사");
});

test("imports existing PDF annotations and exports real annotation deletion", async ({
  page,
}) => {
  const samplePath = path.resolve("tmp/sample-existing-annotation.pdf");
  const exportedPath = path.resolve("tmp/exported-existing-annotation.pdf");
  await createExistingAnnotationPdf(samplePath);
  expect(await annotationCount(samplePath)).toBe(1);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);

  const importedAnnotation = page.locator(".annotation.rect").first();
  await expect(importedAnnotation).toBeVisible();
  await importedAnnotation.click();
  await page.locator("#deleteSelected").click();
  await expect(page.locator(".annotation.rect")).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 내보내기" }).click();
  const download = await downloadPromise;
  await download.saveAs(exportedPath);

  expect(await annotationCount(exportedPath)).toBe(0);
});

test("fills imported AcroForm text and checkbox fields through the engine", async ({
  page,
}) => {
  const samplePath = path.resolve("tmp/sample-form.pdf");
  const exportedPath = path.resolve("tmp/exported-form.pdf");
  await createFormPdf(samplePath);
  expect(await widgetValues(samplePath)).toEqual({ agree: "Yes", name: "Alice" });

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expectDocumentLoaded(page);

  await expect(page.locator(".annotation.form-field")).toHaveCount(2);
  await page.locator(".annotation.form-field.text-field input").fill("Carol Form");
  const checkbox = page.locator(".annotation.form-field.checkbox input");
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 내보내기" }).click();
  const download = await downloadPromise;
  await download.saveAs(exportedPath);

  expect(await widgetValues(exportedPath)).toEqual({ agree: "Off", name: "Carol Form" });
});

test("fills imported AcroForm choice fields through the engine", async ({
  page,
}) => {
  const samplePath = path.resolve("tmp/sample-choice-form.pdf");
  const exportedPath = path.resolve("tmp/exported-choice-form.pdf");
  await createChoiceFormPdf(samplePath);
  expect(await widgetValues(samplePath)).toEqual({ department: "Design", region: "Seoul" });

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);

  await expect(page.locator(".annotation.form-field")).toHaveCount(2);
  await page.locator(".annotation.form-field select").first().selectOption("Engineering");
  await page.locator(".annotation.form-field select").nth(1).selectOption("Busan");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 내보내기" }).click();
  const download = await downloadPromise;
  await download.saveAs(exportedPath);

  expect(await widgetValues(exportedPath)).toEqual({ department: "Engineering", region: "Busan" });
});

test("creates a new AcroForm text field and exports it as a real widget", async ({
  page,
}) => {
  const samplePath = path.resolve("tmp/sample-form-create-ui.pdf");
  const exportedPath = path.resolve("tmp/exported-form-create-ui.pdf");
  await createSamplePdf(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator(".page-shell canvas")).toBeVisible();

  await page.locator("#toolbar").getByRole("button", { name: /양식/ }).click();
  await page.locator(".page-stage[data-page-number='1'] .annotation-layer").click({ position: { x: 220, y: 250 } });
  await expect(page.locator(".annotation.form-field")).toHaveCount(1);
  await page.locator("#formName").fill("createdUiText");
  await page.locator("#formName").blur();
  await page.locator("#formValue").fill("UI-created widget value");
  await page.locator("#formValue").blur();
  await page.locator("#formRequired").check();
  await expect(page.locator(".annotation.form-field.text-field input")).toHaveValue("UI-created widget value");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 내보내기" }).click();
  const download = await downloadPromise;
  await download.saveAs(exportedPath);

  expect(await widgetValues(exportedPath)).toMatchObject({
    createdUiText: "UI-created widget value",
  });
});

test("blocks engine-required export when the PDF engine is unavailable", async ({ page }) => {
  const samplePath = path.resolve("tmp/sample-engine-required.pdf");
  await createSamplePdf(samplePath);
  await page.route("**/api/pdf/apply", (route) => {
    void route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "engine intentionally unavailable" }),
    });
  });

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);
  await expect(page.locator(".source-text", { hasText: "Original contract title" })).toBeVisible();
  await page.locator(".source-text", { hasText: "Original contract title" }).click();
  await page.locator(".annotation.text textarea").fill("엔진 없이 저장되면 안 되는 기존 텍스트 교체");

  await page.getByRole("button", { name: "PDF 내보내기" }).click();
  await expect(page.locator("#toast")).toContainText("PDF 엔진이 꺼져 있어");
});
