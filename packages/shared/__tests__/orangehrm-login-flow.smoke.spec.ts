import { expect, test } from '@playwright/test';
import { OrangeHRMLoginFlowPage } from '../../../tests/pages/OrangeHRMLoginFlowPage';

const ORANGEHRM_USERNAME = process.env.ORANGEHRM_USERNAME ?? 'Admin';
const ORANGEHRM_PASSWORD = process.env.ORANGEHRM_PASSWORD ?? 'admin123';
const ORANGEHRM_LOGIN_URL = 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login';

test('OrangeHRM smoke: login, open Admin, logout', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  page.setDefaultNavigationTimeout(60_000);

  const orangeHrM = new OrangeHRMLoginFlowPage(page, testInfo);

  await page.goto(ORANGEHRM_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/auth\/login$/);

  await orangeHrM.login(ORANGEHRM_USERNAME, ORANGEHRM_PASSWORD);
  await expect(page).toHaveURL(/\/dashboard\/index$/);

  await orangeHrM.clickAdminMenuItem();
  await expect(page).toHaveURL(/\/admin\/viewSystemUsers$/);

  await orangeHrM.inputAdminSearchUsername('Admin');

  await orangeHrM.clickUserRoleDropdown();
  await page.keyboard.press('Escape');

  await orangeHrM.inputAdminSearchEmployeeName('a');

  await orangeHrM.clickStatusDropdown();
  await page.keyboard.press('Escape');

  await orangeHrM.clickSearchButton();

  // This was a low-signal exploratory click in the recorded session. We still
  // execute it here so the smoke covers the full generated flow.
  await orangeHrM.clickAdminUserInTable();

  await orangeHrM.clickUserDropdown();
  await orangeHrM.clickLogoutMenuItem();
  await expect(page).toHaveURL(/\/auth\/login$/);
});
