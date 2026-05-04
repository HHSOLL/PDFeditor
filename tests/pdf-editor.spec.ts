import { expect, test } from "@playwright/test";
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
