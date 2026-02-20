import { Selector } from "testcafe";

export const base = "http://localhost:5173/services/konsum";

export async function login(t, data = { user: "user1", password: "secret" }) {
  const passwordField = Selector("#password");
  const usernameField = Selector("#username");
  
  // Check if we're already logged in (no login form visible)
  if (!(await passwordField.exists) && !(await usernameField.exists)) {
    return; // Already logged in
  }
  
  // Fill in login form
  await t
    .typeText("#username", data.user, { replace: true })
    .typeText("#password", data.password, { replace: true })
    .click("button[type=submit]");
  
  // Wait for login to complete (login form disappears)
  await t.expect(passwordField.exists).notOk({ timeout: 10000 });
}

export async function clickLink(t, href) {
  const a = Selector("a").withAttribute("href", href);
  await t.click(a);
}

export async function navigateToAddCategory(t) {
  // Navigate via SPA to avoid losing session on hard reload
  // First go to Categories list
  await clickLink(t, "/category");
  await t.expect(Selector("table").exists).ok({ timeout: 8000 });
  
  // Click "New Category" link
  const newCatLink = Selector("a").withText("New Category");
  await t.expect(newCatLink.exists).ok({ timeout: 5000 });
  await t.click(newCatLink);
  
  // Wait for form to be visible
  await t.expect(Selector("#name").exists).ok({ timeout: 5000 });
}

export async function waitForForm(t) {
  // Wait for form to be visible
  await t.expect(Selector("#name").exists).ok({ timeout: 5000 });
}

export const findElementByTrimmedText = Selector((baseCSSSelector, text) => {
  const el = document.querySelector(baseCSSSelector);
  const trimmedText = el && el.innerText && el.innerText.trim();
  return trimmedText === text ? el : null;
});
