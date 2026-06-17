import { expect, type Locator, type Page, test } from '@playwright/test';

const SESSION_ID = 'session-a6aa8562-cb8c-443e-8771-a66e962cb035';
const START_URL = 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login';

const ORANGEHRM_USERNAME = process.env.ORANGEHRM_USERNAME ?? 'Admin';
const ORANGEHRM_PASSWORD = process.env.ORANGEHRM_PASSWORD ?? 'admin123';
const ORANGEHRM_EMPLOYEE_SEARCH = process.env.ORANGEHRM_EMPLOYEE_SEARCH ?? 'Beth';
const ORANGEHRM_EDIT_USERNAME = process.env.ORANGEHRM_EDIT_USERNAME ?? `airuser${Date.now()}`;

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
  // TODO[AIR step 2]: GenerationContext marked this action unresolved.
  // Using fallbackHints.legacySelector exactly as provided by AIR.
  await page.locator('input[name="password"]').fill(ORANGEHRM_PASSWORD);

  // AIR step 3
  // TODO[AIR step 3]: GenerationContext marked this action unresolved.
  // Using fallbackHints.legacySelector exactly as provided by AIR.
  await page.locator('button[type="submit"]').click();
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
    value: 'input[placeholder="Type for hints..."]',
  }).fill(ORANGEHRM_EMPLOYEE_SEARCH);

  // AIR step 6
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'form.oxd-form',
  }).click();

  // AIR step 7
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("Employee Name") input[placeholder="Type for hints..."]',
  }).fill(ORANGEHRM_EMPLOYEE_SEARCH);

  // AIR step 8
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-table-filter',
  }).click();

  // AIR step 9
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'button:has-text("Search")',
  }).click();

  // AIR step 10
  await locatorFromResolvedTarget(page, {
    kind: 'xpath',
    value:
      '(//*[(self::table or @role="table" or @role="grid") and @role="table" and contains(concat(" ", normalize-space(@class), " "), " oxd-table ")]//*[@role="row"][.//*[contains(normalize-space(.), "Admin")]]//button[contains(concat(" ", normalize-space(@class), " "), " oxd-icon-button ")])[2]',
  }).click();
  await expect(page).toHaveURL('https://opensource-demo.orangehrmlive.com/web/index.php/admin/saveSystemUser/1');
  await expect(page.locator('button:has-text("Cancel")')).toBeVisible();
  await expect(page.locator('button:has-text("Save")')).toBeVisible();

  // AIR step 11
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("Employee Name") input[placeholder="Type for hints..."]',
  }).fill(ORANGEHRM_EMPLOYEE_SEARCH);

  // AIR step 12
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'form.oxd-form',
  }).click();

  // AIR step 13
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("Employee Name") input[placeholder="Type for hints..."]',
  }).fill(ORANGEHRM_EMPLOYEE_SEARCH);

  // AIR step 14
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("Username") input.oxd-input',
  }).click();

  // AIR step 15
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("Employee Name") input[placeholder="Type for hints..."]',
  }).fill(ORANGEHRM_EMPLOYEE_SEARCH);

  // AIR step 16
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-form-actions',
  }).click();

  // AIR step 17
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("Employee Name") input[placeholder="Type for hints..."]',
  }).fill(ORANGEHRM_EMPLOYEE_SEARCH);

  // AIR step 18
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div[role="listbox"] div[role="option"]:has-text("Beth Patrick Simmons")',
  }).click();

  // AIR step 19
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.oxd-input-group:has-text("Username") input.oxd-input',
  }).fill(ORANGEHRM_EDIT_USERNAME);

  // AIR step 20
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'button:has-text("Save")',
  }).click();
  await expect(page).toHaveURL(
    'https://opensource-demo.orangehrmlive.com/web/index.php/admin/viewSystemUsers',
  );

  // AIR step 21
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'span.oxd-userdropdown-tab',
  }).click();

  // AIR step 22
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'a[href="/web/index.php/auth/logout"]',
  }).click();
  await expect(page).toHaveURL('https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');
  await expect(page.locator('button:has-text("Login")')).toBeVisible();
  await expect(page.locator('[name="password"]')).toBeVisible();
  await expect(page.locator('[name="username"]')).toBeVisible();
});
