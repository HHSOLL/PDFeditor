import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

function runPython(script: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", script, ...args], {
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
        reject(new Error(`python3 exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
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

test("selects multi-line PDF text as one editable paragraph without repainting the canvas", async ({
  page,
}) => {
  const samplePath = path.resolve("tmp/sample-paragraph.pdf");
  await createSamplePdf(samplePath);

  await page.goto("http://127.0.0.1:5173/");
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(samplePath);

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

  await page.locator("#fontSize").fill("24");
  await page.locator("#fontSize").press("Enter");
  await expect(page.locator(".page-shell canvas")).toHaveAttribute("data-persist-check", "true");
  await expect(page.locator(".flow-slice").first()).toBeVisible();
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
  await expect(page.locator(".page-shell canvas")).toBeVisible();
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

test("edits and exports the repository ex.pdf without losing page structure", async ({
  page,
}) => {
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
  const firstSourceImage = page.locator(".source-image").first();
  await expect(firstSourceImage).toBeVisible({ timeout: 45_000 });
  await firstSourceImage.click();
  await expect(page.locator(".annotation.redact").first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
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
