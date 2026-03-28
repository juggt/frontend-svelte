import { test, expect } from "@playwright/test";
import { login, BASE } from "./helpers.mjs";

/**
 * Tests that a logged-in session survives a full page reload.
 *
 * The root cause was: `session.isValid` checks `expirationTimer !== undefined`.
 * After a page reload the timer is gone (memory cleared), but `access_token`
 * is still in localStorage. Without calling `session.update()` with a
 * `token_type` field the session stays in "invalid" state and the user gets
 * kicked to /login.
 *
 * Fix in App.svelte: re-hydrate the session on startup if access_token is
 * present but isValid is false, by calling session.update() with token_type.
 */
test.describe("Session persistence after page reload", () => {
  test("stays logged in after a hard reload on the home page", async ({
    page,
  }) => {
    await login(page);

    // Verify we are logged in: username visible in navbar
    await expect(page.locator(".dropdown-trigger")).toBeVisible({
      timeout: 8_000,
    });

    // Hard reload (browser F5)
    await page.reload({ waitUntil: "networkidle" });

    // Must still be logged in — username still in navbar, NOT the Login link
    await expect(page.locator(".dropdown-trigger")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.locator("a", { hasText: "Login" })).not.toBeVisible();
  });

  test("stays logged in after a hard reload on a protected route", async ({
    page,
  }) => {
    await login(page);

    // Navigate to Categories (protected)
    await page.locator("a", { hasText: "Categories" }).first().click();
    await expect(page.locator("table")).toBeVisible({ timeout: 8_000 });

    // Hard reload while on the protected route
    await page.reload({ waitUntil: "networkidle" });

    // Should still show the categories table, NOT be redirected to /login
    await expect(page.locator("table")).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(".dropdown-trigger")).toBeVisible();
    await expect(page.locator("a", { hasText: "Login" })).not.toBeVisible();
  });

  test("does NOT stay logged in after explicit logout then reload", async ({
    page,
  }) => {
    await login(page);

    // Logout by clearing localStorage directly (simulates session.invalidate())
    await page.evaluate(() => {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("username");
    });

    // Reload
    await page.reload({ waitUntil: "networkidle" });

    // Should NOT be logged in anymore
    await expect(page.locator("a", { hasText: "Login" })).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.locator(".dropdown-trigger")).not.toBeVisible();
  });
});
