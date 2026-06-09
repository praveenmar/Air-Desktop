# Reference Pattern Harvest

## Purpose

This document captures selector and locator pattern categories observed in the Playwright and SelectorHub codebases.

These references are used for gap discovery only.

They do not define AIR selector ownership, ranking, or output policy.

The rule is:

- harvest pattern categories from reference tools
- translate them into AIR proof families
- implement only AIR-native abstractions that are missing
- reject or downgrade patterns that are not replay-safe for AIR

## Reference Inputs

### Playwright

- `E:\playwright-main\playwright-main\packages\injected\src\selectorGenerator.ts`
- `E:\playwright-main\playwright-main\packages\isomorphic\locatorUtils.ts`
- `E:\playwright-main\playwright-main\docs\src\best-practices-js.md`

### SelectorHub

- `E:\SelectorsHub - Chrome Web Store 5.7.0.0\content-script\playwrightnew.js`
- `E:\SelectorsHub - Chrome Web Store 5.7.0.0\content-script\contentScript.js`

## What The References Are Actually Doing

### Playwright

Playwright is centered on semantic locator families plus controlled disambiguation:

- role plus accessible name
- label association
- placeholder
- test id
- text
- title
- alt text
- frame chaining
- scoped container chaining
- `first`, `last`, `nth`

It prefers resilient semantic locators over brittle CSS when possible.

### SelectorHub

SelectorHub explores a broader output surface:

- Playwright locator families
- CSS selectors
- XPath variants
- iframe chain reconstruction
- open shadow-root traversal
- text and attribute variants
- smart table selectors
- SVG and icon-oriented selectors
- fallback positional disambiguation

It is closer to a selector-solution-space explorer than a proof-first engine.

## Harvested Pattern Map

| Reference Source | Reference Pattern | Reference Evidence | AIR Interpretation | Initial Disposition |
|---|---|---|---|---|
| Playwright | Role plus accessible name | `selectorGenerator.ts`, `locatorUtils.ts`, `best-practices-js.md` | Semantic identity proof | Already core to AIR; keep as primary semantic family |
| Playwright | Role plus accessible description | `selectorGenerator.ts`, `locatorUtils.ts` | Semantic proof extension when name alone is insufficient | Likely missing AIR-native extension |
| Playwright | Label association | `selectorGenerator.ts`, `locatorUtils.ts` | Bounded field / label-control proof | Already core to AIR; preserve as primary family |
| Playwright | Placeholder selector | `selectorGenerator.ts`, `locatorUtils.ts` | Direct attribute or field hint proof | Partially covered; keep as secondary semantic/direct family |
| Playwright | Test id with configurable attribute names | `selectorGenerator.ts`, `locatorUtils.ts` | Direct stable attribute proof | Partially covered; AIR should normalize multi-attribute test-id support |
| Playwright | Title selector | `selectorGenerator.ts`, `locatorUtils.ts` | Direct semantic attribute proof | Likely under-covered in AIR-native tests |
| Playwright | Alt text selector | `selectorGenerator.ts`, `locatorUtils.ts` | Media semantic proof | Likely under-covered in AIR-native tests |
| Playwright | Frame locator chaining | `locatorGenerators.ts`, `selectorGenerator.ts` | Boundary context proof: page -> frame -> target | Important AIR gap area; implement as context preservation, not just output syntax |
| Playwright | Scoped container chaining | `selectorGenerator.ts` | Container proof: parent scope -> child target | Partially covered in AIR through bounded field / option panel / table families |
| Playwright | `filter({ hasText })` | `selectorGenerator.ts` | Structural relation proof with scoped text | Useful AIR abstraction reference; not necessarily same output form |
| Playwright | `filter({ has })` | Playwright locator model | Structural parent-child proof | AIR likely needs a generic relation proof equivalent |
| Playwright | `first`, `last`, `nth` | `locatorParser.ts`, `consoleApi.ts`, `selectorGenerator.ts` | Positional disambiguation | Compatibility reference only; not ideal AIR primary output |
| Playwright | Text exact / regex / partial | `selectorGenerator.ts` | Weak-to-medium text proof variants | AIR should treat as fallback families, not primary truth |
| Playwright | Visibility-aware behavior | best practices plus selector generation heuristics | Validation and interactability gate | AIR should preserve this as proof validation, not just ranking |
| Playwright and SelectorHub | Business-data-dependent semantic attributes | Semantic names and attributes may contain fares, dates, product names, route names, operator names, seat IDs, order IDs, and similar runtime business data | Semantic attributes containing business data should be treated as context-sensitive proof inputs | Usable as fallback in seeded test or staging environments if unique and visible. Do not block by default. Do not let it beat stronger semantic or structural proof. Attach `business-data-dependent` warning. |
| SelectorHub | Open shadow-root deep traversal | `playwrightnew.js` | Boundary context proof across shadow hosts | Important AIR gap area; open-shadow support should be explicit |
| SelectorHub | Iframe chain reconstruction | `playwrightnew.js`, `contentScript.js` | Boundary context proof across frame ancestry | Important AIR gap area; similar need as Playwright frame chaining |
| SelectorHub | Smart table selectors | `playwrightnew.js` | Structured proof: table -> row/header/cell -> target | Strong reference for expanding AIR table proof families |
| SelectorHub | SVG / icon selectors | `playwrightnew.js` | Semantic/media/icon proof | Likely missing AIR-native family or coverage |
| SelectorHub | Multi-attribute test-id aliases | `playwrightnew.js` | Direct attribute alias proof | AIR should normalize `data-testid`, `data-test-id`, `data-test`, `data-cy` policy |
| SelectorHub | Label / aria-label / placeholder / role harvesting | `playwrightnew.js` | Field/accessibility proof | Mostly aligned with AIR philosophy; keep as validation reference |
| SelectorHub | Text pseudo families like `:has-text`, `:text-is`, `:text` | `playwrightnew.js` | Text proof and scoped text fallback | AIR can borrow the scenario concept, not necessarily the syntax |
| SelectorHub | Parent-scoped `nth` disambiguation | `playwrightnew.js` | Positional fallback | Consumer-side or last-resort only for AIR |
| SelectorHub | XPath table / axes / relative path generation | `contentScript.js`, `playwrightnew.js` | Broad selector generation strategy | Useful reference only; AIR should not adopt wholesale as primary proof model |
| SelectorHub | Legacy operator normalization and multi-language locator conversion | `playwrightnew.js` | Read-side compatibility and tooling | Not a selector-engine proof concern; consumer-side compatibility only |

## Most Important New Signals

These are the highest-value categories surfaced by the reference pass that deserve AIR attention:

1. Role plus accessible description
2. Explicit iframe and nested frame context preservation
3. Open shadow-root context preservation
4. Generic structural relation proof similar to container plus `has` semantics
5. Stronger table/grid proof beyond the current row-action set
6. SVG and icon-target semantics
7. Normalized multi-attribute test-id support

## What AIR Should Not Copy Blindly

The following patterns are useful references, but should not be promoted directly into AIR as primary output policy:

- raw positional disambiguation as the default answer
- broad CSS uniqueness chains just because they are unique now
- broad XPath generation as a substitute for proof
- syntax-specific locator tricks without record-time intent evidence

These can remain:

- compatibility references
- last-resort consumer outputs
- blocked/degraded cases if AIR lacks replay-safe proof

## Recommended Next Step

Turn the strongest harvested signals into AIR work items in this order:

1. Add the missing pattern rows into the AIR scenario matrix if they are not already present.
2. Mark each harvested pattern as:
   - already covered
   - partially covered
   - missing AIR-native abstraction
   - intentionally not primary for AIR
3. Start implementation only from the patterns that represent new AIR proof shapes, not just new output syntaxes.

## Initial Staff View

Using Playwright and SelectorHub this way is a good approach.

It is good because it reduces the chance that AIR misses an important scenario family before a live failure happens.

It is only safe if AIR keeps this boundary:

- reference tools help discover pattern categories
- AIR decides which proof abstractions are valid
- AIR does not import another tool's selector philosophy unchanged
