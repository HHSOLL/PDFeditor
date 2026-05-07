import { expect, test } from "@playwright/test";
import path from "node:path";
import { createCrossPageReflowPdf, loadPdf } from "./core-editing-helpers";

test("cascades reflow across page boundary", async ({ page }) => {
  const samplePath = path.resolve("tmp/core-reflow-cross-page.pdf");
  await createCrossPageReflowPdf(samplePath);
  await loadPdf(page, samplePath, "2쪽");

  await page.locator(".source-text", { hasText: "Cross page lead paragraph" }).click();
  await page.locator(".annotation.text textarea").fill("Cross page lead paragraph expands. ".repeat(30));
  await page.locator("#fontSize").fill("38");
  await page.locator("#fontSize").press("Enter");

  await page.locator(".thumb").nth(1).click();
  await expect(page.locator(".flowed-source-text", {
    hasText: "Second page paragraph should cascade",
  })).toBeVisible();
});
