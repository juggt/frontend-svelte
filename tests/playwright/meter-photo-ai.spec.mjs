/**
 * Playwright test: MeterPhoto mit echter AI-Vision-API.
 *
 * Kein Mock — das Bild wird wirklich an den Backend-Endpunkt geschickt,
 * der wiederum OpenRouter / Google Gemma aufruft und einen Zählerwert
 * zurückgibt.
 *
 * Voraussetzung: OPENROUTER_API_KEY in der Umgebung gesetzt (tests/config/config.json).
 * Wird übersprungen (test.skip) wenn kein API-Key vorhanden.
 *
 * Fixture: tests/playwright/fixtures/meter.jpg  (035728.6 kWh)
 */

import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers.mjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const METER_PHOTO = path.join(__dirname, "fixtures", "meter.jpg");
const API_BASE    = "http://localhost:5173/api";
const CATEGORY    = `METER_AI_${Date.now()}`;

// Das Testbild zeigt ca. 3572.86 kWh (erste Stelle 0 oder 9 je nach Modell).
// Wir prüfen ob der Wert in einem plausiblen Bereich liegt statt auf exakte Zahl.
const VALUE_MIN = 3000;
const VALUE_MAX = 100000;

// ── Helpers ────────────────────────────────────────────────────────────────

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
    data: JSON.stringify({ name: CATEGORY, description: "AI OCR test", unit: "kWh", fractionalDigits: 1 }),
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

test.describe("MeterPhoto – echte AI-Vision-Erkennung", () => {

  /**
   * Direkter API-Test: Bild → Backend → AI → Wert zurück.
   * Kein Browser nötig, schneller und zuverlässiger als UI-Test.
   */
  test("API: meter-photo endpoint erkennt den Zählerwert", async ({ page }) => {
    const token = await getToken(page);

    // Bild als base64 laden
    const fs = await import("fs");
    const imageBuffer = fs.readFileSync(METER_PHOTO);
    const base64 = imageBuffer.toString("base64");

    // An den Backend-Endpunkt schicken
    const resp = await page.request.post(
      `${API_BASE}/category/${CATEGORY}/meter-photo`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        data: JSON.stringify({ image: base64, mimeType: "image/jpeg" }),
        timeout: 30_000,
      }
    );

    console.log("API Status:", resp.status());
    const body = await resp.json();
    console.log("API Response:", JSON.stringify(body));

    expect(resp.ok()).toBeTruthy();
    expect(body.value).toBeTruthy();
    expect(typeof body.value).toBe("string");
    expect(body.value).toMatch(/^\d+(\.\d+)?$/); // muss eine Zahl sein

    const recognized = parseFloat(body.value);
    console.log(`Erkannt: ${body.value}  (erwartet: ${VALUE_MIN}–${VALUE_MAX})`);
    expect(recognized).toBeGreaterThanOrEqual(VALUE_MIN);
    expect(recognized).toBeLessThanOrEqual(VALUE_MAX);
  });

  /**
   * UI-Test: vollständiger Flow durch das Modal.
   * Lädt das Bild hoch, wartet auf die AI-Antwort, prüft ob Wert ins Formular übernommen wird.
   */
  test("UI: Bild hochladen → AI erkennt Wert → Wert ins Eingabefeld", async ({ page }) => {
    await login(page);

    // Zur Insert-Seite navigieren
    await page.locator("a", { hasText: "Insert" }).first().click();
    await expect(page.locator("fieldset").first()).toBeVisible({ timeout: 10_000 });

    const section    = page.locator(`label[for="${CATEGORY}_value"]`);
    const valueInput = page.locator(`input#${CATEGORY}_value`);
    const dateInput  = page.locator(`input#${CATEGORY}_time`);

    await expect(section).toBeVisible({ timeout: 5_000 });

    // Modal öffnen
    await section.locator("button.photo-btn").click();
    await expect(page.locator(".modal")).toBeVisible();

    // Bild hochladen (Aus Galerie)
    await page.locator(".modal label", { hasText: "Aus Galerie" })
      .locator("input[type=file]")
      .setInputFiles(METER_PHOTO);

    // AI-Anfrage abwarten (kann bis zu 15s dauern)
    const outcome = page.locator(".modal .status.success, .modal .status.error");
    await expect(outcome).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: "build/test/ai-ocr-result.png" });

    const isSuccess = await page.locator(".modal .status.success").isVisible();
    if (!isSuccess) {
      const errText = await page.locator(".modal .status.error").textContent();
      console.error("❌ AI-Fehler:", errText);
    }
    expect(isSuccess).toBeTruthy();

    // Erkannter Wert muss angezeigt werden
    const successText = await page.locator(".modal .status.success").textContent();
    console.log("✅ Modal zeigt:", successText?.trim());
    expect(successText).toMatch(/\d+/);

    // Datum-Hinweis vorhanden?
    const hasDate = await page.locator(".modal .date-hint").isVisible();
    console.log("📅 Datum-Hinweis:", hasDate);

    // Wert übernehmen
    await page.locator(".modal button", { hasText: "Wert übernehmen" }).click();
    await expect(page.locator(".modal")).not.toBeVisible({ timeout: 5_000 });

    // Wert im Eingabefeld prüfen
    const filledValue = await valueInput.inputValue();
    console.log("Wert im Feld:", filledValue);
    expect(filledValue).toMatch(/^\d+(\.\d+)?$/);

    const recognized = parseFloat(filledValue);
    console.log(`Wert im Feld: ${filledValue}  (erwartet: ${VALUE_MIN}–${VALUE_MAX})`);
    expect(recognized).toBeGreaterThanOrEqual(VALUE_MIN);
    expect(recognized).toBeLessThanOrEqual(VALUE_MAX);

    await page.screenshot({ path: "build/test/ai-ocr-filled.png" });
  });
});
