# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: packages\shared\__tests__\orangehrm-login-flow.smoke.spec.ts >> OrangeHRM smoke: login, open Admin, logout
- Location: packages\shared\__tests__\orangehrm-login-flow.smoke.spec.ts:8:5

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: locator.waitFor: Test timeout of 90000ms exceeded.
Call log:
  - waiting for locator('form.oxd-form').getByLabel('Username') to be visible

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
              - paragraph [ref=e128]: vivek kalyankar
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
              - textbox [ref=e176]
            - generic [ref=e178]:
              - generic [ref=e180]: User Role
              - generic [ref=e183] [cursor=pointer]:
                - generic [ref=e184]: "-- Select --"
                - generic [ref=e186]: 
            - generic [ref=e188]:
              - generic [ref=e190]: Employee Name
              - textbox "Type for hints..." [ref=e194]
            - generic [ref=e196]:
              - generic [ref=e198]: Status
              - generic [ref=e201] [cursor=pointer]:
                - generic [ref=e202]: "-- Select --"
                - generic [ref=e204]: 
          - separator [ref=e205]
          - generic [ref=e206]:
            - button "Reset" [ref=e207] [cursor=pointer]
            - button "Search" [ref=e208] [cursor=pointer]
      - generic [ref=e209]:
        - button " Add" [ref=e211] [cursor=pointer]:
          - generic [ref=e212]: 
          - text: Add
        - generic [ref=e213]:
          - separator [ref=e214]
          - generic [ref=e216]: (5) Records Found
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
            - row " Admin Admin vivek kalyankar Enabled  " [ref=e242]:
              - cell "" [ref=e243]:
                - generic [ref=e247]:
                  - checkbox "" [ref=e248]
                  - generic [ref=e250]: 
              - cell "Admin" [ref=e251]:
                - generic [ref=e252]: Admin
              - cell "Admin" [ref=e253]:
                - generic [ref=e254]: Admin
              - cell "vivek kalyankar" [ref=e255]:
                - generic [ref=e256]: vivek kalyankar
              - cell "Enabled" [ref=e257]:
                - generic [ref=e258]: Enabled
              - cell " " [ref=e259]:
                - generic [ref=e260]:
                  - button "" [ref=e261] [cursor=pointer]:
                    - generic [ref=e262]: 
                  - button "" [ref=e263] [cursor=pointer]:
                    - generic [ref=e264]: 
            - row " FMLName ESS Qwerty LName Enabled  " [ref=e266]:
              - cell "" [ref=e267]:
                - generic [ref=e270] [cursor=pointer]:
                  - checkbox "" [ref=e271]
                  - generic [ref=e273]: 
              - cell "FMLName" [ref=e274]:
                - generic [ref=e275]: FMLName
              - cell "ESS" [ref=e276]:
                - generic [ref=e277]: ESS
              - cell "Qwerty LName" [ref=e278]:
                - generic [ref=e279]: Qwerty LName
              - cell "Enabled" [ref=e280]:
                - generic [ref=e281]: Enabled
              - cell " " [ref=e282]:
                - generic [ref=e283]:
                  - button "" [ref=e284] [cursor=pointer]:
                    - generic [ref=e285]: 
                  - button "" [ref=e286] [cursor=pointer]:
                    - generic [ref=e287]: 
            - row " Jobinsam@6742 ESS Jobin Sam Enabled  " [ref=e289]:
              - cell "" [ref=e290]:
                - generic [ref=e293] [cursor=pointer]:
                  - checkbox "" [ref=e294]
                  - generic [ref=e296]: 
              - cell "Jobinsam@6742" [ref=e297]:
                - generic [ref=e298]: Jobinsam@6742
              - cell "ESS" [ref=e299]:
                - generic [ref=e300]: ESS
              - cell "Jobin Sam" [ref=e301]:
                - generic [ref=e302]: Jobin Sam
              - cell "Enabled" [ref=e303]:
                - generic [ref=e304]: Enabled
              - cell " " [ref=e305]:
                - generic [ref=e306]:
                  - button "" [ref=e307] [cursor=pointer]:
                    - generic [ref=e308]: 
                  - button "" [ref=e309] [cursor=pointer]:
                    - generic [ref=e310]: 
            - row " john68184 ESS John Terry Enabled  " [ref=e312]:
              - cell "" [ref=e313]:
                - generic [ref=e316] [cursor=pointer]:
                  - checkbox "" [ref=e317]
                  - generic [ref=e319]: 
              - cell "john68184" [ref=e320]:
                - generic [ref=e321]: john68184
              - cell "ESS" [ref=e322]:
                - generic [ref=e323]: ESS
              - cell "John Terry" [ref=e324]:
                - generic [ref=e325]: John Terry
              - cell "Enabled" [ref=e326]:
                - generic [ref=e327]: Enabled
              - cell " " [ref=e328]:
                - generic [ref=e329]:
                  - button "" [ref=e330] [cursor=pointer]:
                    - generic [ref=e331]: 
                  - button "" [ref=e332] [cursor=pointer]:
                    - generic [ref=e333]: 
            - row " john95537 ESS John Terry Enabled  " [ref=e335]:
              - cell "" [ref=e336]:
                - generic [ref=e339] [cursor=pointer]:
                  - checkbox "" [ref=e340]
                  - generic [ref=e342]: 
              - cell "john95537" [ref=e343]:
                - generic [ref=e344]: john95537
              - cell "ESS" [ref=e345]:
                - generic [ref=e346]: ESS
              - cell "John Terry" [ref=e347]:
                - generic [ref=e348]: John Terry
              - cell "Enabled" [ref=e349]:
                - generic [ref=e350]: Enabled
              - cell " " [ref=e351]:
                - generic [ref=e352]:
                  - button "" [ref=e353] [cursor=pointer]:
                    - generic [ref=e354]: 
                  - button "" [ref=e355] [cursor=pointer]:
                    - generic [ref=e356]: 
    - generic [ref=e358]:
      - paragraph [ref=e359]: OrangeHRM OS 5.8
      - paragraph [ref=e360]:
        - text: © 2005 - 2026
        - link "OrangeHRM, Inc" [ref=e361] [cursor=pointer]:
          - /url: http://www.orangehrm.com
        - text: . All rights reserved.
```

# Test source

```ts
  1   | import { AirBasePage } from '@air/reporter';
  2   | import metadata from './OrangeHRMLoginFlowPage.air.json';
  3   | import { Page, TestInfo } from '@playwright/test';
  4   | 
  5   | export class OrangeHRMLoginFlowPage extends AirBasePage {
  6   |   constructor(page: Page, testInfo: TestInfo) {
  7   |     super(page, testInfo, metadata as any);
  8   |   }
  9   | 
  10  |   // AIR utility: navigate to the recorded start URL
  11  |   async navigate() {
  12  |     await this.page.goto("https://opensource-demo.orangehrmlive.com/web/index.php/auth/login");
  13  |   }
  14  | 
  15  |   // AIR step 1 | action=input | selectorType=attribute | resolvedBy=kept-original | score=0.9
  16  |   // selector: input[name="username"] | warnings: none
  17  |   async inputUsername(username: string = "*****") {
  18  |     const target = this.page.getByLabel('Username');
  19  |     await target.waitFor({ state: 'visible' });
  20  |     await target.fill(username);
  21  |   }
  22  | 
  23  |   // AIR step 2 | action=input | selectorType=attribute | resolvedBy=kept-original | score=0.9
  24  |   // selector: input[name="password"] | warnings: none
  25  |   async inputPassword(password: string = "input_password_value") {
  26  |     const target = this.page.getByLabel('Password');
  27  |     await target.waitFor({ state: 'visible' });
  28  |     await target.fill(password);
  29  |   }
  30  | 
  31  |   // AIR step 3 | action=click | selectorType=attribute | resolvedBy=kept-original | score=0.9
  32  |   // selector: button[type="submit"] | warnings: none
  33  |   async clickLoginButton() {
  34  |     const target = this.page.getByRole('button', { name: 'Login' });
  35  |     await target.waitFor({ state: 'visible' });
  36  |     await target.click();
  37  |   }
  38  | 
  39  |   // AIR step 4 | action=submit | selectorType=class | resolvedBy=kept-original | score=0.7
  40  |   // selector: .oxd-form | warnings: none
  41  |   async submitLoginForm() {
  42  |     const target = this.page.locator('.oxd-form');
  43  |     await target.waitFor({ state: 'visible' });
  44  |     await target.press('Enter');
  45  |   }
  46  | 
  47  |   // AIR step 5 | action=click | selectorType=class | resolvedBy=deterministic-override | score=1.02
  48  |   // selector: a:has-text("Admin") | warnings: deterministic-override
  49  |   async clickAdminMenuItem() {
  50  |     const target = this.page.getByRole('link', { name: 'Admin' });
  51  |     await target.waitFor({ state: 'visible' });
  52  |     await target.click();
  53  |   }
  54  | 
  55  |   // AIR step 6 | action=input | selectorType=class | resolvedBy=kept-original | score=0.7
  56  |   // selector: .oxd-input--focus | warnings: none
  57  |   async inputAdminSearchUsername(value: string = "*****") {
  58  |     const target = this.page.locator('form.oxd-form').getByLabel('Username');
> 59  |     await target.waitFor({ state: 'visible' });
      |                  ^ Error: locator.waitFor: Test timeout of 90000ms exceeded.
  60  |     await target.fill(value);
  61  |   }
  62  | 
  63  |   // AIR step 7 | action=click | selectorType=path | resolvedBy=blocked-semantic-mismatch | score=0
  64  |   // selector: div > div:nth-of-type(1) | warnings: deterministic-semantic-reject
  65  |   async clickUserRoleDropdown() {
  66  |     const target = this.page.getByLabel('User Role');
  67  |     await target.waitFor({ state: 'visible' });
  68  |     await target.click();
  69  |   }
  70  | 
  71  |   // AIR step 8 | action=input | selectorType=path | resolvedBy=deterministic-override | score=1.1
  72  |   // selector: input[placeholder="Type for hints..."] | warnings: deterministic-override
  73  |   async inputAdminSearchEmployeeName(value: string = "********************") {
  74  |     const target = this.page.getByPlaceholder('Type for hints...');
  75  |     await target.waitFor({ state: 'visible' });
  76  |     await target.fill(value);
  77  |   }
  78  | 
  79  |   // AIR step 9 | action=click | selectorType=path | resolvedBy=blocked-semantic-mismatch | score=0
  80  |   // selector: div > div:nth-of-type(1) | warnings: deterministic-semantic-reject
  81  |   async clickStatusDropdown() {
  82  |     const target = this.page.getByLabel('Status');
  83  |     await target.waitFor({ state: 'visible' });
  84  |     await target.click();
  85  |   }
  86  | 
  87  |   // AIR step 10 | action=click | selectorType=attribute | resolvedBy=kept-original | score=0.9
  88  |   // selector: button[type="submit"] | warnings: none
  89  |   async clickSearchButton() {
  90  |     const target = this.page.getByRole('button', { name: 'Search' });
  91  |     await target.waitFor({ state: 'visible' });
  92  |     await target.click();
  93  |   }
  94  | 
  95  |   // AIR step 11 | action=click | selectorType=attribute | resolvedBy=kept-original | score=0.65
  96  |   // selector: [role="cell"] | warnings: trusted-original-snapshot-miss
  97  |   async clickAdminUserInTable() {
  98  |     const target = this.page.getByRole('cell', { name: 'Admin' });
  99  |     await target.waitFor({ state: 'visible' });
  100 |     await target.click();
  101 |   }
  102 | 
  103 |   // AIR step 12 | action=click | selectorType=class | resolvedBy=kept-original | score=0.7
  104 |   // selector: .oxd-userdropdown-name | warnings: none
  105 |   async clickUserDropdown() {
  106 |     const target = this.page.locator('.oxd-userdropdown-name');
  107 |     await target.waitFor({ state: 'visible' });
  108 |     await target.click();
  109 |   }
  110 | 
  111 |   // AIR step 13 | action=custom-select | selectorType=attribute | resolvedBy=deterministic-override | score=1.14
  112 |   // selector: [role="menuitem"]:has-text("Logout") | warnings: deterministic-override
  113 |   async clickLogoutMenuItem() {
  114 |     const target = this.page.getByRole('menuitem', { name: 'Logout' });
  115 |     await target.waitFor({ state: 'visible' });
  116 |     await target.click();
  117 |   }
  118 | 
  119 |   // AIR composite method derived from steps 1-3
  120 |   async login(username: string, password: string) {
  121 |     const usernameField = this.page.locator("input[name=\"username\"]");
  122 |     await usernameField.waitFor({ state: 'visible' });
  123 |     await usernameField.fill(username);
  124 |     const passwordField = this.page.locator("input[name=\"password\"]");
  125 |     await passwordField.waitFor({ state: 'visible' });
  126 |     await passwordField.fill(password);
  127 |     const submitTarget = this.page.locator("button[type=\"submit\"]");
  128 |     await submitTarget.waitFor({ state: 'visible' });
  129 |     await submitTarget.click();
  130 |   }
  131 | }
  132 | 
```