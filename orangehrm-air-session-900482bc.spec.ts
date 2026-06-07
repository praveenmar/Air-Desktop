import { expect, type Locator, type Page, test } from '@playwright/test';

const SESSION_ID = 'session-900482bc-95ca-478c-8400-86e935c5c398';
const START_URL = 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login';

const ORANGEHRM_USERNAME = process.env.ORANGEHRM_USERNAME ?? 'Admin';
const ORANGEHRM_PASSWORD = process.env.ORANGEHRM_PASSWORD ?? 'admin123';
const ORANGEHRM_SEARCH_USERNAME = process.env.ORANGEHRM_SEARCH_USERNAME ?? ORANGEHRM_USERNAME;
const ORANGEHRM_EMPLOYEE_NAME = process.env.ORANGEHRM_EMPLOYEE_NAME ?? 'Manas Mishra';

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
  // TODO[AIR assertion mismatch]: step 3's assertion points to
  // /admin/viewSystemUsers, but step 4 starts from /dashboard/index and the
  // live app lands on the dashboard after login.
  await expect(page).toHaveURL('https://opensource-demo.orangehrmlive.com/web/index.php/dashboard/index');

  // AIR step 4
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'a[href="/web/index.php/admin/viewAdminModule"]',
  }).click();
  await expect(page).toHaveURL(
    'https://opensource-demo.orangehrmlive.com/web/index.php/admin/viewSystemUsers',
  );

  // AIR step 5
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("Username") input.oxd-input',
  }).fill(ORANGEHRM_SEARCH_USERNAME);

  // AIR step 6
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("User Role") div.oxd-select-text-input',
  }).click();

  // AIR step 7
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div[role="listbox"] div[role="option"]:has-text("Admin")',
  }).click();

  // AIR step 10
  // TODO[AIR inferred gap]: AIR recorded selecting "Enabled" but did not provide
  // a preceding Status dropdown-open action. This test intentionally does not
  // invent one, per GenerationContext-only replay rules.
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div[role="listbox"] div[role="option"]:has-text("Enabled")',
  }).click();

  // AIR step 11
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'button:has-text("Search")',
  }).click();

  // AIR step 12
  // TODO[AIR inferred gap]: AIR recorded choosing "Logout" but did not provide
  // the user-menu-open action that may be required before this menu item exists.
  const logoutMenuItem = locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'a[href="/web/index.php/auth/logout"]',
  });

  await expect(
    logoutMenuItem,
    'AIR inferred gap: step 12 targets the Logout menu item directly, but no menu-open action was recorded.',
  ).toBeVisible({ timeout: 5_000 });
  await logoutMenuItem.click();

  await expect(page).toHaveURL('https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');
  await expect(page.locator('button:has-text("Login")')).toBeVisible();
  await expect(page.locator('[name="password"]')).toBeVisible();
  await expect(page.locator('[name="username"]')).toBeVisible();
});
