# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: orangehrm-air-session-900482bc.spec.ts >> AIR session replay: session-900482bc-95ca-478c-8400-86e935c5c398
- Location: orangehrm-air-session-900482bc.spec.ts:24:5

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: locator.click: Test timeout of 90000ms exceeded.
Call log:
  - waiting for locator('a[href="/web/index.php/auth/logout"]')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic:
    - complementary [ref=e4]:
      - navigation "Sidepanel" [ref=e5]:
        - generic [ref=e6]:
          - link "client brand banner" [ref=e7] [cursor=pointer]:
            - /url: https://www.orangehrm.com/
            - img "client brand banner" [ref=e9]
          - text: 
        - generic [ref=e10]:
          - generic [ref=e11]:
            - generic [ref=e12]:
              - textbox "Search" [ref=e15]
              - button "" [ref=e16] [cursor=pointer]:
                - generic [ref=e17]: 
            - separator [ref=e18]
          - list [ref=e19]:
            - listitem [ref=e20]:
              - link "Admin" [ref=e21] [cursor=pointer]:
                - /url: /web/index.php/admin/viewAdminModule
                - generic [ref=e24]: Admin
            - listitem [ref=e25]:
              - link "PIM" [ref=e26] [cursor=pointer]:
                - /url: /web/index.php/pim/viewPimModule
                - generic [ref=e40]: PIM
            - listitem [ref=e41]:
              - link "Leave" [ref=e42] [cursor=pointer]:
                - /url: /web/index.php/leave/viewLeaveModule
                - generic [ref=e45]: Leave
            - listitem [ref=e46]:
              - link "Time" [ref=e47] [cursor=pointer]:
                - /url: /web/index.php/time/viewTimeModule
                - generic [ref=e53]: Time
            - listitem [ref=e54]:
              - link "Recruitment" [ref=e55] [cursor=pointer]:
                - /url: /web/index.php/recruitment/viewRecruitmentModule
                - generic [ref=e61]: Recruitment
            - listitem [ref=e62]:
              - link "My Info" [ref=e63] [cursor=pointer]:
                - /url: /web/index.php/pim/viewMyDetails
                - generic [ref=e69]: My Info
            - listitem [ref=e70]:
              - link "Performance" [ref=e71] [cursor=pointer]:
                - /url: /web/index.php/performance/viewPerformanceModule
                - generic [ref=e79]: Performance
            - listitem [ref=e80]:
              - link "Dashboard" [ref=e81] [cursor=pointer]:
                - /url: /web/index.php/dashboard/index
                - generic [ref=e84]: Dashboard
            - listitem [ref=e85]:
              - link "Directory" [ref=e86] [cursor=pointer]:
                - /url: /web/index.php/directory/viewDirectory
                - generic [ref=e89]: Directory
            - listitem [ref=e90]:
              - link "Maintenance" [ref=e91] [cursor=pointer]:
                - /url: /web/index.php/maintenance/viewMaintenanceModule
                - generic [ref=e95]: Maintenance
            - listitem [ref=e96]:
              - link "Claim" [ref=e97] [cursor=pointer]:
                - /url: /web/index.php/claim/viewClaimModule
                - img [ref=e100]
                - generic [ref=e104]: Claim
            - listitem [ref=e105]:
              - link "Buzz" [ref=e106] [cursor=pointer]:
                - /url: /web/index.php/buzz/viewBuzz
                - generic [ref=e109]: Buzz
    - banner [ref=e110]:
      - generic [ref=e111]:
        - generic [ref=e112]:
          - text: 
          - generic [ref=e113]:
            - heading "Admin" [level=6] [ref=e114]
            - heading "/ User Management" [level=6] [ref=e115]
        - link "Upgrade" [ref=e117]:
          - /url: https://orangehrm.com/open-source/upgrade-to-advanced
          - button "Upgrade" [ref=e118] [cursor=pointer]: Upgrade
        - list [ref=e124]:
          - listitem [ref=e125]:
            - generic [ref=e126] [cursor=pointer]:
              - img "profile picture" [ref=e127]
              - paragraph [ref=e128]: Ronald Steele
              - generic [ref=e129]: 
      - navigation "Topbar Menu" [ref=e131]:
        - list [ref=e132]:
          - listitem [ref=e133] [cursor=pointer]:
            - generic [ref=e134]:
              - text: User Management
              - generic [ref=e135]: 
          - listitem [ref=e136] [cursor=pointer]:
            - generic [ref=e137]:
              - text: Job
              - generic [ref=e138]: 
          - listitem [ref=e139] [cursor=pointer]:
            - generic [ref=e140]:
              - text: Organization
              - generic [ref=e141]: 
          - listitem [ref=e142] [cursor=pointer]:
            - generic [ref=e143]:
              - text: Qualifications
              - generic [ref=e144]: 
          - listitem [ref=e145] [cursor=pointer]:
            - link "Nationalities" [ref=e146]:
              - /url: "#"
          - listitem [ref=e147] [cursor=pointer]:
            - link "Corporate Branding" [ref=e148]:
              - /url: "#"
          - listitem [ref=e149] [cursor=pointer]:
            - generic [ref=e150]:
              - text: Configuration
              - generic [ref=e151]: 
          - button "" [ref=e153] [cursor=pointer]:
            - generic [ref=e154]: 
  - generic [ref=e155]:
    - generic [ref=e157]:
      - generic [ref=e158]:
        - generic [ref=e159]:
          - heading "System Users" [level=5] [ref=e161]
          - button "" [ref=e164] [cursor=pointer]:
            - generic [ref=e165]: 
        - separator [ref=e166]
        - generic [ref=e168]:
          - generic [ref=e170]:
            - generic [ref=e172]:
              - generic [ref=e174]: Username
              - textbox [ref=e176]: Admin
            - generic [ref=e178]:
              - generic [ref=e180]: User Role
              - generic [ref=e183] [cursor=pointer]:
                - generic [ref=e184]: Admin
                - generic [ref=e186]: 
            - generic [ref=e188]:
              - generic [ref=e190]: Employee Name
              - textbox "Type for hints..." [ref=e194]
            - generic [ref=e196]:
              - generic [ref=e198]: Status
              - generic [ref=e201] [cursor=pointer]:
                - generic [ref=e202]: Enabled
                - generic [ref=e204]: 
          - separator [ref=e205]
          - generic [ref=e206]:
            - button "Reset" [ref=e207] [cursor=pointer]
            - button "Search" [active] [ref=e208] [cursor=pointer]
      - generic [ref=e209]:
        - button " Add" [ref=e211] [cursor=pointer]:
          - generic [ref=e212]: 
          - text: Add
        - generic [ref=e213]:
          - separator [ref=e214]
          - generic [ref=e216]: (1) Record Found
        - table [ref=e218]:
          - rowgroup [ref=e219]:
            - row " Username  User Role  Employee Name  Status  Actions" [ref=e220]:
              - columnheader "" [ref=e221]:
                - generic [ref=e223] [cursor=pointer]:
                  - checkbox "" [ref=e224]
                  - generic [ref=e226]: 
              - columnheader "Username " [ref=e227]:
                - text: Username
                - generic [ref=e228]:
                  - generic [ref=e229] [cursor=pointer]: 
                  - text:  
              - columnheader "User Role " [ref=e230]:
                - text: User Role
                - generic [ref=e231]:
                  - generic [ref=e232] [cursor=pointer]: 
                  - text:  
              - columnheader "Employee Name " [ref=e233]:
                - text: Employee Name
                - generic [ref=e234]:
                  - generic [ref=e235] [cursor=pointer]: 
                  - text:  
              - columnheader "Status " [ref=e236]:
                - text: Status
                - generic [ref=e237]:
                  - generic [ref=e238] [cursor=pointer]: 
                  - text:  
              - columnheader "Actions" [ref=e239]
          - rowgroup [ref=e240]:
            - row " Admin Admin Ronald Steele Enabled  " [ref=e242]:
              - cell "" [ref=e243]:
                - generic [ref=e247]:
                  - checkbox "" [ref=e248]
                  - generic [ref=e250]: 
              - cell "Admin" [ref=e251]:
                - generic [ref=e252]: Admin
              - cell "Admin" [ref=e253]:
                - generic [ref=e254]: Admin
              - cell "Ronald Steele" [ref=e255]:
                - generic [ref=e256]: Ronald Steele
              - cell "Enabled" [ref=e257]:
                - generic [ref=e258]: Enabled
              - cell " " [ref=e259]:
                - generic [ref=e260]:
                  - button "" [ref=e261] [cursor=pointer]:
                    - generic [ref=e262]: 
                  - button "" [ref=e263] [cursor=pointer]:
                    - generic [ref=e264]: 
    - generic [ref=e266]:
      - paragraph [ref=e267]: OrangeHRM OS 5.8
      - paragraph [ref=e268]:
        - text: © 2005 - 2026
        - link "OrangeHRM, Inc" [ref=e269] [cursor=pointer]:
          - /url: http://www.orangehrm.com
        - text: . All rights reserved.
```

# Test source

```ts
  1   | import { expect, type Locator, type Page, test } from '@playwright/test';
  2   | 
  3   | const SESSION_ID = 'session-900482bc-95ca-478c-8400-86e935c5c398';
  4   | const START_URL = 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login';
  5   | 
  6   | const ORANGEHRM_USERNAME = process.env.ORANGEHRM_USERNAME ?? 'Admin';
  7   | const ORANGEHRM_PASSWORD = process.env.ORANGEHRM_PASSWORD ?? 'admin123';
  8   | const ORANGEHRM_SEARCH_USERNAME = process.env.ORANGEHRM_SEARCH_USERNAME ?? ORANGEHRM_USERNAME;
  9   | const ORANGEHRM_EMPLOYEE_NAME = process.env.ORANGEHRM_EMPLOYEE_NAME ?? 'Manas Mishra';
  10  | 
  11  | type ResolvedTarget = {
  12  |   kind: 'css' | 'xpath';
  13  |   value: string;
  14  | };
  15  | 
  16  | function locatorFromResolvedTarget(page: Page, target: ResolvedTarget): Locator {
  17  |   if (target.kind === 'xpath') {
  18  |     return page.locator(`xpath=${target.value}`);
  19  |   }
  20  | 
  21  |   return page.locator(target.value);
  22  | }
  23  | 
  24  | test(`AIR session replay: ${SESSION_ID}`, async ({ page }) => {
  25  |   test.setTimeout(90_000);
  26  |   page.setDefaultNavigationTimeout(60_000);
  27  | 
  28  |   await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  29  | 
  30  |   // AIR step 1
  31  |   await locatorFromResolvedTarget(page, {
  32  |     kind: 'css',
  33  |     value: 'input[name="username"]',
  34  |   }).fill(ORANGEHRM_USERNAME);
  35  | 
  36  |   // AIR step 2
  37  |   await locatorFromResolvedTarget(page, {
  38  |     kind: 'css',
  39  |     value: 'input[name="password"]',
  40  |   }).fill(ORANGEHRM_PASSWORD);
  41  | 
  42  |   // AIR step 3
  43  |   // TODO[AIR step 3]: GenerationContext marked this action unresolved.
  44  |   // Using fallbackHints.legacySelector exactly as provided by AIR.
  45  |   await page.locator('button[type="submit"]').click();
  46  |   // TODO[AIR assertion mismatch]: step 3's assertion points to
  47  |   // /admin/viewSystemUsers, but step 4 starts from /dashboard/index and the
  48  |   // live app lands on the dashboard after login.
  49  |   await expect(page).toHaveURL('https://opensource-demo.orangehrmlive.com/web/index.php/dashboard/index');
  50  | 
  51  |   // AIR step 4
  52  |   await locatorFromResolvedTarget(page, {
  53  |     kind: 'css',
  54  |     value: 'a[href="/web/index.php/admin/viewAdminModule"]',
  55  |   }).click();
  56  |   await expect(page).toHaveURL(
  57  |     'https://opensource-demo.orangehrmlive.com/web/index.php/admin/viewSystemUsers',
  58  |   );
  59  | 
  60  |   // AIR step 5
  61  |   await locatorFromResolvedTarget(page, {
  62  |     kind: 'css',
  63  |     value: 'div.oxd-input-group:has-text("Username") input.oxd-input',
  64  |   }).fill(ORANGEHRM_SEARCH_USERNAME);
  65  | 
  66  |   // AIR step 6
  67  |   await locatorFromResolvedTarget(page, {
  68  |     kind: 'css',
  69  |     value: 'div.oxd-input-group:has-text("User Role") div.oxd-select-text-input',
  70  |   }).click();
  71  | 
  72  |   // AIR step 7
  73  |   await locatorFromResolvedTarget(page, {
  74  |     kind: 'css',
  75  |     value: 'div[role="listbox"] div[role="option"]:has-text("Admin")',
  76  |   }).click();
  77  | 
  78  |   // AIR step 10
  79  |   // TODO[AIR inferred gap]: AIR recorded selecting "Enabled" but did not provide
  80  |   // a preceding Status dropdown-open action. This test intentionally does not
  81  |   // invent one, per GenerationContext-only replay rules.
  82  |   await locatorFromResolvedTarget(page, {
  83  |     kind: 'css',
  84  |     value: 'div[role="listbox"] div[role="option"]:has-text("Enabled")',
  85  |   }).click();
  86  | 
  87  |   // AIR step 11
  88  |   await locatorFromResolvedTarget(page, {
  89  |     kind: 'css',
  90  |     value: 'button:has-text("Search")',
  91  |   }).click();
  92  | 
  93  |   // AIR step 12
  94  |   // TODO[AIR inferred gap]: AIR recorded choosing "Logout" but did not provide
  95  |   // the user-menu-open action that may be required before this menu item exists.
  96  |   await locatorFromResolvedTarget(page, {
  97  |     kind: 'css',
  98  |     value: 'a[href="/web/index.php/auth/logout"]',
> 99  |   }).click();
      |      ^ Error: locator.click: Test timeout of 90000ms exceeded.
  100 | 
  101 |   await expect(page).toHaveURL('https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');
  102 |   await expect(page.locator('button:has-text("Login")')).toBeVisible();
  103 |   await expect(page.locator('[name="password"]')).toBeVisible();
  104 |   await expect(page.locator('[name="username"]')).toBeVisible();
  105 | });
  106 | 
```