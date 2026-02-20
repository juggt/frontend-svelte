import { Selector } from "testcafe";
import { base, login, clickLink, navigateToAddCategory } from "./helpers/util.mjs";

fixture`Getting Started`.page`${base}`;

const category = "CAT2";

test("category add list remove", async t => {
  await t.navigateTo(base);
  await login(t);
  await navigateToAddCategory(t);

  await t.takeScreenshot({
    path: "category_add_list_remove.png"
  });

  await t
    .typeText("#name", category, { replace: true })
    .typeText("#description", "mains power 2", { replace: true })
    .typeText("#unit", "kWh", { replace: true })
    .click("button");

  await clickLink(t, "/category");
  await t.takeScreenshot({
    path: "category_add_list_remove_overview_after_add.png"
  });

  await clickLink(t, `/category/${category}`);
  await t.takeScreenshot({
    path: "category_add_list_remove_added_category.png"
  });

  await t.setNativeDialogHandler(() => true);

  await t.click(Selector("button").withText("Delete"));

  await clickLink(t, "/category");
  await t.takeScreenshot({
    path: "category_add_list_remove_overview_after_delete.png"
  });
});

test("category add forbidden", async t => {
  const category = "CAT3";

  await t.navigateTo(base);
  await login(t, { user: "user2", password: "secret" });
  await navigateToAddCategory(t);

  await t
    .typeText("#name", category, { replace: true })
    .typeText("#description", "mains power 3", { replace: true })
    .typeText("#unit", "kWh", { replace: true });

  await t.expect(Selector("button").withAttribute("disabled").exists).ok();

  await t.takeScreenshot({
    path: "category_add_forbidden.png"
  });
});

test("category add save button enables when form valid", async t => {
  // Test for the Svelte 5 reactivity bug: save button should enable when all fields are filled
  const category = `CAT_${Date.now()}`;

  // Start at base, login, then navigate to add category
  await t.navigateTo(base);
  await login(t);
  await t.navigateTo(`${base}/category/add`);
  await waitForForm(t);

  // Initially, save button should be disabled (form invalid)
  const saveButton = Selector("button").withText("Save");
  await t.expect(saveButton.hasAttribute("disabled")).ok();

  // Fill all required fields
  await t
    .typeText("#name", category, { replace: true })
    .typeText("#description", "Test category for save button", { replace: true })
    .typeText("#unit", "kWh", { replace: true })
    .typeText("#fractionalDigits", "2", { replace: true });

  // After filling, save button should be enabled (this was the bug: it stayed disabled)
  await t.expect(saveButton.hasAttribute("disabled")).notOk();

  await t.takeScreenshot({
    path: "category_add_save_button_enabled.png"
  });

  // Submit and verify it works
  await t.click(saveButton);

  // Navigate to list and verify category was created
  await clickLink(t, "/category");
  await t.expect(Selector("a").withText(category).exists).ok({ timeout: 8000 });

  // Cleanup: delete the test category
  await clickLink(t, `/category/${category}`);
  await t.setNativeDialogHandler(() => true);
  await t.click(Selector("button").withText("Delete"));

  await clickLink(t, "/category");
  await t.expect(Selector("a").withText(category).exists).notOk({ timeout: 5000 });

  await t.takeScreenshot({
    path: "category_add_save_button_cleanup_done.png"
  });
});
