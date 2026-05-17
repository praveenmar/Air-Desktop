# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: packages\shared\__tests__\orangehrm-login-flow.smoke.spec.ts >> OrangeHRM smoke: login, open Admin, logout
- Location: packages\shared\__tests__\orangehrm-login-flow.smoke.spec.ts:8:5

# Error details

```
TypeError: orangeHrM.clickAdminMenuItem is not a function
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { OrangeHRMLoginFlowPage } from '../../../tests/pages/OrangeHRMLoginFlowPage';
  3  | 
  4  | const ORANGEHRM_USERNAME = process.env.ORANGEHRM_USERNAME ?? 'Admin';
  5  | const ORANGEHRM_PASSWORD = process.env.ORANGEHRM_PASSWORD ?? 'admin123';
  6  | const ORANGEHRM_LOGIN_URL = 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login';
  7  | 
  8  | test('OrangeHRM smoke: login, open Admin, logout', async ({ page }, testInfo) => {
  9  |   test.setTimeout(90_000);
  10 |   page.setDefaultNavigationTimeout(60_000);
  11 | 
  12 |   const orangeHrM = new OrangeHRMLoginFlowPage(page, testInfo);
  13 | 
  14 |   await page.goto(ORANGEHRM_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  15 |   await expect(page).toHaveURL(/\/auth\/login$/);
  16 | 
  17 |   await orangeHrM.login(ORANGEHRM_USERNAME, ORANGEHRM_PASSWORD);
  18 |   await expect(page).toHaveURL(/\/dashboard\/index$/);
  19 | 
> 20 |   await orangeHrM.clickAdminMenuItem();
     |                   ^ TypeError: orangeHrM.clickAdminMenuItem is not a function
  21 |   await expect(page).toHaveURL(/\/admin\/viewSystemUsers$/);
  22 | 
  23 |   await orangeHrM.inputAdminSearchUsername('Admin');
  24 | 
  25 |   await orangeHrM.clickUserRoleDropdown();
  26 |   await page.keyboard.press('Escape');
  27 | 
  28 |   await orangeHrM.inputAdminSearchEmployeeName('a');
  29 | 
  30 |   await orangeHrM.clickStatusDropdown();
  31 |   await page.keyboard.press('Escape');
  32 | 
  33 |   await orangeHrM.clickSearchButton();
  34 | 
  35 |   // This was a low-signal exploratory click in the recorded session. We still
  36 |   // execute it here so the smoke covers the full generated flow.
  37 |   await orangeHrM.clickAdminUserInTable();
  38 | 
  39 |   await orangeHrM.clickUserDropdown();
  40 |   await orangeHrM.clickLogoutMenuItem();
  41 |   await expect(page).toHaveURL(/\/auth\/login$/);
  42 | });
  43 | 
```