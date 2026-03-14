import { test } from "@playwright/test";
import { login, BASE } from "./helpers.mjs";

test("debug insert page", async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/insert`);
  await page.waitForLoadState("networkidle");
  console.log("URL:", page.url());
  const photoBtns = await page.locator("button.photo-btn").count();
  const fieldsets = await page.locator("fieldset").count();
  const allInputIds = await page.locator("input").evaluateAll(els => els.map(e => e.id));
  const labels = await page.locator("label").evaluateAll(els => els.map(e => e.getAttribute("for")));
  console.log("photo-btns:", photoBtns, "fieldsets:", fieldsets);
  console.log("input IDs:", allInputIds);
  console.log("label fors:", labels);
  await page.screenshot({ path: "build/test/debug.png" });
});
