# AIR Selector Engine SDET Matrix

## Purpose

This document turns the current selector-engine work into a scenario-led validation plan.

The goal is not to chase individual websites. The goal is to identify:

- which selector families AIR already handles in the current selector-engine path
- which families are only partially covered
- which families are still missing the right proof abstraction
- what we should validate before broad implementation changes

## Architecture Boundary

AIR is no longer operating on a resolver-centered selector architecture.

The intended path is:

```text
Interceptor / selector engine
-> emits selector decisions and selector evidence

AIR data pipeline
-> stores and transports those selector decisions

Algorithm v1
-> future proof-first selector decision engine, initially shadow-only

Codegen / MCP
-> consume selector decisions and GenerationContext
```

Interpretation rules for this matrix:

- The current selector engine is the primary selector behavior surface.
- AIR pipeline validation checks whether selector evidence is preserved correctly.
- Algorithm v1 is a future shadow/evaluation layer for proof-first decisions.
- Algorithm v1 shadow output must not affect `selectorDecision`, `selectorResolution`, `resolvedTarget`, `replaySafe`, `locatorStatus`, `GenerationContext`, MCP output, or DB write behavior until explicitly promoted.
- Codegen, MCP, and legacy resolver-era tests are downstream consumer or compatibility references only.
- Codegen, MCP, and legacy resolver-era tests do **not** define selector-engine ownership.

## Recommended Sequence

Recommended order: `3 -> 2 -> 1`

1. Build the scenario matrix first.
2. Map existing selector-engine tests into the matrix as primary coverage, and tag legacy/read-side tests separately as compatibility references.
3. Add live-site scenarios from OrangeHRM, SauceDemo, Redbus, and future apps.
4. Only then cross-check SelectorHub and Playwright for missed strategy categories.

Rationale:

- Starting with the matrix keeps AIR philosophy-led rather than tool-led.
- Existing selector-engine tests provide strong seed coverage for the new path.
- Legacy/read-side tests are still useful, but they are historical regression references and downstream consumer expectations.
- SelectorHub and Playwright should be used as reference codebases for gap discovery, not as design authorities.

## Coverage Sources

### 1. Current selector-engine coverage

These are primary for the new path:

- `core/__tests__/selector-engine.label-context.spec.ts`
- `core/__tests__/selector-engine.bounded-field-bridging.spec.ts`
- `core/__tests__/selector-engine.option-panel-context.spec.ts`
- `core/__tests__/selector-engine.preference-tiers.spec.ts`
- `core/__tests__/selector-engine.table-row-context.spec.ts`

### 2. Legacy/read-side/codegen compatibility references

These are useful references, but they are not the selector architecture center:

- `packages/codegen/__tests__/bounded-field.spec.ts`
- `packages/codegen/__tests__/playwright-candidates.spec.ts`
- `packages/codegen/__tests__/playwright-evaluator.spec.ts`
- `packages/codegen/__tests__/selector-strategy-stress.spec.ts`
- `packages/codegen/__tests__/snapshot-selector.policy.spec.ts`
- `packages/codegen/__tests__/resolver.spec.ts`

Use them as:

- legacy compatibility references
- historical regression references
- downstream consumer expectations

Do not treat them as selector-engine ownership.

### 3. Live recordings / data-pipeline validation

These validate whether record-time evidence and selector decisions survive the AIR pipeline:

- OrangeHRM
- SauceDemo
- Redbus
- future live apps

## Validation Checkpoints

For every scenario family, validate the new path in this order:

1. Was the right record-time evidence captured?
2. Did the current selector engine emit a selector decision and proof metadata?
3. Was the selector decision preserved in the AIR data pipeline?
4. Does GenerationContext receive selector decision data from the pipeline without synthesizing missing selector proof?
5. Can Algorithm v1 later shadow-compare the same scenario cleanly?

These checkpoints should be used for live validation and for any new end-to-end test harness.

## Handling Unknown UI Patterns

AIR should not try to enumerate the full universe of web UI patterns up front.

The web is too broad for a definitive family list, and trying to build one would push AIR into endless taxonomy work before the engine is even stable.

Instead, this matrix should be treated as a working proof taxonomy for AIR's selector philosophy.

The goal is not:

- identify every UI pattern that exists on the web

The goal is:

- cover the major proof patterns AIR already needs
- detect when a scenario fits an existing family
- fail cleanly when a scenario does not have enough replay-safe proof
- add a new family only when AIR discovers a genuinely new proof abstraction

### Operating Model

AIR should be developed in three layers:

1. Proof primitives
2. Scenario families
3. Failure intake and classification

#### Proof primitives

These should stay relatively small and stable over time:

- semantic identity
- label/control relation
- bounded container scope
- active trigger or active panel ownership
- row or item identity
- visibility and interactability
- boundary context such as iframe, shadow DOM, virtualization, or wrapper constraints

#### Scenario families

These are the working buckets in this matrix:

- bounded field
- repeated custom trigger
- option panel
- autocomplete
- table row action
- date picker
- virtualized target
- boundary and runtime families

These families are allowed to evolve. They are not expected to be a perfect catalog of the whole web.

#### Failure intake and classification

Every unresolved case should be classified as one of:

- existing family, implementation bug
- existing family, missing proof object
- new family genuinely needed
- intentionally ambiguous and should remain blocked

This is the control loop that prevents AIR from slipping into site-by-site patching.

### Rule For Creating A New Family

Do not create a new family just because a new website looks different.

Create a new family only when the failure introduces a new proof shape that cannot be explained by the current model.

In practice, AIR should ask:

- is this just a new DOM shape inside an existing proof family?
- or is this a new replay-safety abstraction that AIR does not model yet?

If the proof shape is already known, the right action is usually to strengthen the existing family, not invent a new one.

For example, OrangeHRM custom dropdowns and Redbus autocomplete should not become separate families if both reduce to the same higher-level proof path:

`active trigger or input -> active panel -> chosen option`

That is one abstraction expressed through different UIs.

### What Good Looks Like

A mature AIR selector engine should not claim to know the whole web.

It should instead aim for this behavior:

- most new failures map into an existing proof family
- truly new families are relatively rare and easy to justify
- unresolved cases fail with explicit blocked diagnostics rather than silent bad selectors
- the system improves by adding abstractions, not site-specific patches

This is the standard AIR should use when deciding whether the matrix is scaling well.

## Scenario Matrix

| Scenario Family | Example Pattern | Ideal AIR Proof Path | Primary Current Coverage | Legacy / Read-Side Reference | Live / Pipeline Validation | Status | Risk | Next Action |
|---|---|---|---|---|---|---|---|---|
| Native input with `label[for]` | Username field | `label -> control` | `selector-engine.label-context`, `selector-engine.bounded-field-bridging` | `bounded-field.spec`, `playwright-evaluator.spec` | Validate selector decision persistence on one live app | Strong | Low | Keep as baseline regression gate |
| Wrapped label control | Checkbox inside label | `wrapped label -> control` | Current selector-engine bounded-field path should own this; add direct selector-engine-native assertion if coverage is thin | `bounded-field.spec`, `playwright-evaluator.spec` | Add one pipeline validation case | Partial-strong | Low | Keep as baseline gate and confirm selector-engine-native ownership explicitly |
| `aria-labelledby` association | Composite accessible field | `aria-labelledby -> control` | Current selector-engine bounded-field/accessibility path should emit this proof; add explicit selector-engine-native coverage if needed | `bounded-field.spec`, `playwright-evaluator.spec` | Add one pipeline validation case | Partial-strong | Low | Confirm selector-engine-native proof emission |
| Simple direct attribute selector | `data-testid`, stable `id`, placeholder | `direct evidence -> validation` | Current selector-engine direct/preference path emits direct winners in live recordings | `playwright-candidates.spec`, `playwright-evaluator.spec`, `resolver.spec` | Seen in live decisions such as `#srcinput` and ARIA-label wins | Strong | Low | Add explicit selector-engine-native direct evidence regression if missing |
| Role plus accessible name | Button, link, option | `role/name proof -> validation` | `selector-engine.preference-tiers` plus accessibility proof path | `playwright-evaluator.spec`, `selector-strategy-stress.spec` | Seen in live Redbus link and combobox decisions | Strong | Low | Keep as semantic benchmark |
| Repeated native fields with bounded container | Duplicate labels but locally scoped field | `label -> bounded container -> control` | `selector-engine.bounded-field-bridging` | `bounded-field.spec` | Add one end-to-end persistence check | Strong | Medium | Re-test across non-form wrappers |
| Repeated custom dropdown triggers | OrangeHRM `User Role` and `Status` | `field label -> field container -> trigger` | `selector-engine.label-context`, `selector-engine.bounded-field-bridging` | `resolver.spec` historical compatibility rows | Validated in OrangeHRM recordings; keep pipeline validation | Strong in fixture | Medium | Validate on more than one UI library |
| False label carry-through prevention | Inner value text or icon inherits wrong label | `canonical child -> raw trigger scope -> correct label proof` | `selector-engine.label-context` | Legacy compatibility references only | Validated in OrangeHRM-style recordings | Strong in fixture | Medium | Add one non-OrangeHRM equivalent fixture |
| Broad container with multiple trigger-like controls | Shared wrapper with two dropdowns | `fail closed when no single control binding exists` | `selector-engine.label-context`, `selector-engine.bounded-field-bridging` | `snapshot-selector.policy.spec` downstream expectation | Validate blocked reason persists in pipeline | Strong | Low | Preserve fail-closed behavior |
| Option panel with linked trigger | Listbox or menu item with unique scoped option | `trigger -> panel -> option` | `selector-engine.option-panel-context`, `selector-engine.preference-tiers` | Historical read-side grouped option/menu expectations | Validate at least one live detached panel case | Partial-strong | Medium | Add more detached panel fixtures |
| Duplicate option text in one panel | Same option label repeated | `trigger -> panel -> option + uniqueness proof` | `selector-engine.option-panel-context`, `selector-engine.preference-tiers` | Legacy compatibility references only | Validate blocked vs last-resort behavior in pipeline | Partial | High | Define acceptable blocked vs fallback policy |
| Same option text across multiple panels | Multiple open or detached panels | `active trigger -> active panel -> option` | Current selector-engine-native coverage is weak | Legacy references do not solve ownership | Redbus logs show failure and multi-panel ambiguity | Weak | High | Build new active-panel ownership abstraction in selector-engine path |
| Identical multi-panel state | Two datepickers open simultaneously, both showing day `15` | `active trigger -> strict active panel binding -> option` | New selector-engine-native multi-panel state coverage is missing | Legacy multi-panel ambiguity logs | Explicit pipeline validation of failure vs fallback | Missing | Critical | Build active-panel ownership abstraction |
| Autocomplete input with suggestion list | Redbus source and destination city pickers | `active input -> active suggestion panel -> chosen option` | New selector-engine-native coverage missing | Legacy compatibility references may exist for related heuristics, but not as source of truth | Live Redbus logs show unresolved `[role="option"]` fallback and duplicate/multi-panel ambiguity | Missing | Critical | Add new control family and proof model |
| Custom select emitted as action chain | Trigger click then option select | `trigger selector` then `option selector` | Philosophy supports it; current selector-engine path only partially models it | Historical consumer expectations may exist, but should not invent proof | Validate event model and GenerationContext consumption | Partial | High | Make action-chain output first-class in selector-engine/data-pipeline path |
| Hover-generated transient DOM | Tooltips or menus that only exist in DOM during strict coordinate hover | `trigger -> hover intent proof -> transient target` | Current selector-engine-native hover/transient coverage is weak | Historical action-chain consumer expectations | Validate whether `activeElement` and event timing capture fast enough | Weak | Medium | Define action-chain requirement for hover-to-reveal |
| Menu groups with repeated option labels | Same text in different menu sections | `group/menu context -> option` | New selector-engine-native grouped-option proof coverage is missing or thin | `resolver.spec` has historical grouped-menu compatibility cases | Need live/pipeline validation | Partial | Medium | Add selector-engine-native grouped-option proof and pipeline validation |
| Table row actions with unique row identity | Delete/Edit in unique row | `table -> row identity -> action` | `selector-engine.table-row-context`, `selector-engine.preference-tiers` | `resolver.spec` historical row-action compatibility cases | Add one live table validation case | Strong | Medium | Keep as structured proof benchmark |
| Table row actions with duplicate row identity | Same name repeated in table | `table -> row identity -> action -> positional fallback or block` | `selector-engine.table-row-context`, `selector-engine.preference-tiers` | Historical compatibility references exist | Need explicit pipeline validation of blocked/fallback policy | Partial | High | Resolve policy and make expected behavior explicit |
| Virtualized DOM / infinite scroll | AG Grid, React Virtualized target node does not exist in DOM until scrolled | `container proof -> virtualized metadata/state -> target` | New selector-engine-native virtualized-state coverage is missing | Legacy read-side scrolling workarounds | Add one pipeline validation case using AG Grid or equivalent | Missing | Critical | Design capture for virtualized container state |
| Calendar/date picker scoped actions | Date field, year choice, calendar icon | `calendar context -> year/date/icon target` | New selector-engine-native calendar proof family is missing | `resolver.spec` contains legacy calendar compatibility coverage | Live Redbus trigger resolution exists, but full calendar proof family is not validated | Missing | Medium | Add selector-engine-native calendar scenario family |
| Hidden vs visible duplicates | One visible, one hidden | `candidate validation -> visible uniqueness` | Current selector-engine decisions emit `visibleMatchCount`, but selector-engine-native coverage should be made explicit | `playwright-evaluator.spec`, `resolver.spec` visibility references | Add one pipeline validation case | Partial-strong | Low | Add selector-engine-native visible/hidden ambiguity test |
| Visually hidden but DOM interactable | Element has `opacity: 0` or `left: -9999px` but still accepts events | `semantic identity -> reject hidden -> fallback or block` | Current selector-engine visibility coverage is partial | `snapshot-selector.policy.spec` visibility references | Validate false-positive prevention | Strong | Low | Maintain strict anti-false-positive gate |
| Transient z-index overlays | Transparent loading mask or undismissed toast intercepts the click | `target proof -> validate visual interactability vs DOM pointer-events` | New selector-engine-native obscured-target coverage is missing | Historical element-obscured timeout errors | Add one live blocked or degraded case | Missing | Medium | Emit explicit blocked diagnostic for obscured targets |
| Broad text without real field structure | Parent text looks like a label | `reject weak text-as-label proof` | `selector-engine.label-context`, bounded-field fail-closed behavior | `snapshot-selector.policy.spec`, `playwright-evaluator.spec` | Add one blocked live case | Strong | Low | Keep as anti-false-positive gate |
| Weak class-only selectors | Utility or hashed classes | `weak direct -> fallback only` | Current selector-engine scoring path should emit this behavior, but selector-engine-native coverage is lighter than desired | `resolver.spec`, `selector-strategy-stress.spec` | Validate one live class-only fallback case | Partial | Medium | Add explicit selector-engine-native class-risk coverage |
| Generated or unstable IDs | HeadlessUI, UUID-like, runtime IDs | `penalize but do not blindly reject` | New selector-engine-native coverage is missing or thin | `resolver.spec` contains strong historical regression references | Add one live/pipeline validation case if available | Partial | Medium | Decide how much unstable-ID policy should move into capture-time proof |
| Link actions with href and text | Navigation cards or links | `href + accessible name + scoped container if needed` | Current selector-engine path is validated by live `Train tickets` style wins | `resolver.spec` legacy compatibility references | Already seen in Redbus live logs | Strong | Low | Keep as semantic/direct hybrid benchmark |
| Stale DOM node replacement | React replaces the DOM node between `mousedown` and `mouseup` events | `semantic identity proof -> late-binding resolution` | Current selector-engine-native stale-node coverage is weak | `playwright-evaluator.spec` historical retry and late-binding references | Needs live validation on a heavy React app | Weak | High | Validate whether record-time proof survives node recreation |
| Closed Shadow DOM retargeting | Click inside `<custom-login>` bubbles as the host element | `shadow host -> explicit composedPath() capture -> internal target` | New selector-engine-native closed-shadow coverage is missing or partial | Legacy shadow-piercing compatibility references | Add pipeline validation for closed vs open shadow roots | Weak | High | Ensure interceptor captures `composedPath()` explicitly |
| Cross-origin secure iframes | Stripe or PayPal secure credit card input | `parent context -> iframe boundary -> in-frame semantic evidence` | Current selector-engine-native cross-origin iframe proof is weak | Legacy iframe traversal fallbacks | Validate iframe frame-tree context preservation | Partial | High | Explicitly mark proof as boundary-limited |
| Selector decision persistence for stronger field proof | Record-time weak local view, richer preserved decision later | `selector decision emitted -> pipeline preserved -> GenerationContext consumes` | New selector-engine/data-pipeline validation needed | `snapshot-selector.policy.spec` is a downstream historical reference | Not yet formalized as selector-engine-native pipeline validation | Partial | Medium | Add selector-decision persistence validation harness |
| Shadow / degraded target handling | Target missing but intentionally degraded | `explicit degraded status -> preserved diagnostics` | Selector-engine should emit explicit blocked/degraded diagnostics; coverage needs strengthening | `snapshot-selector.policy.spec` historical reference | Needs pipeline preservation validation | Partial | Medium | Keep explicit diagnostics and avoid overclaiming proof |
| Desktop wrapper focus disruption | Electron or OS-level blur destroys transient web popup before capture | `explicit degraded status -> preserved diagnostics` | New selector-engine-native desktop-wrapper coverage is missing | None | Test against Electron wrapper app | Missing | Medium | Acknowledge wrapper constraints and fail cleanly |

## Highest-Priority Gaps

## Tagged Test Inventory

### Primary selector-engine test tagging

These files are the primary ownership layer for current selector behavior.

| Primary Test File | Tagged Scenario Families | Ownership Note |
|---|---|---|
| `core/__tests__/selector-engine.label-context.spec.ts` | Native input with `label[for]`; repeated custom dropdown triggers; false label carry-through prevention; broad container with multiple trigger-like controls | Primary owner for label binding, custom-trigger label recovery, and fail-closed repeated-trigger behavior |
| `core/__tests__/selector-engine.bounded-field-bridging.spec.ts` | Repeated native fields with bounded container; repeated custom dropdown triggers; broad text without real field structure; bounded fallback generation across wrapper shapes | Primary owner for proof-to-selector bridging and renderable-scope blocking |
| `core/__tests__/selector-engine.option-panel-context.spec.ts` | Option panel with linked trigger; menu groups with repeated option labels; duplicate option text in one panel | Primary owner for option/menu/listbox proof extraction and duplicate-option blocking |
| `core/__tests__/selector-engine.preference-tiers.spec.ts` | Simple direct attribute selector; role plus accessible name; repeated custom dropdown trigger ranking; option-panel ranking; duplicate option text in one panel; table row actions with unique and duplicate row identity; weak class-only selectors | Primary owner for selector/proof prioritization policy and replay-safe demotion rules |
| `core/__tests__/selector-engine.table-row-context.spec.ts` | Table row actions with unique row identity; table row actions with duplicate row identity | Primary owner for row identity proof, partial proof, positional fallback, and fail-closed row blocking |
| `core/__tests__/selector-engine.accessibility-proof.spec.ts` | Role plus accessible name; wrapped label/control semantics; canonical descendant semantics | Primary owner for modular accessibility proof and raw-vs-canonical semantic selection |
| `core/__tests__/selector-engine.canonical-target.spec.ts` | Repeated custom dropdown triggers; broad container with multiple trigger-like controls | Primary owner for canonical target selection inside custom control shells and fail-closed descendant ambiguity |

### Legacy / read-side compatibility tagging

These files are useful references and downstream expectations. They are not current selector-engine ownership.

| Legacy / Read-Side File | Tagged Scenario Families | Usage Boundary |
|---|---|---|
| `packages/codegen/__tests__/bounded-field.spec.ts` | Native input with `label[for]`; wrapped label control; `aria-labelledby` association; repeated native fields with bounded container; broad container with multiple trigger-like controls; repeated custom dropdown triggers | Historical bounded-field regression reference and downstream consumer expectation |
| `packages/codegen/__tests__/playwright-candidates.spec.ts` | Simple direct attribute selector; role plus accessible name; native label scenarios; repeated native fields with bounded container | Historical candidate-generation reference only |
| `packages/codegen/__tests__/playwright-evaluator.spec.ts` | Simple direct attribute selector; role plus accessible name; hidden vs visible duplicates; duplicate role/name ambiguity; broad text without real field structure; option text validation | Historical evaluation reference, not selector-engine ownership |
| `packages/codegen/__tests__/selector-strategy-stress.spec.ts` | Simple direct attribute selector; role plus accessible name; volatile text; duplicates; weak class-only selectors; hidden and non-actionable elements; `aria-labelledby` combinations | Historical stress reference for semantic risk patterns |
| `packages/codegen/__tests__/snapshot-selector.policy.spec.ts` | Selector decision persistence for stronger field proof; shadow/degraded target handling; broad text without real field structure; broad container with multiple trigger-like controls; hidden vs visible duplicates | Downstream pipeline/consumer expectation reference |
| `packages/codegen/__tests__/resolver.spec.ts` | Repeated custom dropdown triggers; menu groups with repeated option labels; table row actions; calendar/date-picker scoped actions; weak class-only selectors; generated or unstable IDs; link actions with href and text; hidden vs visible duplicates; autocomplete-like heuristics; shadow evaluation metadata | Legacy resolver-era compatibility and historical regression reference only |

### Current primary-coverage gap summary

The following scenario rows still do **not** have strong selector-engine-native primary coverage and should be treated as active gaps:

- same option text across multiple panels
- identical multi-panel state
- autocomplete input with suggestion list
- custom select emitted as action chain
- hover-generated transient DOM
- menu groups with repeated option labels
- virtualized DOM / infinite scroll
- calendar/date picker scoped actions
- visually hidden but DOM interactable
- transient z-index overlays
- stale DOM node replacement
- closed Shadow DOM retargeting
- cross-origin secure iframes
- selector decision persistence for stronger field proof
- shadow / degraded target handling
- desktop wrapper focus disruption

### What the tagging pass tells us

1. The current selector-engine path already has meaningful primary coverage for:
   - label-context proof
   - bounded-field bridging
   - option/menu/listbox proof
   - table row proof
   - selector/proof prioritization
   - modular accessibility proof
   - canonical custom-control targeting

2. The biggest uncovered surface is not basic field labeling anymore.
   It is transient, detached, virtualized, multi-surface, or boundary-limited UI.

3. Legacy/read-side tests remain useful, but mostly as:
   - historical references for semantic penalties
   - downstream expectations for consumer behavior
   - compatibility checks while the new path matures

4. The next selector-engine-native test work should focus on:
   - active panel ownership
   - autocomplete action chains
   - calendar/date-picker proof
   - visibility/interactability degradation
   - boundary cases like Shadow DOM, iframes, virtualization, and wrapper disruption

### P0-A

- autocomplete and suggestion-panel ownership
- multiple detached or simultaneously valid option panels
- action-chain representation for transient controls

These are the biggest blockers because they directly affect current Redbus and autocomplete replay-readiness.

### P0-B

- virtualized DOM and infinite-scroll state capture

This is also critical, but it is likely a separate abstraction track from the current autocomplete and transient-panel failures.

### P1

- table-row positional fallback policy clarity
- calendar/date-picker proof family
- menu and grouped-option proof parity in the current selector-engine path
- stale DOM node replacement and late-binding safety
- closed shadow DOM retargeting with explicit `composedPath()` capture

### P2

- broader validation of repeated custom triggers outside OrangeHRM
- more detached popup fixtures from other UI libraries
- stronger selector-engine-native coverage for weak classes and unstable IDs
- cross-origin iframe boundary diagnostics
- obscured-target and desktop-wrapper degraded-state handling

## Immediate Test Campaign

### Phase 0: Proof Context Availability Audit

Purpose:

- inspect current interceptor, event, and data-pipeline payloads
- identify which bounded proof fields are already captured
- identify which proof fields are missing
- identify which fields are record-time critical
- identify which fields are safely derivable later
- define the minimal proof-context packet AIR needs
- make no code changes yet

This phase exists to confirm what proof context AIR actually has before any selector-engine expansion work begins.

### Phase A: Inventory and Tagging

Tag every relevant test into one of three buckets:

- primary current selector-engine coverage
- legacy/read-side compatibility reference
- live/pipeline validation

Outputs:

- scenario family
- primary selector-engine test files
- legacy compatibility references
- whether current selector-engine-native coverage is strong, partial, or missing

### Phase B: Live-Site Replay Set

Create a small live validation pack with:

- OrangeHRM repeated dropdowns
- OrangeHRM duplicate labels and custom triggers
- SauceDemo stable semantic controls
- Redbus source autocomplete
- Redbus destination autocomplete
- Redbus date selector
- one menu-heavy app
- one table-heavy app

For each scenario, capture:

- was record-time evidence captured?
- was a selector decision emitted?
- what `proofSource` or `blockedReason` was emitted?
- was the selector decision preserved in the AIR pipeline?
- did GenerationContext receive selector decision data from the pipeline without synthesizing missing selector proof?
- can Algorithm v1 later shadow-compare the case?

### Phase C: Gap Classification

For every live failure, classify it as one of:

- missing control-family classification
- missing proof object
- missing container/panel binding
- missing action-chain representation
- ranking issue
- validation issue
- pipeline persistence issue
- intentionally blocked ambiguity

### Phase D: Reference Cross-Check

Only after the matrix is stable:

- inspect SelectorHub for missed locator categories
- inspect Playwright for locator-family and evaluator expectations

The purpose here is to find coverage gaps, not to copy logic.

## Exit Criteria Before Major Implementation

Do not start broad selector-engine expansion until:

1. Every primary selector-engine test is tagged into the matrix.
2. Legacy/read-side references are tagged separately and clearly marked as non-owning.
3. OrangeHRM, SauceDemo, and Redbus live scenarios are represented as named scenario rows.
4. We can state which failures are true bugs vs intended blocked ambiguity.
5. We have a written decision on whether transient controls emit one selector or an action chain.
6. We have validated at least one pipeline persistence path for each P0 scenario family.
7. We have identified the first missing selector-engine abstraction to implement generically.

## Recommended Next Technical Decision

After the Proof Context Availability Audit is complete, the most likely first abstraction to build is:

`active field/input -> active popup or suggestion panel -> selected option`

Why this first:

- it directly addresses the Redbus failure
- it generalizes beyond Redbus
- it fits the AIR philosophy of proof first, then small candidate generation
- it belongs naturally to the current selector-engine / Algorithm v1 path
- it avoids overfitting to OrangeHRM-specific DOM structure

This is not the immediate next task. The immediate next task remains the non-coding Proof Context Availability Audit.

## Staff SDET Recommendation

The right move now is not to immediately code against Redbus.

The right move is:

1. Lock the architecture boundary
2. Run the Proof Context Availability Audit
3. Tag existing primary selector-engine tests
4. Tag legacy/read-side references separately
5. Add 5-10 live scenario rows from current recordings
6. Validate record-time evidence, emitted selector decision, pipeline preservation, and GenerationContext consumption boundaries
7. Confirm the first missing abstraction
8. Then implement the smallest generic fix with regression coverage

That will give AIR a testable, scalable path instead of a site-by-site patch cycle.

## Current Freeze Point

Do not start implementation from this matrix yet.

The next non-coding step remains:

`Proof Context Availability Audit`
