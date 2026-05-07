import { expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP8z8BQDwAFgwJ/lrW9NwAAAABJRU5ErkJggg==",
  "base64",
);

export async function createParagraphStructurePdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Technical Header", { x: 72, y: 752, size: 9, font });
  page.drawText("Core Editing Contract", { x: 72, y: 705, size: 22, font, color: rgb(0.1, 0.12, 0.15) });
  page.drawText("This first sentence is part of the same paragraph.", { x: 72, y: 650, size: 12, font });
  page.drawText("The second sentence must remain in reading order.", { x: 72, y: 636, size: 12, font });
  page.drawText("Figure 1. Caption text must not merge into body.", { x: 72, y: 580, size: 10, font });
  page.drawText("1", { x: 304, y: 36, size: 10, font });
  await fs.writeFile(filePath, await document.save());
}

export async function createReflowParagraphPdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Editable lead paragraph", { x: 72, y: 704, size: 14, font });
  page.drawText("Follower paragraph should move down", { x: 72, y: 650, size: 13, font });
  page.drawText("Stable footer", { x: 72, y: 40, size: 9, font });
  await fs.writeFile(filePath, await document.save());
}

export async function createFigureCaptionReflowPdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const image = await document.embedPng(onePixelPng);
  page.drawText("Figure-aware lead paragraph", { x: 72, y: 724, size: 14, font });
  page.drawText("Follower paragraph should avoid the figure", { x: 72, y: 640, size: 13, font });
  page.drawImage(image, { x: 72, y: 420, width: 260, height: 190 });
  page.drawText("Figure 1. Protected image area", { x: 72, y: 398, size: 11, font });
  await fs.writeFile(filePath, await document.save());
}

export async function createCrossPageReflowPdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const firstPage = document.addPage([612, 792]);
  firstPage.drawText("Cross page lead paragraph", { x: 72, y: 700, size: 16, font });
  firstPage.drawText("Last line before page boundary", { x: 72, y: 672, size: 13, font });
  const secondPage = document.addPage([612, 792]);
  secondPage.drawText("Second page paragraph should cascade", { x: 72, y: 700, size: 14, font });
  await fs.writeFile(filePath, await document.save());
}

export async function createCrossPageObjectReflowPdf(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const image = await document.embedPng(onePixelPng);
  const firstPage = document.addPage([612, 792]);
  firstPage.drawText("Cross page object lead paragraph", { x: 72, y: 720, size: 16, font });
  firstPage.drawImage(image, { x: 72, y: 96, width: 260, height: 220 });
  firstPage.drawText("Figure 2. Object should continue on page two", { x: 72, y: 74, size: 11, font });
  const secondPage = document.addPage([612, 792]);
  secondPage.drawText("Second page text remains part of the same flow", { x: 72, y: 700, size: 14, font });
  await fs.writeFile(filePath, await document.save());
}

export async function loadPdf(page: Page, filePath: string, pageCountText = "1쪽"): Promise<void> {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(filePath);
  await expect(page.locator("#pageCount")).toHaveText(pageCountText, { timeout: 45_000 });
  await expect(page.locator(".page-stage").first()).toBeVisible({ timeout: 45_000 });
}

export async function overlaps(page: Page, leftSelector: string, rightSelector: string): Promise<boolean> {
  return page.evaluate(
    ({ leftSelector: left, rightSelector: right }) => {
      const leftNode = document.querySelector<HTMLElement>(left);
      const rightNode = document.querySelector<HTMLElement>(right);
      if (!leftNode || !rightNode) {
        return false;
      }
      const leftRect = leftNode.getBoundingClientRect();
      const rightRect = rightNode.getBoundingClientRect();
      const width = Math.max(0, Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left));
      const height = Math.max(0, Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top));
      return width * height > 1;
    },
    { leftSelector, rightSelector },
  );
}
