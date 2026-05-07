import { expect, test } from "@playwright/test";
import path from "node:path";
import { createParagraphStructurePdf, loadPdf } from "./core-editing-helpers";

test("preserves PDF paragraph structure and keeps inspector context focused", async ({ page }) => {
  const samplePath = path.resolve("tmp/core-paragraph-structure.pdf");
  await createParagraphStructurePdf(samplePath);
  await loadPdf(page, samplePath);

  await expect(page.locator("#advancedToolsPanel")).not.toHaveAttribute("open", "");
  await page.locator(".source-text", { hasText: "The second sentence must remain" }).click();

  const editor = page.locator(".annotation.text textarea");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(
    "This first sentence is part of the same paragraph. The second sentence must remain in reading order.",
  );
  await expect(page.locator("[data-inspector-section='text']")).toBeVisible();
  await expect(page.locator("#fontSize")).toBeVisible();
  await expect(page.locator("#lineHeight")).toBeVisible();
  await expect(page.locator("#reflowMode")).toBeVisible();
  await expect(page.locator("#advancedToolsPanel")).not.toHaveAttribute("open", "");
  await expect(page.locator(".source-text[data-role='caption']", { hasText: "Figure 1." })).toBeVisible();
  await expect(page.locator(".source-text[data-role='header']")).toBeVisible();
  await expect(page.locator(".source-text[data-role='footer']")).toBeVisible();
});
