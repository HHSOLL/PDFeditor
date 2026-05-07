import { expect, test } from "@playwright/test";
import path from "node:path";
import { createFigureCaptionReflowPdf, loadPdf, overlaps } from "./core-editing-helpers";

test("reflows text around protected figure and caption regions", async ({ page }) => {
  const samplePath = path.resolve("tmp/core-reflow-figure-caption.pdf");
  await createFigureCaptionReflowPdf(samplePath);
  await loadPdf(page, samplePath);

  await expect(page.locator(".source-image").first()).toBeVisible();
  await expect(page.locator(".source-text[data-role='caption']", { hasText: "Figure 1." })).toBeVisible();

  await page.locator(".source-text", { hasText: "Figure-aware lead paragraph" }).click();
  await page.locator(".annotation.text textarea").fill(
    "Figure-aware lead paragraph expands and forces the following paragraph to solve around the protected image and caption. ".repeat(3),
  );
  await page.locator("#fontSize").fill("20");
  await page.locator("#fontSize").press("Enter");

  const moved = page.locator(".flowed-source-text", { hasText: "Follower paragraph should avoid the figure" });
  await expect(moved).toBeVisible();
  expect(await overlaps(page, ".flowed-source-text", ".source-image")).toBe(false);
  expect(await overlaps(page, ".flowed-source-text", ".source-text[data-role='caption']")).toBe(false);
});
