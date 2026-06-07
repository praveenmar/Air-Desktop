import { expect, type Locator, type Page, test } from '@playwright/test';

const SESSION_ID = 'session-2777fa0d-e512-4cce-9792-821683409464';
const START_URL = 'https://www.saucedemo.com/';

const SAUCEDEMO_USERNAME = process.env.SAUCEDEMO_USERNAME ?? 'standard_user';
const SAUCEDEMO_PASSWORD = process.env.SAUCEDEMO_PASSWORD ?? 'secret_sauce';
const SAUCEDEMO_FIRST_NAME = process.env.SAUCEDEMO_FIRST_NAME ?? 'Test';
const SAUCEDEMO_LAST_NAME = process.env.SAUCEDEMO_LAST_NAME ?? 'User';
const SAUCEDEMO_POSTAL_CODE = process.env.SAUCEDEMO_POSTAL_CODE ?? '12345';

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
    value: '#user-name',
  }).fill(SAUCEDEMO_USERNAME);

  // AIR step 2
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#password',
  }).fill(SAUCEDEMO_PASSWORD);

  // AIR step 3
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#login-button',
  }).click();
  await expect(page).toHaveURL('https://www.saucedemo.com/inventory.html');
  await expect(page.locator('#add-to-cart-sauce-labs-backpack')).toBeVisible();
  await expect(page.locator('#add-to-cart-sauce-labs-bike-light')).toBeVisible();

  // AIR step 4
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#add-to-cart-sauce-labs-backpack',
  }).click();

  // AIR step 5
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#add-to-cart-sauce-labs-bike-light',
  }).click();

  // AIR step 6
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#item_5_title_link',
  }).click();
  // TODO[AIR assertion mismatch]: this step clicks #item_5_title_link and the
  // following AIR steps continue on inventory-item.html?id=5, but the recorded
  // AIR assertion for step 6 says inventory-item.html?id=3.
  await expect(page).toHaveURL('https://www.saucedemo.com/inventory-item.html?id=5');
  await expect(page.locator('#add-to-cart')).toBeVisible();

  // AIR step 7
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#add-to-cart',
  }).click();

  // AIR step 8
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'a.shopping_cart_link',
  }).click();
  await expect(page).toHaveURL('https://www.saucedemo.com/cart.html');

  // AIR step 9
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#checkout',
  }).click();
  await expect(page).toHaveURL('https://www.saucedemo.com/checkout-step-one.html');
  await expect(page.locator('#continue')).toBeVisible();
  await expect(page.locator('#first-name')).toBeVisible();
  await expect(page.locator('#last-name')).toBeVisible();
  await expect(page.locator('#postal-code')).toBeVisible();

  // AIR step 10
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#first-name',
  }).fill(SAUCEDEMO_FIRST_NAME);

  // AIR step 11
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#last-name',
  }).fill(SAUCEDEMO_LAST_NAME);

  // AIR step 12
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#postal-code',
  }).fill(SAUCEDEMO_POSTAL_CODE);

  // AIR step 13
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#continue',
  }).click();
  await expect(page).toHaveURL('https://www.saucedemo.com/checkout-step-two.html');
  await expect(page.locator('#finish')).toBeVisible();

  // AIR step 14
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#finish',
  }).click();
  await expect(page).toHaveURL('https://www.saucedemo.com/checkout-complete.html');
  await expect(page.locator('h2:has-text("Thank you for your order!")')).toBeVisible();

  // AIR step 15
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.header_secondary_container',
  }).click();
});
