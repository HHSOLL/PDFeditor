import { expect, test } from "@playwright/test";
import path from "node:path";
import { createCrossPageObjectReflowPdf, loadPdf } from "./core-editing-helpers";

test("cascades a figure and caption group onto the next page", async ({ page }) => {
  const samplePath = path.resolve("tmp/core-reflow-object-cross-page.pdf");
  await createCrossPageObjectReflowPdf(samplePath);
  await loadPdf(page, samplePath, "2쪽");

  await page.locator(".source-text", { hasText: "Cross page object lead paragraph" }).click();
  await page.locator(".annotation.text textarea").fill("Cross page object lead paragraph expands. ".repeat(10));
  await page.locator("#fontSize").fill("30");
  await page.locator("#fontSize").press("Enter");

  await page.locator(".thumb").nth(1).click();
  await expect(page.locator(".source-image.flowed-source-object")).toBeVisible();
  await expect(page.locator(".flowed-source-text[data-role='caption']", {
    hasText: "Figure 2.",
  })).toBeVisible();
});
