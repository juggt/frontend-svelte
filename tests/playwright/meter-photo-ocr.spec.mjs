/**
 * Playwright test: MeterPhoto OCR value recognition — full pipeline.
 *
 * Uses window.__OCR_MOCK__ to bypass real Tesseract.js and inject
 * a known meter reading. This verifies:
 *   - OCR result is displayed correctly in the modal
 *   - "Wert übernehmen" copies the value into the value input
 *   - Date (from EXIF / file.lastModified) is copied into the time input
 *   - The value matches what the meter shows (035728.6 kWh)
 *
 * For real Tesseract OCR (without mock), see meter-photo.spec.mjs.
 *
 * Fixture: tests/playwright/fixtures/meter.jpg  (Stromzähler 035728.6 kWh)
 */

import { test, expect } from "@playwright/test";
import { login, BASE, USERS } from "./helpers.mjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const METER_PHOTO = path.join(__dirname, "fixtures", "meter.jpg");
const API_BASE    = "http://localhost:5173/api";

// Meter reading visible on the fixture photo
const EXPECTED_VALUE = "35728.6";
const CATEGORY = `METER_OCR_${Date.now()}`;

// ── API helpers ────────────────────────────────────────────────────────────

async function getToken(page) {
  const resp = await page.request.post(`${API_BASE}/authenticate`, {
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ username: USERS.user1.username, password: USERS.user1.password }),
  });
  expect(resp.ok()).toBeTruthy();
  return (await resp.json()).access_token;
}

// ── Setup / Teardown ───────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  const page  = await browser.newPage();
  const token = await getToken(page);
  await page.request.put(`${API_BASE}/category/${CATEGORY}`, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    data: JSON.stringify({ name: CATEGORY, description: "OCR mock test", unit: "kWh", fractionalDigits: 1 }),
  });
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page  = await browser.newPage();
  const token = await getToken(page);
  await page.request.delete(`${API_BASE}/category/${CATEGORY}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await page.close();
});

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe("MeterPhoto – Wert-Erkennung (mit Mock)", () => {

  test.beforeEach(async ({ page }) => {
    // Inject OCR mock before page loads — MeterPhoto.svelte checks this
    await page.addInitScript(`window.__OCR_MOCK__ = "${EXPECTED_VALUE}";`);
  });

  test("Erkannter Wert wird korrekt im Modal angezeigt", async ({ page }) => {
    await login(page);
    await page.locator("a", { hasText: "Insert" }).first().click();
    await expect(page.locator("fieldset").first()).toBeVisible({ timeout: 10_000 });

    const section = page.locator(`label[for="${CATEGORY}_value"]`);
    await expect(section).toBeVisible({ timeout: 5_000 });

    // Modal öffnen + Foto hochladen
    await section.locator("button.photo-btn").click();
    await page.locator(".modal input[type=file]").setInputFiles(METER_PHOTO);

    // Mock ist sofort — kein langer OCR-Wait nötig
    const successMsg = page.locator(".modal .status.success");
    await expect(successMsg).toBeVisible({ timeout: 5_000 });

    // Modal zeigt genau den erwarteten Wert
    await expect(successMsg).toContainText(EXPECTED_VALUE);

    await page.screenshot({ path: "build/test/ocr-mock-modal.png" });
  });

  test("Wert wird korrekt in das Eingabefeld übernommen", async ({ page }) => {
    await login(page);
    await page.locator("a", { hasText: "Insert" }).first().click();
    await expect(page.locator("fieldset").first()).toBeVisible({ timeout: 10_000 });

    const section    = page.locator(`label[for="${CATEGORY}_value"]`);
    const valueInput = page.locator(`input#${CATEGORY}_value`);

    await expect(section).toBeVisible({ timeout: 5_000 });

    await section.locator("button.photo-btn").click();
    await page.locator(".modal input[type=file]").setInputFiles(METER_PHOTO);

    await expect(page.locator(".modal .status.success")).toBeVisible({ timeout: 5_000 });
    await page.locator(".modal button", { hasText: "Wert übernehmen" }).click();
    await expect(page.locator(".modal")).not.toBeVisible();

    // Wert im Eingabefeld muss dem Zählerstand entsprechen
    const filled = await valueInput.inputValue();
    console.log(`Wert im Feld: "${filled}"  |  Erwartet: "${EXPECTED_VALUE}"`);
    expect(filled).toBe(EXPECTED_VALUE);
  });

  test("Datum aus Foto-Metadaten wird in das Zeit-Feld übernommen", async ({ page }) => {
    await login(page);
    await page.locator("a", { hasText: "Insert" }).first().click();
    await expect(page.locator("fieldset").first()).toBeVisible({ timeout: 10_000 });

    const section   = page.locator(`label[for="${CATEGORY}_value"]`);
    const dateInput = page.locator(`input#${CATEGORY}_time`);

    await expect(section).toBeVisible({ timeout: 5_000 });

    // Zeit-Feld vor Upload merken
    const dateBefore = await dateInput.inputValue();

    await section.locator("button.photo-btn").click();
    await page.locator(".modal input[type=file]").setInputFiles(METER_PHOTO);

    await expect(page.locator(".modal .status.success")).toBeVisible({ timeout: 5_000 });

    // Datum-Hinweis im Modal sichtbar
    await expect(page.locator(".modal .date-hint")).toBeVisible();
    const dateHint = await page.locator(".modal .date-hint").textContent();
    console.log("Datum-Hinweis:", dateHint?.trim());

    await page.locator(".modal button", { hasText: "Wert übernehmen" }).click();
    await expect(page.locator(".modal")).not.toBeVisible();

    // Zeit-Feld muss nach Upload gefüllt sein
    const dateAfter = await dateInput.inputValue();
    console.log(`Datum vorher: "${dateBefore}"  |  nachher: "${dateAfter}"`);
    expect(dateAfter).not.toBe("");

    await page.screenshot({ path: "build/test/ocr-mock-date-filled.png" });
  });
});
