# AIR LLM Onboarding

This document is the canonical onboarding context for a new LLM reviewing or extending AIR.

It is intentionally opinionated. It describes both the AIR vision and the current implementation phase without blurring future roadmap into present-day truth.

## Persona

Act like a Principal / Senior Staff Engineer reviewing a production-grade test recording and code generation platform.

- Be direct. Do not sugarcoat brittle ideas.
- Stress-test for silent failure, telemetry pollution, state mutation, and misleading proof.
- Assume hostile real-world apps: dynamic classes, unstable IDs, iframes, shadow DOM, React unmounts, portals, partial payload loss, and narrow snapshots.
- Prefer small, correct, future-compatible changes over large speculative redesigns.

## AIR Vision

AIR is not a dumb selector recorder.

AIR is an evidence-driven intent capture engine:

1. Capture a portfolio of candidate selectors and target evidence at interaction time.
2. Persist that evidence safely across the backend boundary.
3. Validate candidates later against persisted snapshot truth and same-target identity proof.
4. Emit one clean deterministic locator.
5. Preserve alternates in sidecar/debug evidence for future healing, not as blind runtime fallback chains.

Important: a broader "interaction evidence capsule" is a future direction, not the current required contract.

## Non-Negotiable Engineering Principles

1. Persisted evidence proof beats capture-time heuristics.
2. Do no harm. If proof is missing, reject promotion and degrade safely.
3. Emit one selector. Never emit runtime try/catch selector cascades.
4. Do not mutate the live app DOM. AIR uses serializer-only target identity stamping.
5. Fail fast at the schema boundary. Malformed payloads are dropped early.
6. Do not rewrite legacy selector parity casually. Capture-time generation, resolver-time validation, and codegen-time selection are intentionally separated.
7. AIR must not become CSS-biased. Strong semantic or test-id evidence beats structural CSS.

## Current Truth

As of the current migration phase:

- `selectorCandidates` are captured in the interceptor and preserved downstream.
- `targetNodeId` / `data-air-node-id` truth exists from Ticket 3D.
- DX-1A backend diagnostics JSONL is implemented and dev-only.
- 4B Phase 1 is the current promotion scope.
- Structural candidate promotion is not enabled yet.
- Playwright-native candidates are advisory / sidecar-only today.
- Option D bounded snapshot root policy is a later prerequisite for structural promotion, not part of current 4B Phase 1.

## Current Pipeline

### Stage 1: Browser Capture / Interceptor

#### 1. Target Identity Capture

- Normalize `#text` targets to an owning `Element`.
- Coordinate target identity without mutating live DOM.
- Inject `data-air-node-id` into serialized snapshot HTML only.
- Emit `fingerprint.targetNodeId` and related status/source evidence when capture succeeds.

#### 2. Selector Portfolio Capture

- Capture a candidate portfolio, capped at 8.
- Direct families:
  - `test-id`
  - `id`
  - `name`
  - `href`
  - `aria-label`
  - `placeholder`
- Structural families:
  - `parent-scoped-css`
  - `tight-container-css`
- Weak/report-heavy families:
  - `class`
  - `text`
  - `role-attr`
  - `primary`
  - `xpath`
- Persist candidate metadata such as:
  - `matchCount`
  - `visibleMatchCount`
  - `positionInAllMatches`
  - `positionInVisibleMatches`
  - `warningCodes`
  - `usesDynamicClass`
  - `usesIndex`

Important:

- Capture-time counts are evidence, not final proof.
- Do not treat live DOM uniqueness as sufficient for selector promotion.
- `test-id` family includes stable test attributes such as `data-testid`, `data-cy`, and `data-qa`.

#### 3. Snapshot Capture

- AIR persists event-local and related snapshot sources already used elsewhere in the pipeline.
- Current 4B Phase 1 does not require Option D snapshot-root tightening.
- Snapshot-root tightening belongs to the later structural phase.

### Stage 2: Backend Ingestion / Contract

#### 4. Zod Schema Boundary

- `event.id` is required and must pass schema validation.
- Malformed payloads fail at intake.
- Optional target identity fields remain backward-compatible for older events.

#### 5. Graph / Codegen Normalization

- Preserve `fingerprint.selectorCandidates`.
- Preserve `fingerprint.targetNodeId`.
- Mirror `targetNodeId` onto `CodegenStep.targetNodeId`.
- Preserve snapshot and source-node context used by resolver/codegen.

## Current 4B Phase 1 Scope

4B Phase 1 is intentionally narrow.

It is not a general selector tournament across all families.

### Strong Original Gate

If the original/current selector is already strong by policy, AIR may keep it without attempting a captured-candidate replacement.

This is different from upgrading a weak selector.

### Promotion Gate for Weak/Blocked Originals

If AIR is trying to replace a weak or blocked original selector, promotion requires proof.

If any of the following is missing, reject promotion:

- selected snapshot/context
- `targetNodeId`
- candidate uniqueness/visibility proof in that snapshot
- same-target proof via `data-air-node-id`

Visibility note:

- JSDOM visibility is only a static approximation.
- When browser-captured `visibleMatchCount` exists, use it as a cross-check against snapshot validation and reject contradictory cases instead of trusting JSDOM-only visibility blindly.

### 4B Phase 1 Allowed Families

Only these captured direct families may win:

- `test-id`
- `id`
- `name`
- `href`
- `aria-label`
- `placeholder`

### 4B Phase 1 Blocked / Report-Only Families

These must not be promoted in Phase 1:

- `primary`
- `class`
- `text`
- `role-attr`
- `parent-scoped-css`
- `tight-container-css`
- `xpath`
- Playwright-native candidates

### Hard Blocks

Reject promotion when any of these apply:

- multiple visible matches
- invalid selector
- target not present in matches
- target identity mismatch
- candidate resolves without matching `data-air-node-id`
- candidate fails backend entropy / blacklist stability checks, such as dynamic IDs like `ext-gen-123` or hashed/randomized identifiers
- `usesDynamicClass`
- `usesIndex`
- unresolved shadow/iframe dependency

### Ranking Policy

Within the allowed direct families, prefer:

1. `test-id`
2. `id`
3. `name` / `href`
4. `aria-label` / `placeholder`
   These are weaker than test IDs and stable names, and should carry an i18n / localization warning when emitted as the selected winner.

Structural ranking is a later phase.

## Later Structural Phase

This is future scope, not current 4B Phase 1 behavior.

### Option D / Bounded Snapshot Root Policy

When AIR enables structural promotion, the event-local snapshot root should prefer a bounded tight-container root when it is safe and available.

Guardrails:

- do not escalate to full-page capture for every action
- do not promote broad form/page roots casually
- skip detached/shadow/cross-frame/too-large/too-broad cases gracefully

### Structural Promotion

Only after bounded structural proof exists should AIR consider:

- `parent-scoped-css`
- `tight-container-css`

Even then, structural selectors still require:

- bounded snapshot proof
- unique visible resolution in that bounded proof context
- same-target `data-air-node-id` confirmation

## Codegen And Sidecar

### Codegen

- Emit one selected locator.
- Do not emit `data-air-node-id` as a user-facing locator.
- Do not emit blind fallback chains.
- Preserve safe weak fallback behavior when no promotion is proven.

### Sidecar

Use sidecar metadata to preserve evidence, not to justify unsafe runtime behavior.

Examples of appropriate sidecar/debug evidence:

- recorded selector candidates
- rejection reasons
- proof level / validation outcome
- alternate candidates for future healing
- Playwright-native advisory candidates

Important:

- Playwright-native candidates are not final emitted winners yet.
- `getByRole` / `getByLabel` / `getByPlaceholder` / `getByTestId` advisory evidence may exist, but must not be promoted unless a future ticket explicitly enables that path.

## Observability

DX-1A diagnostics are dev-only and non-authoritative.

- Backend env flag gated
- JSONL output per committed interaction
- compact summary only
- no full snapshot HTML by default
- no sensitive raw input values

Diagnostics help humans inspect capture health. They do not participate in selector promotion logic.

## Architectural Do / Don't

### Do

- challenge missing proof
- separate current behavior from future roadmap
- keep 4B Phase 1 narrow
- prefer direct semantic/test-id evidence over CSS
- treat structural CSS as later, not default
- preserve selector parity unless a safety fix is semantics-preserving

### Don't

- do not rewrite `generateOptimalSelector()` priority semantics casually
- do not promote captured candidates from live-DOM hints alone
- do not treat narrow snapshot uniqueness as global proof
- do not emit runtime selector cascades
- do not mutate the live app DOM
- do not assume CSS is the primary AIR strategy
- do not overstate future Option D / structural work as already implemented

## Review Posture For Future Prompts

When reviewing a ticket or architecture proposal:

1. Ask what is current truth vs future intent.
2. Ask where proof actually comes from.
3. Ask what happens when snapshot or target identity is missing.
4. Ask whether the change breaks selector parity or generated TypeScript output.
5. Ask whether the proposal silently increases CSS bias or runtime fragility.
6. Prefer the smallest correct ticket that preserves future compatibility.
