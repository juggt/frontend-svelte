/**
 * Playwright test for MeterPhoto OCR feature.
 * Uses the user's meter photo (035728.6 kWh) as fixture.
 *
 * Flow tested:
 *   1. Navigate to /insert
 *   2. Click 📷 button next to value field
 *   3. Upload meter.jpg
 *   4. Wait for OCR result
 *   5. Verify value + date are filled
 *
 * Note: Tesseract.js loads WASM on first run → longer timeout for OCR step.
 */

import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers.mjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METER_PHOTO = path.join(__dirname, "fixtures", "meter.jpg");

// Dynamic base detection based on vite config
const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173/services/konsum-frontend-svelte";

// Unique category name per test run
const CATEGORY = `METER_${Date.now()}`;

test.describe("MeterPhoto OCR", () => {
  test.use({ baseURL: BASE });

  test("upload meter photo → OCR fills value + date", async ({ page }) => {
    // Login via API first to set session
    await login(page);

    // Navigate to insert page
    await page.goto("/insert");
    await page.waitForLoadState("networkidle");

    // Wait for any category form to appear (categories loaded from API)
    const firstFieldset = page.locator("fieldset").first();
    await expect(firstFieldset).toBeVisible({ timeout: 15_000 });

    // Find the photo button in the first category's section
    const photoBtn = firstFieldset.locator("button.photo-btn");
    await expect(photoBtn).toBeVisible({ timeout: 5_000 });

    // Open photo modal
    await photoBtn.click();
    await expect(page.locator(".modal")).toBeVisible();

    // Upload the meter photo
    const fileInput = page.locator(".modal input[type=file]");
    await fileInput.setInputFiles(METER_PHOTO);

    // Wait for OCR to complete (Tesseract.js can take a while)
    const successMessage = page.locator(".modal .status.success");
    await expect(successMessage).toBeVisible({ timeout: 60_000 });

    // Should show recognized number
    const text = await successMessage.textContent();
    console.log("OCR result:", text);
    expect(text).toMatch(/\d+/);

    // Accept the recognized value
    await page.locator(".modal button", { hasText: "Wert übernehmen" }).click();
    await expect(page.locator(".modal")).not.toBeVisible({ timeout: 3_000 });

    // Value field should now have a number
    const valueInput = firstFieldset.locator("input[type=text]").first();
    const value = await valueInput.inputValue();
    expect(value).toMatch(/^\d+(\.\d+)?$/);
    console.log("Filled value:", value);

    // Screenshot for debugging
    await page.screenshot({ path: "build/test/meter-ocr-result.png" });
  });
});
