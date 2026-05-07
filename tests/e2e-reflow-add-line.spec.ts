import { expect, test } from "@playwright/test";
import path from "node:path";
import { createReflowParagraphPdf, loadPdf } from "./core-editing-helpers";

test("adding a line to a source paragraph moves downstream paragraphs", async ({ page }) => {
  const samplePath = path.resolve("tmp/core-reflow-add-line.pdf");
  await createReflowParagraphPdf(samplePath);
  await loadPdf(page, samplePath);

  const follower = page.locator(".source-text", { hasText: "Follower paragraph should move down" });
  const beforeTop = await follower.evaluate((node) => node.getBoundingClientRect().top);

  await page.locator(".source-text", { hasText: "Editable lead paragraph" }).click();
  await page.locator(".annotation.text textarea").fill("Editable lead paragraph\nwith one added line");
  await page.keyboard.press("Tab");

  const moved = page.locator(".flowed-source-text", { hasText: "Follower paragraph should move down" });
  await expect(moved).toBeVisible();
  const afterTop = await moved.evaluate((node) => node.getBoundingClientRect().top);
  expect(afterTop).toBeGreaterThan(beforeTop);
});
