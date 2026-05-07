import { expect, test } from "@playwright/test";
import path from "node:path";
import { createFigureCaptionReflowPdf, loadPdf, overlaps } from "./core-editing-helpers";

test("reflows a figure and caption group when upstream text expands", async ({ page }) => {
  const samplePath = path.resolve("tmp/core-reflow-object-group.pdf");
  await createFigureCaptionReflowPdf(samplePath);
  await loadPdf(page, samplePath);

  const originalImage = await page.locator(".source-image").first().boundingBox();
  expect(originalImage).toBeTruthy();

  await page.locator(".source-text", { hasText: "Figure-aware lead paragraph" }).click();
  await page.locator(".annotation.text textarea").fill(
    "Figure-aware lead paragraph expands enough to move the figure as a real flow object. ".repeat(2),
  );
  await page.locator("#fontSize").fill("18");
  await page.locator("#fontSize").press("Enter");

  const movedImage = page.locator(".source-image.flowed-source-object").first();
  await expect(movedImage).toBeVisible();
  const movedBox = await movedImage.boundingBox();
  expect(movedBox).toBeTruthy();
  expect(movedBox!.y).toBeGreaterThan(originalImage!.y + 40);

  const movedCaption = page.locator(".flowed-source-text[data-role='caption']", { hasText: "Figure 1." });
  await expect(movedCaption).toBeVisible();
  const captionBox = await movedCaption.boundingBox();
  expect(captionBox).toBeTruthy();
  expect(captionBox!.y).toBeGreaterThan(movedBox!.y + movedBox!.height - 2);

  const follower = page.locator(".flowed-source-text", { hasText: "Follower paragraph should avoid the figure" });
  await expect(follower).toBeVisible();
  expect(await overlaps(page, ".flowed-source-text", ".source-image.flowed-source-object")).toBe(false);
  expect(await overlaps(page, ".flowed-source-text", ".flowed-source-text[data-role='caption']")).toBe(false);
});
