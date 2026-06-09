import { expect, type Locator, type Page, test } from '@playwright/test';

const SESSION_ID = 'session-74d3c6cf-f2eb-41d7-b4a7-149981fee571';
const START_URL = 'https://www.redbus.in/';

const REDBUS_PHONE = process.env.REDBUS_PHONE ?? '9876543210';
const REDBUS_EMAIL = process.env.REDBUS_EMAIL ?? 'test.user@example.com';
const REDBUS_NAME = process.env.REDBUS_NAME ?? 'Test User';
const REDBUS_AGE = process.env.REDBUS_AGE ?? '28';

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
  test.setTimeout(120_000);
  page.setDefaultNavigationTimeout(60_000);

  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

  // AIR step 1
  // TODO[AIR step 1]: GenerationContext marked this selection unresolved.
  // Using the fallback role selector plus recorded option text exactly as AIR provided.
  await page.locator('[role="option"]').filter({ hasText: 'Visakhapatnam' }).click();

  // AIR step 2
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div[aria-label="Select Date of Journey. Current date: 08 Jun, 2026"]',
  }).click();

  // AIR step 3
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'ul[role="grid"] li[role="gridcell"]:has-text("18")',
  }).click();
  await expect(page).toHaveURL(
    'https://www.redbus.in/bus-tickets/hyderabad-to-visakhapatnam?fromCityName=Hyderabad&fromCityId=124&srcCountry=India&fromCityType=CITY&toCityName=Visakhapatnam&toCityId=248&destCountry=India&toCityType=CITY&onward=18-Jun-2026&doj=18-Jun-2026&ref=home&step=CI',
  );

  // AIR step 4
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'button[aria-label="View seats for Madesh Travels"]',
  }).click();

  // AIR step 5
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '#U3',
  }).click();

  // AIR step 6
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'button[aria-label="Select boarding & dropping points"]',
  }).click();

  // AIR step 7
  // TODO[AIR step 7]: GenerationContext marked this selector unresolved and only
  // preserved a dynamic class fallback.
  await page.locator('.customRadio___60b9a1').click();

  // AIR step 8
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'input[name="Phone *"]',
  }).fill(REDBUS_PHONE);

  // AIR step 9
  // TODO[AIR step 9]: GenerationContext marked this selector unresolved and only
  // preserved a dynamic class fallback plus the recorded "Email ID" text.
  await page.locator('.textField___82b846').filter({ hasText: 'Email ID' }).click();

  // AIR step 10
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'input[name="Phone *"]',
  }).click();

  // AIR step 11
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'input[name="0_5"]',
  }).fill(REDBUS_EMAIL);

  // AIR step 12
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div[aria-label="State of Residence"]',
  }).click();

  // AIR step 13
  // TODO[AIR step 13]: GenerationContext marked this selector unresolved and only
  // preserved a dynamic class fallback plus the recorded "Telangana" text.
  await page.locator('.listHeader___7e332f').filter({ hasText: 'Telangana' }).click();

  // AIR step 14
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'input[name="0_4"]',
  }).fill(REDBUS_NAME);

  // AIR step 15
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'input[name="1_1"]',
  }).fill(REDBUS_AGE);

  // AIR step 16
  await locatorFromResolvedTarget(page, {
    kind: 'xpath',
    value: '//div[normalize-space(.)="Male"]',
  }).click();

  // AIR step 17
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'button[aria-label="Continue booking, Amount ₹2,489, (Tax excluded)"]',
  }).click();

  // AIR step 18
  // TODO[AIR step 18]: AIR resolved this to a low-confidence legacy-primary
  // dynamic class selector. Preserving it exactly as recorded.
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: '.inputError___400f1c',
  }).click();

  // AIR step 19
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'input[name="Phone *"]',
  }).fill(REDBUS_PHONE);

  // AIR step 20
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.custInfoMainWrapper__ind-custInfo-styles-module-scss-q077z',
  }).click();

  // AIR step 21
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'button[aria-label="Continue booking, Amount ₹2,489, (Tax excluded)"]',
  }).click();

  // AIR step 22
  await locatorFromResolvedTarget(page, {
    kind: 'css',
    value: 'div.custInfoHeader__ind-custInfo-styles-module-scss-TRdC-',
  }).click();
});
