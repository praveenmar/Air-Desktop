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
              - paragraph [ref=e128]: FirstNameTest LastNameTest
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
          - generic [ref=e216]: (40) Records Found
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
            - row " alanturing ESS Alan Turing Enabled  " [ref=e242]:
              - cell "" [ref=e243]:
                - generic [ref=e246] [cursor=pointer]:
                  - checkbox "" [ref=e247]
                  - generic [ref=e249]: 
              - cell "alanturing" [ref=e250]:
                - generic [ref=e251]: alanturing
              - cell "ESS" [ref=e252]:
                - generic [ref=e253]: ESS
              - cell "Alan Turing" [ref=e254]:
                - generic [ref=e255]: Alan Turing
              - cell "Enabled" [ref=e256]:
                - generic [ref=e257]: Enabled
              - cell " " [ref=e258]:
                - generic [ref=e259]:
                  - button "" [ref=e260] [cursor=pointer]:
                    - generic [ref=e261]: 
                  - button "" [ref=e262] [cursor=pointer]:
                    - generic [ref=e263]: 
            - row " Admin Admin FirstNameTest LastNameTest Enabled  " [ref=e265]:
              - cell "" [ref=e266]:
                - generic [ref=e270]:
                  - checkbox "" [ref=e271]
                  - generic [ref=e273]: 
              - cell "Admin" [ref=e274]:
                - generic [ref=e275]: Admin
              - cell "Admin" [ref=e276]:
                - generic [ref=e277]: Admin
              - cell "FirstNameTest LastNameTest" [ref=e278]:
                - generic [ref=e279]: FirstNameTest LastNameTest
              - cell "Enabled" [ref=e280]:
                - generic [ref=e281]: Enabled
              - cell " " [ref=e282]:
                - generic [ref=e283]:
                  - button "" [ref=e284] [cursor=pointer]:
                    - generic [ref=e285]: 
                  - button "" [ref=e286] [cursor=pointer]:
                    - generic [ref=e287]: 
            - row " berihikmah Admin Amelia Brown Enabled  " [ref=e289]:
              - cell "" [ref=e290]:
                - generic [ref=e293] [cursor=pointer]:
                  - checkbox "" [ref=e294]
                  - generic [ref=e296]: 
              - cell "berihikmah" [ref=e297]:
                - generic [ref=e298]: berihikmah
              - cell "Admin" [ref=e299]:
                - generic [ref=e300]: Admin
              - cell "Amelia Brown" [ref=e301]:
                - generic [ref=e302]: Amelia Brown
              - cell "Enabled" [ref=e303]:
                - generic [ref=e304]: Enabled
              - cell " " [ref=e305]:
                - generic [ref=e306]:
                  - button "" [ref=e307] [cursor=pointer]:
                    - generic [ref=e308]: 
                  - button "" [ref=e309] [cursor=pointer]:
                    - generic [ref=e310]: 
            - row " berijalan Admin Amelia Brown Enabled  " [ref=e312]:
              - cell "" [ref=e313]:
                - generic [ref=e316] [cursor=pointer]:
                  - checkbox "" [ref=e317]
                  - generic [ref=e319]: 
              - cell "berijalan" [ref=e320]:
                - generic [ref=e321]: berijalan
              - cell "Admin" [ref=e322]:
                - generic [ref=e323]: Admin
              - cell "Amelia Brown" [ref=e324]:
                - generic [ref=e325]: Amelia Brown
              - cell "Enabled" [ref=e326]:
                - generic [ref=e327]: Enabled
              - cell " " [ref=e328]:
                - generic [ref=e329]:
                  - button "" [ref=e330] [cursor=pointer]:
                    - generic [ref=e331]: 
                  - button "" [ref=e332] [cursor=pointer]:
                    - generic [ref=e333]: 
            - row " desember Admin FirstNameTest LastNameTest Enabled  " [ref=e335]:
              - cell "" [ref=e336]:
                - generic [ref=e339] [cursor=pointer]:
                  - checkbox "" [ref=e340]
                  - generic [ref=e342]: 
              - cell "desember" [ref=e343]:
                - generic [ref=e344]: desember
              - cell "Admin" [ref=e345]:
                - generic [ref=e346]: Admin
              - cell "FirstNameTest LastNameTest" [ref=e347]:
                - generic [ref=e348]: FirstNameTest LastNameTest
              - cell "Enabled" [ref=e349]:
                - generic [ref=e350]: Enabled
              - cell " " [ref=e351]:
                - generic [ref=e352]:
                  - button "" [ref=e353] [cursor=pointer]:
                    - generic [ref=e354]: 
                  - button "" [ref=e355] [cursor=pointer]:
                    - generic [ref=e356]: 
            - row " doniah Admin Thomas Benny Enabled  " [ref=e358]:
              - cell "" [ref=e359]:
                - generic [ref=e362] [cursor=pointer]:
                  - checkbox "" [ref=e363]
                  - generic [ref=e365]: 
              - cell "doniah" [ref=e366]:
                - generic [ref=e367]: doniah
              - cell "Admin" [ref=e368]:
                - generic [ref=e369]: Admin
              - cell "Thomas Benny" [ref=e370]:
                - generic [ref=e371]: Thomas Benny
              - cell "Enabled" [ref=e372]:
                - generic [ref=e373]: Enabled
              - cell " " [ref=e374]:
                - generic [ref=e375]:
                  - button "" [ref=e376] [cursor=pointer]:
                    - generic [ref=e377]: 
                  - button "" [ref=e378] [cursor=pointer]:
                    - generic [ref=e379]: 
            - row " doniahelmy Admin Amelia Brown Enabled  " [ref=e381]:
              - cell "" [ref=e382]:
                - generic [ref=e385] [cursor=pointer]:
                  - checkbox "" [ref=e386]
                  - generic [ref=e388]: 
              - cell "doniahelmy" [ref=e389]:
                - generic [ref=e390]: doniahelmy
              - cell "Admin" [ref=e391]:
                - generic [ref=e392]: Admin
              - cell "Amelia Brown" [ref=e393]:
                - generic [ref=e394]: Amelia Brown
              - cell "Enabled" [ref=e395]:
                - generic [ref=e396]: Enabled
              - cell " " [ref=e397]:
                - generic [ref=e398]:
                  - button "" [ref=e399] [cursor=pointer]:
                    - generic [ref=e400]: 
                  - button "" [ref=e401] [cursor=pointer]:
                    - generic [ref=e402]: 
            - row " FMLName ESS Qwerty LName Enabled  " [ref=e404]:
              - cell "" [ref=e405]:
                - generic [ref=e408] [cursor=pointer]:
                  - checkbox "" [ref=e409]
                  - generic [ref=e411]: 
              - cell "FMLName" [ref=e412]:
                - generic [ref=e413]: FMLName
              - cell "ESS" [ref=e414]:
                - generic [ref=e415]: ESS
              - cell "Qwerty LName" [ref=e416]:
                - generic [ref=e417]: Qwerty LName
              - cell "Enabled" [ref=e418]:
                - generic [ref=e419]: Enabled
              - cell " " [ref=e420]:
                - generic [ref=e421]:
                  - button "" [ref=e422] [cursor=pointer]:
                    - generic [ref=e423]: 
                  - button "" [ref=e424] [cursor=pointer]:
                    - generic [ref=e425]: 
            - row " FMLName1 ESS FName LName Enabled  " [ref=e427]:
              - cell "" [ref=e428]:
                - generic [ref=e431] [cursor=pointer]:
                  - checkbox "" [ref=e432]
                  - generic [ref=e434]: 
              - cell "FMLName1" [ref=e435]:
                - generic [ref=e436]: FMLName1
              - cell "ESS" [ref=e437]:
                - generic [ref=e438]: ESS
              - cell "FName LName" [ref=e439]:
                - generic [ref=e440]: FName LName
              - cell "Enabled" [ref=e441]:
                - generic [ref=e442]: Enabled
              - cell " " [ref=e443]:
                - generic [ref=e444]:
                  - button "" [ref=e445] [cursor=pointer]:
                    - generic [ref=e446]: 
                  - button "" [ref=e447] [cursor=pointer]:
                    - generic [ref=e448]: 
            - row " Jobinsam@6742 ESS Jobin Sam Enabled  " [ref=e450]:
              - cell "" [ref=e451]:
                - generic [ref=e454] [cursor=pointer]:
                  - checkbox "" [ref=e455]
                  - generic [ref=e457]: 
              - cell "Jobinsam@6742" [ref=e458]:
                - generic [ref=e459]: Jobinsam@6742
              - cell "ESS" [ref=e460]:
                - generic [ref=e461]: ESS
              - cell "Jobin Sam" [ref=e462]:
                - generic [ref=e463]: Jobin Sam
              - cell "Enabled" [ref=e464]:
                - generic [ref=e465]: Enabled
              - cell " " [ref=e466]:
                - generic [ref=e467]:
                  - button "" [ref=e468] [cursor=pointer]:
                    - generic [ref=e469]: 
                  - button "" [ref=e470] [cursor=pointer]:
                    - generic [ref=e471]: 
            - row " jumat Admin FirstNameTest LastNameTest Enabled  " [ref=e473]:
              - cell "" [ref=e474]:
                - generic [ref=e477] [cursor=pointer]:
                  - checkbox "" [ref=e478]
                  - generic [ref=e480]: 
              - cell "jumat" [ref=e481]:
                - generic [ref=e482]: jumat
              - cell "Admin" [ref=e483]:
                - generic [ref=e484]: Admin
              - cell "FirstNameTest LastNameTest" [ref=e485]:
                - generic [ref=e486]: FirstNameTest LastNameTest
              - cell "Enabled" [ref=e487]:
                - generic [ref=e488]: Enabled
              - cell " " [ref=e489]:
                - generic [ref=e490]:
                  - button "" [ref=e491] [cursor=pointer]:
                    - generic [ref=e492]: 
                  - button "" [ref=e493] [cursor=pointer]:
                    - generic [ref=e494]: 
            - row " maret Admin FirstNameTest LastNameTest Enabled  " [ref=e496]:
              - cell "" [ref=e497]:
                - generic [ref=e500] [cursor=pointer]:
                  - checkbox "" [ref=e501]
                  - generic [ref=e503]: 
              - cell "maret" [ref=e504]:
                - generic [ref=e505]: maret
              - cell "Admin" [ref=e506]:
                - generic [ref=e507]: Admin
              - cell "FirstNameTest LastNameTest" [ref=e508]:
                - generic [ref=e509]: FirstNameTest LastNameTest
              - cell "Enabled" [ref=e510]:
                - generic [ref=e511]: Enabled
              - cell " " [ref=e512]:
                - generic [ref=e513]:
                  - button "" [ref=e514] [cursor=pointer]:
                    - generic [ref=e515]: 
                  - button "" [ref=e516] [cursor=pointer]:
                    - generic [ref=e517]: 
            - row " november Admin FirstNameTest LastNameTest Enabled  " [ref=e519]:
              - cell "" [ref=e520]:
                - generic [ref=e523] [cursor=pointer]:
                  - checkbox "" [ref=e524]
                  - generic [ref=e526]: 
              - cell "november" [ref=e527]:
                - generic [ref=e528]: november
              - cell "Admin" [ref=e529]:
                - generic [ref=e530]: Admin
              - cell "FirstNameTest LastNameTest" [ref=e531]:
                - generic [ref=e532]: FirstNameTest LastNameTest
              - cell "Enabled" [ref=e533]:
                - generic [ref=e534]: Enabled
              - cell " " [ref=e535]:
                - generic [ref=e536]:
                  - button "" [ref=e537] [cursor=pointer]:
                    - generic [ref=e538]: 
                  - button "" [ref=e539] [cursor=pointer]:
                    - generic [ref=e540]: 
            - row " rabujumat Admin FirstNameTest LastNameTest Enabled  " [ref=e542]:
              - cell "" [ref=e543]:
                - generic [ref=e546] [cursor=pointer]:
                  - checkbox "" [ref=e547]
                  - generic [ref=e549]: 
              - cell "rabujumat" [ref=e550]:
                - generic [ref=e551]: rabujumat
              - cell "Admin" [ref=e552]:
                - generic [ref=e553]: Admin
              - cell "FirstNameTest LastNameTest" [ref=e554]:
                - generic [ref=e555]: FirstNameTest LastNameTest
              - cell "Enabled" [ref=e556]:
                - generic [ref=e557]: Enabled
              - cell " " [ref=e558]:
                - generic [ref=e559]:
                  - button "" [ref=e560] [cursor=pointer]:
                    - generic [ref=e561]: 
                  - button "" [ref=e562] [cursor=pointer]:
                    - generic [ref=e563]: 
            - row " Samirrr ESS Sami Sami Enabled  " [ref=e565]:
              - cell "" [ref=e566]:
                - generic [ref=e569] [cursor=pointer]:
                  - checkbox "" [ref=e570]
                  - generic [ref=e572]: 
              - cell "Samirrr" [ref=e573]:
                - generic [ref=e574]: Samirrr
              - cell "ESS" [ref=e575]:
                - generic [ref=e576]: ESS
              - cell "Sami Sami" [ref=e577]:
                - generic [ref=e578]: Sami Sami
              - cell "Enabled" [ref=e579]:
                - generic [ref=e580]: Enabled
              - cell " " [ref=e581]:
                - generic [ref=e582]:
                  - button "" [ref=e583] [cursor=pointer]:
                    - generic [ref=e584]: 
                  - button "" [ref=e585] [cursor=pointer]:
                    - generic [ref=e586]: 
            - row " SamiUsername Admin Sami Sami Enabled  " [ref=e588]:
              - cell "" [ref=e589]:
                - generic [ref=e592] [cursor=pointer]:
                  - checkbox "" [ref=e593]
                  - generic [ref=e595]: 
              - cell "SamiUsername" [ref=e596]:
                - generic [ref=e597]: SamiUsername
              - cell "Admin" [ref=e598]:
                - generic [ref=e599]: Admin
              - cell "Sami Sami" [ref=e600]:
                - generic [ref=e601]: Sami Sami
              - cell "Enabled" [ref=e602]:
                - generic [ref=e603]: Enabled
              - cell " " [ref=e604]:
                - generic [ref=e605]:
                  - button "" [ref=e606] [cursor=pointer]:
                    - generic [ref=e607]: 
                  - button "" [ref=e608] [cursor=pointer]:
                    - generic [ref=e609]: 
            - row " sdfgds ESS fsd d Disabled  " [ref=e611]:
              - cell "" [ref=e612]:
                - generic [ref=e615] [cursor=pointer]:
                  - checkbox "" [ref=e616]
                  - generic [ref=e618]: 
              - cell "sdfgds" [ref=e619]:
                - generic [ref=e620]: sdfgds
              - cell "ESS" [ref=e621]:
                - generic [ref=e622]: ESS
              - cell "fsd d" [ref=e623]:
                - generic [ref=e624]: fsd d
              - cell "Disabled" [ref=e625]:
                - generic [ref=e626]: Disabled
              - cell " " [ref=e627]:
                - generic [ref=e628]:
                  - button "" [ref=e629] [cursor=pointer]:
                    - generic [ref=e630]: 
                  - button "" [ref=e631] [cursor=pointer]:
                    - generic [ref=e632]: 
            - row " sdfsad ESS dsfaasd fasdf Enabled  " [ref=e634]:
              - cell "" [ref=e635]:
                - generic [ref=e638] [cursor=pointer]:
                  - checkbox "" [ref=e639]
                  - generic [ref=e641]: 
              - cell "sdfsad" [ref=e642]:
                - generic [ref=e643]: sdfsad
              - cell "ESS" [ref=e644]:
                - generic [ref=e645]: ESS
              - cell "dsfaasd fasdf" [ref=e646]:
                - generic [ref=e647]: dsfaasd fasdf
              - cell "Enabled" [ref=e648]:
                - generic [ref=e649]: Enabled
              - cell " " [ref=e650]:
                - generic [ref=e651]:
                  - button "" [ref=e652] [cursor=pointer]:
                    - generic [ref=e653]: 
                  - button "" [ref=e654] [cursor=pointer]:
                    - generic [ref=e655]: 
            - row " search1777917989907 ESS A8DCo 010Z Enabled  " [ref=e657]:
              - cell "" [ref=e658]:
                - generic [ref=e661] [cursor=pointer]:
                  - checkbox "" [ref=e662]
                  - generic [ref=e664]: 
              - cell "search1777917989907" [ref=e665]:
                - generic [ref=e666]: search1777917989907
              - cell "ESS" [ref=e667]:
                - generic [ref=e668]: ESS
              - cell "A8DCo 010Z" [ref=e669]:
                - generic [ref=e670]: A8DCo 010Z
              - cell "Enabled" [ref=e671]:
                - generic [ref=e672]: Enabled
              - cell " " [ref=e673]:
                - generic [ref=e674]:
                  - button "" [ref=e675] [cursor=pointer]:
                    - generic [ref=e676]: 
                  - button "" [ref=e677] [cursor=pointer]:
                    - generic [ref=e678]: 
            - row " search1777918156665 Admin A8DCo 010Z Enabled  " [ref=e680]:
              - cell "" [ref=e681]:
                - generic [ref=e684] [cursor=pointer]:
                  - checkbox "" [ref=e685]
                  - generic [ref=e687]: 
              - cell "search1777918156665" [ref=e688]:
                - generic [ref=e689]: search1777918156665
              - cell "Admin" [ref=e690]:
                - generic [ref=e691]: Admin
              - cell "A8DCo 010Z" [ref=e692]:
                - generic [ref=e693]: A8DCo 010Z
              - cell "Enabled" [ref=e694]:
                - generic [ref=e695]: Enabled
              - cell " " [ref=e696]:
                - generic [ref=e697]:
                  - button "" [ref=e698] [cursor=pointer]:
                    - generic [ref=e699]: 
                  - button "" [ref=e700] [cursor=pointer]:
                    - generic [ref=e701]: 
            - row " testuser001 Admin joker selvam Enabled  " [ref=e703]:
              - cell "" [ref=e704]:
                - generic [ref=e707] [cursor=pointer]:
                  - checkbox "" [ref=e708]
                  - generic [ref=e710]: 
              - cell "testuser001" [ref=e711]:
                - generic [ref=e712]: testuser001
              - cell "Admin" [ref=e713]:
                - generic [ref=e714]: Admin
              - cell "joker selvam" [ref=e715]:
                - generic [ref=e716]: joker selvam
              - cell "Enabled" [ref=e717]:
                - generic [ref=e718]: Enabled
              - cell " " [ref=e719]:
                - generic [ref=e720]:
                  - button "" [ref=e721] [cursor=pointer]:
                    - generic [ref=e722]: 
                  - button "" [ref=e723] [cursor=pointer]:
                    - generic [ref=e724]: 
            - row " test_user_1777918019065 ESS John TestAuto Enabled  " [ref=e726]:
              - cell "" [ref=e727]:
                - generic [ref=e730] [cursor=pointer]:
                  - checkbox "" [ref=e731]
                  - generic [ref=e733]: 
              - cell "test_user_1777918019065" [ref=e734]:
                - generic [ref=e735]: test_user_1777918019065
              - cell "ESS" [ref=e736]:
                - generic [ref=e737]: ESS
              - cell "John TestAuto" [ref=e738]:
                - generic [ref=e739]: John TestAuto
              - cell "Enabled" [ref=e740]:
                - generic [ref=e741]: Enabled
              - cell " " [ref=e742]:
                - generic [ref=e743]:
                  - button "" [ref=e744] [cursor=pointer]:
                    - generic [ref=e745]: 
                  - button "" [ref=e746] [cursor=pointer]:
                    - generic [ref=e747]: 
            - row " test_user_1777918103576 ESS John TestAuto Enabled  " [ref=e749]:
              - cell "" [ref=e750]:
                - generic [ref=e753] [cursor=pointer]:
                  - checkbox "" [ref=e754]
                  - generic [ref=e756]: 
              - cell "test_user_1777918103576" [ref=e757]:
                - generic [ref=e758]: test_user_1777918103576
              - cell "ESS" [ref=e759]:
                - generic [ref=e760]: ESS
              - cell "John TestAuto" [ref=e761]:
                - generic [ref=e762]: John TestAuto
              - cell "Enabled" [ref=e763]:
                - generic [ref=e764]: Enabled
              - cell " " [ref=e765]:
                - generic [ref=e766]:
                  - button "" [ref=e767] [cursor=pointer]:
                    - generic [ref=e768]: 
                  - button "" [ref=e769] [cursor=pointer]:
                    - generic [ref=e770]: 
            - row " test_user_1777918157961 ESS John TestAuto Enabled  " [ref=e772]:
              - cell "" [ref=e773]:
                - generic [ref=e776] [cursor=pointer]:
                  - checkbox "" [ref=e777]
                  - generic [ref=e779]: 
              - cell "test_user_1777918157961" [ref=e780]:
                - generic [ref=e781]: test_user_1777918157961
              - cell "ESS" [ref=e782]:
                - generic [ref=e783]: ESS
              - cell "John TestAuto" [ref=e784]:
                - generic [ref=e785]: John TestAuto
              - cell "Enabled" [ref=e786]:
                - generic [ref=e787]: Enabled
              - cell " " [ref=e788]:
                - generic [ref=e789]:
                  - button "" [ref=e790] [cursor=pointer]:
                    - generic [ref=e791]: 
                  - button "" [ref=e792] [cursor=pointer]:
                    - generic [ref=e793]: 
            - row " test_user_1777918187816 ESS John TestAuto Enabled  " [ref=e795]:
              - cell "" [ref=e796]:
                - generic [ref=e799] [cursor=pointer]:
                  - checkbox "" [ref=e800]
                  - generic [ref=e802]: 
              - cell "test_user_1777918187816" [ref=e803]:
                - generic [ref=e804]: test_user_1777918187816
              - cell "ESS" [ref=e805]:
                - generic [ref=e806]: ESS
              - cell "John TestAuto" [ref=e807]:
                - generic [ref=e808]: John TestAuto
              - cell "Enabled" [ref=e809]:
                - generic [ref=e810]: Enabled
              - cell " " [ref=e811]:
                - generic [ref=e812]:
                  - button "" [ref=e813] [cursor=pointer]:
                    - generic [ref=e814]: 
                  - button "" [ref=e815] [cursor=pointer]:
                    - generic [ref=e816]: 
            - row " test_user_1777918961548 ESS John TestAuto Enabled  " [ref=e818]:
              - cell "" [ref=e819]:
                - generic [ref=e822] [cursor=pointer]:
                  - checkbox "" [ref=e823]
                  - generic [ref=e825]: 
              - cell "test_user_1777918961548" [ref=e826]:
                - generic [ref=e827]: test_user_1777918961548
              - cell "ESS" [ref=e828]:
                - generic [ref=e829]: ESS
              - cell "John TestAuto" [ref=e830]:
                - generic [ref=e831]: John TestAuto
              - cell "Enabled" [ref=e832]:
                - generic [ref=e833]: Enabled
              - cell " " [ref=e834]:
                - generic [ref=e835]:
                  - button "" [ref=e836] [cursor=pointer]:
                    - generic [ref=e837]: 
                  - button "" [ref=e838] [cursor=pointer]:
                    - generic [ref=e839]: 
            - row " test_user_1777919081019 ESS John TestAuto Enabled  " [ref=e841]:
              - cell "" [ref=e842]:
                - generic [ref=e845] [cursor=pointer]:
                  - checkbox "" [ref=e846]
                  - generic [ref=e848]: 
              - cell "test_user_1777919081019" [ref=e849]:
                - generic [ref=e850]: test_user_1777919081019
              - cell "ESS" [ref=e851]:
                - generic [ref=e852]: ESS
              - cell "John TestAuto" [ref=e853]:
                - generic [ref=e854]: John TestAuto
              - cell "Enabled" [ref=e855]:
                - generic [ref=e856]: Enabled
              - cell " " [ref=e857]:
                - generic [ref=e858]:
                  - button "" [ref=e859] [cursor=pointer]:
                    - generic [ref=e860]: 
                  - button "" [ref=e861] [cursor=pointer]:
                    - generic [ref=e862]: 
            - row " test_user_1777919107144 ESS John TestAuto Enabled  " [ref=e864]:
              - cell "" [ref=e865]:
                - generic [ref=e868] [cursor=pointer]:
                  - checkbox "" [ref=e869]
                  - generic [ref=e871]: 
              - cell "test_user_1777919107144" [ref=e872]:
                - generic [ref=e873]: test_user_1777919107144
              - cell "ESS" [ref=e874]:
                - generic [ref=e875]: ESS
              - cell "John TestAuto" [ref=e876]:
                - generic [ref=e877]: John TestAuto
              - cell "Enabled" [ref=e878]:
                - generic [ref=e879]: Enabled
              - cell " " [ref=e880]:
                - generic [ref=e881]:
                  - button "" [ref=e882] [cursor=pointer]:
                    - generic [ref=e883]: 
                  - button "" [ref=e884] [cursor=pointer]:
                    - generic [ref=e885]: 
            - row " test_user_1777919732220 ESS John TestAuto Enabled  " [ref=e887]:
              - cell "" [ref=e888]:
                - generic [ref=e891] [cursor=pointer]:
                  - checkbox "" [ref=e892]
                  - generic [ref=e894]: 
              - cell "test_user_1777919732220" [ref=e895]:
                - generic [ref=e896]: test_user_1777919732220
              - cell "ESS" [ref=e897]:
                - generic [ref=e898]: ESS
              - cell "John TestAuto" [ref=e899]:
                - generic [ref=e900]: John TestAuto
              - cell "Enabled" [ref=e901]:
                - generic [ref=e902]: Enabled
              - cell " " [ref=e903]:
                - generic [ref=e904]:
                  - button "" [ref=e905] [cursor=pointer]:
                    - generic [ref=e906]: 
                  - button "" [ref=e907] [cursor=pointer]:
                    - generic [ref=e908]: 
            - row " test_user_1777919800357 ESS John TestAuto Enabled  " [ref=e910]:
              - cell "" [ref=e911]:
                - generic [ref=e914] [cursor=pointer]:
                  - checkbox "" [ref=e915]
                  - generic [ref=e917]: 
              - cell "test_user_1777919800357" [ref=e918]:
                - generic [ref=e919]: test_user_1777919800357
              - cell "ESS" [ref=e920]:
                - generic [ref=e921]: ESS
              - cell "John TestAuto" [ref=e922]:
                - generic [ref=e923]: John TestAuto
              - cell "Enabled" [ref=e924]:
                - generic [ref=e925]: Enabled
              - cell " " [ref=e926]:
                - generic [ref=e927]:
                  - button "" [ref=e928] [cursor=pointer]:
                    - generic [ref=e929]: 
                  - button "" [ref=e930] [cursor=pointer]:
                    - generic [ref=e931]: 
            - row " test_user_1777919841850 ESS John TestAuto Enabled  " [ref=e933]:
              - cell "" [ref=e934]:
                - generic [ref=e937] [cursor=pointer]:
                  - checkbox "" [ref=e938]
                  - generic [ref=e940]: 
              - cell "test_user_1777919841850" [ref=e941]:
                - generic [ref=e942]: test_user_1777919841850
              - cell "ESS" [ref=e943]:
                - generic [ref=e944]: ESS
              - cell "John TestAuto" [ref=e945]:
                - generic [ref=e946]: John TestAuto
              - cell "Enabled" [ref=e947]:
                - generic [ref=e948]: Enabled
              - cell " " [ref=e949]:
                - generic [ref=e950]:
                  - button "" [ref=e951] [cursor=pointer]:
                    - generic [ref=e952]: 
                  - button "" [ref=e953] [cursor=pointer]:
                    - generic [ref=e954]: 
            - row " test_user_1777919877573 ESS John TestAuto Enabled  " [ref=e956]:
              - cell "" [ref=e957]:
                - generic [ref=e960] [cursor=pointer]:
                  - checkbox "" [ref=e961]
                  - generic [ref=e963]: 
              - cell "test_user_1777919877573" [ref=e964]:
                - generic [ref=e965]: test_user_1777919877573
              - cell "ESS" [ref=e966]:
                - generic [ref=e967]: ESS
              - cell "John TestAuto" [ref=e968]:
                - generic [ref=e969]: John TestAuto
              - cell "Enabled" [ref=e970]:
                - generic [ref=e971]: Enabled
              - cell " " [ref=e972]:
                - generic [ref=e973]:
                  - button "" [ref=e974] [cursor=pointer]:
                    - generic [ref=e975]: 
                  - button "" [ref=e976] [cursor=pointer]:
                    - generic [ref=e977]: 
            - row " test_user_1777920506505 ESS John TestAuto Enabled  " [ref=e979]:
              - cell "" [ref=e980]:
                - generic [ref=e983] [cursor=pointer]:
                  - checkbox "" [ref=e984]
                  - generic [ref=e986]: 
              - cell "test_user_1777920506505" [ref=e987]:
                - generic [ref=e988]: test_user_1777920506505
              - cell "ESS" [ref=e989]:
                - generic [ref=e990]: ESS
              - cell "John TestAuto" [ref=e991]:
                - generic [ref=e992]: John TestAuto
              - cell "Enabled" [ref=e993]:
                - generic [ref=e994]: Enabled
              - cell " " [ref=e995]:
                - generic [ref=e996]:
                  - button "" [ref=e997] [cursor=pointer]:
                    - generic [ref=e998]: 
                  - button "" [ref=e999] [cursor=pointer]:
                    - generic [ref=e1000]: 
            - row " test_user_1777920649722 ESS John TestAuto Enabled  " [ref=e1002]:
              - cell "" [ref=e1003]:
                - generic [ref=e1006] [cursor=pointer]:
                  - checkbox "" [ref=e1007]
                  - generic [ref=e1009]: 
              - cell "test_user_1777920649722" [ref=e1010]:
                - generic [ref=e1011]: test_user_1777920649722
              - cell "ESS" [ref=e1012]:
                - generic [ref=e1013]: ESS
              - cell "John TestAuto" [ref=e1014]:
                - generic [ref=e1015]: John TestAuto
              - cell "Enabled" [ref=e1016]:
                - generic [ref=e1017]: Enabled
              - cell " " [ref=e1018]:
                - generic [ref=e1019]:
                  - button "" [ref=e1020] [cursor=pointer]:
                    - generic [ref=e1021]: 
                  - button "" [ref=e1022] [cursor=pointer]:
                    - generic [ref=e1023]: 
            - row " test_user_1777920674163 ESS John TestAuto Enabled  " [ref=e1025]:
              - cell "" [ref=e1026]:
                - generic [ref=e1029] [cursor=pointer]:
                  - checkbox "" [ref=e1030]
                  - generic [ref=e1032]: 
              - cell "test_user_1777920674163" [ref=e1033]:
                - generic [ref=e1034]: test_user_1777920674163
              - cell "ESS" [ref=e1035]:
                - generic [ref=e1036]: ESS
              - cell "John TestAuto" [ref=e1037]:
                - generic [ref=e1038]: John TestAuto
              - cell "Enabled" [ref=e1039]:
                - generic [ref=e1040]: Enabled
              - cell " " [ref=e1041]:
                - generic [ref=e1042]:
                  - button "" [ref=e1043] [cursor=pointer]:
                    - generic [ref=e1044]: 
                  - button "" [ref=e1045] [cursor=pointer]:
                    - generic [ref=e1046]: 
            - row " test_user_1777920687761 ESS John TestAuto Enabled  " [ref=e1048]:
              - cell "" [ref=e1049]:
                - generic [ref=e1052] [cursor=pointer]:
                  - checkbox "" [ref=e1053]
                  - generic [ref=e1055]: 
              - cell "test_user_1777920687761" [ref=e1056]:
                - generic [ref=e1057]: test_user_1777920687761
              - cell "ESS" [ref=e1058]:
                - generic [ref=e1059]: ESS
              - cell "John TestAuto" [ref=e1060]:
                - generic [ref=e1061]: John TestAuto
              - cell "Enabled" [ref=e1062]:
                - generic [ref=e1063]: Enabled
              - cell " " [ref=e1064]:
                - generic [ref=e1065]:
                  - button "" [ref=e1066] [cursor=pointer]:
                    - generic [ref=e1067]: 
                  - button "" [ref=e1068] [cursor=pointer]:
                    - generic [ref=e1069]: 
            - row " test_user_1777920736932 ESS John TestAuto Enabled  " [ref=e1071]:
              - cell "" [ref=e1072]:
                - generic [ref=e1075] [cursor=pointer]:
                  - checkbox "" [ref=e1076]
                  - generic [ref=e1078]: 
              - cell "test_user_1777920736932" [ref=e1079]:
                - generic [ref=e1080]: test_user_1777920736932
              - cell "ESS" [ref=e1081]:
                - generic [ref=e1082]: ESS
              - cell "John TestAuto" [ref=e1083]:
                - generic [ref=e1084]: John TestAuto
              - cell "Enabled" [ref=e1085]:
                - generic [ref=e1086]: Enabled
              - cell " " [ref=e1087]:
                - generic [ref=e1088]:
                  - button "" [ref=e1089] [cursor=pointer]:
                    - generic [ref=e1090]: 
                  - button "" [ref=e1091] [cursor=pointer]:
                    - generic [ref=e1092]: 
            - row " test_user_1777920987743 ESS John TestAuto Enabled  " [ref=e1094]:
              - cell "" [ref=e1095]:
                - generic [ref=e1098] [cursor=pointer]:
                  - checkbox "" [ref=e1099]
                  - generic [ref=e1101]: 
              - cell "test_user_1777920987743" [ref=e1102]:
                - generic [ref=e1103]: test_user_1777920987743
              - cell "ESS" [ref=e1104]:
                - generic [ref=e1105]: ESS
              - cell "John TestAuto" [ref=e1106]:
                - generic [ref=e1107]: John TestAuto
              - cell "Enabled" [ref=e1108]:
                - generic [ref=e1109]: Enabled
              - cell " " [ref=e1110]:
                - generic [ref=e1111]:
                  - button "" [ref=e1112] [cursor=pointer]:
                    - generic [ref=e1113]: 
                  - button "" [ref=e1114] [cursor=pointer]:
                    - generic [ref=e1115]: 
            - row " test_user_1777921061134 ESS John TestAuto Enabled  " [ref=e1117]:
              - cell "" [ref=e1118]:
                - generic [ref=e1121] [cursor=pointer]:
                  - checkbox "" [ref=e1122]
                  - generic [ref=e1124]: 
              - cell "test_user_1777921061134" [ref=e1125]:
                - generic [ref=e1126]: test_user_1777921061134
              - cell "ESS" [ref=e1127]:
                - generic [ref=e1128]: ESS
              - cell "John TestAuto" [ref=e1129]:
                - generic [ref=e1130]: John TestAuto
              - cell "Enabled" [ref=e1131]:
                - generic [ref=e1132]: Enabled
              - cell " " [ref=e1133]:
                - generic [ref=e1134]:
                  - button "" [ref=e1135] [cursor=pointer]:
                    - generic [ref=e1136]: 
                  - button "" [ref=e1137] [cursor=pointer]:
                    - generic [ref=e1138]: 
            - row " test_user_1777921145005 ESS John TestAuto Enabled  " [ref=e1140]:
              - cell "" [ref=e1141]:
                - generic [ref=e1144] [cursor=pointer]:
                  - checkbox "" [ref=e1145]
                  - generic [ref=e1147]: 
              - cell "test_user_1777921145005" [ref=e1148]:
                - generic [ref=e1149]: test_user_1777921145005
              - cell "ESS" [ref=e1150]:
                - generic [ref=e1151]: ESS
              - cell "John TestAuto" [ref=e1152]:
                - generic [ref=e1153]: John TestAuto
              - cell "Enabled" [ref=e1154]:
                - generic [ref=e1155]: Enabled
              - cell " " [ref=e1156]:
                - generic [ref=e1157]:
                  - button "" [ref=e1158] [cursor=pointer]:
                    - generic [ref=e1159]: 
                  - button "" [ref=e1160] [cursor=pointer]:
                    - generic [ref=e1161]: 
    - generic [ref=e1163]:
      - paragraph [ref=e1164]: OrangeHRM OS 5.8
      - paragraph [ref=e1165]:
        - text: © 2005 - 2026
        - link "OrangeHRM, Inc" [ref=e1166] [cursor=pointer]:
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