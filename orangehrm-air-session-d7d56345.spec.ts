import { expect, type Locator, type Page, test } from '@playwright/test';

const SESSION_ID = 'session-d7d56345-be92-4679-88dc-b0e8d27b6ddd';
const START_URL = 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login';

const ORANGEHRM_USERNAME = process.env.ORANGEHRM_USERNAME ?? 'Admin';
const ORANGEHRM_PASSWORD = process.env.ORANGEHRM_PASSWORD ?? 'admin123';
const ORANGEHRM_SEARCH_USERNAME = process.env.ORANGEHRM_SEARCH_USERNAME ?? ORANGEHRM_USERNAME;

type ResolvedTarget = {
  kind: 'css' | 'xpath';
  value: string;
};

function locatorFromResolvedTarget(page: Page, target: ResolvedTarget): Locator {
  if (target.kind === 'xpath') {
    return page.locator(`xpath=${target.value}`);
  }

  return page.locator(target.value);
}

test(`AIR session replay: ${SESSION_ID}`, async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultNavigationTimeout(60_000);

  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

  // AIR step 1
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'input[name="username"]',
  }).fill(ORANGEHRM_USERNAME);

  // AIR step 2
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'input[name="password"]',
  }).fill(ORANGEHRM_PASSWORD);

  // AIR step 3
  // TODO[AIR step 3]: GenerationContext marked this action unresolved.
  // Using fallbackHints.legacySelector exactly as provided by AIR.
  await page.locator('button[type="submit"]').click();

  // AIR step 4
  // TODO[AIR duplicate login click]: AIR records a second Login click from the
  // login page even though step 3 is already marked as the navigation trigger.
  // Preserve the recorded order without inventing recovery logic.
  const secondLoginButton = locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'button:has-text("Login")',
  });
  if (await secondLoginButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await secondLoginButton.click();
  }

  // TODO[AIR assertion mismatch]: steps 3 and 4 assert
  // /admin/viewSystemUsers, but step 5 starts from /dashboard/index and the
  // live app lands on the dashboard first after login.
  await expect(page).toHaveURL('https://opensource-demo.orangehrmlive.com/web/index.php/dashboard/index');

  // AIR step 5
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'a[href="/web/index.php/admin/viewAdminModule"]',
  }).click();
  await expect(page).toHaveURL(
    'https://opensource-demo.orangehrmlive.com/web/index.php/admin/viewSystemUsers',
  );

  // AIR step 6
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("Username") input.oxd-input',
  }).fill(ORANGEHRM_SEARCH_USERNAME);

  // AIR step 7
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("User Role") div.oxd-select-text-input',
  }).click();

  // AIR step 8
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div[role="listbox"] div[role="option"]:has-text("ESS")',
  }).click();

  // AIR step 9
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("Status") div.oxd-select-text-input',
  }).click();

  // AIR step 10
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div[role="listbox"] div[role="option"]:has-text("Enabled")',
  }).click();

  // AIR step 11
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.orangehrm-background-container',
  }).click();

  // AIR step 12
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'button:has-text("Search")',
  }).click();

  // AIR step 13
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'span.oxd-userdropdown-tab',
  }).click();

  // AIR step 14
  const logoutMenuItem = locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'a[href="/web/index.php/auth/logout"]',
  });

  await expect(logoutMenuItem).toBeVisible({ timeout: 5_000 });
  await logoutMenuItem.click();

  await expect(page).toHaveURL('https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');
  await expect(page.locator('button:has-text("Login")')).toBeVisible();
  await expect(page.locator('[name="password"]')).toBeVisible();
  await expect(page.locator('[name="username"]')).toBeVisible();
});
