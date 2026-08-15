# AIR Codebase Gap Analysis
### Updated: 2026-08-16 — Second-Pass Verification + New Gaps Added
### Where the Codebase Is Today vs. What Each Phase Needs
### Based on Direct Code Inspection — No Assumptions

---

## Codebase Architecture Map (Confirmed from Source)

```
E:\Air Desktop\
│
├── interceptor\interceptor.js                (3,529 lines — the recorder)
│
├── core\
│   ├── types\
│   │   ├── events.ts                        (AIREvent discriminated union — 12 event types)
│   │   ├── generation.ts                    (GenerationContextV1, GenerationStepV1 — the public LLM contract)
│   │   ├── graph.ts                         (GraphNode, GraphEdge, Outcome, Session, PendingAction)
│   │   ├── fingerprint.ts                   (ElementFingerprint, CapturedSelectorCandidate)
│   │   └── edge-cases.ts / context-driver.ts
│   ├── graph\
│   │   ├── graph-builder.ts                 (1,043 lines — the event → graph orchestrator)
│   │   ├── state-engine.ts                  (134 lines — deterministic state hashing + Jaccard similarity)
│   │   ├── intent-detector.ts               (119 lines — semantic intent from fingerprint)
│   │   ├── session-manager.ts               (session + tab-state pointer)
│   │   └── handlers\ (baseline, action, outcome handlers)
│   ├── db\
│   │   ├── migrations.ts                    (420 lines — full SQLite schema + 20+ migrations)
│   │   └── repositories\                   (node, edge, event, session, outcome, pending-action repos)
│   ├── platform-server.ts                   (1,124 lines — HTTP server + REST routes)
│   └── event-server.ts                      (1,777 lines — core event ingestion)
│
├── packages\
│   ├── codegen\src\
│   │   ├── codegen.service.ts               (2,583 lines — the compressor)
│   │   ├── generation-builder.ts            (639 lines — the context builder)
│   │   ├── selector-resolver.ts             (4,511 lines — the 12-class resolver)
│   │   ├── runtime-schemas.ts               (151 lines — the wire schema)
│   │   ├── assertion.stub.ts                (45 lines — Phase 2 stub)
│   │   ├── flow-review.service.ts           (279 lines — review DTO)
│   │   ├── types.ts                         (primary data contracts)
│   │   └── smoke\
│   │       ├── smoke-classifier.ts          (95 lines — FAILURE CLASSIFIER)
│   │       ├── smoke-runner.ts              (289 lines — runs Playwright)
│   │       ├── smoke-repair.ts              (13KB — repair suggestions)
│   │       └── smoke-kpi.ts                 (11KB — metrics by warningCode)
│   │
│   ├── mcp-server\src\tools\
│   │   ├── get-session-generation-context.ts (145 lines — the LLM entry point)
│   │   ├── get-session-flow-review.ts
│   │   └── list-recorded-sessions.ts
│   │
│   └── vscode-extension\src\
│       └── extension.ts                     (906 lines — orchestrator)
```

---

## ★ NEW: Inter-Layer Contract Verification

### The Full Data Flow (Confirmed from Source)

```
BROWSER                        SERVER (core)                     LLM / MCP
──────                         ─────────────                     ─────────

interceptor.js                 event-server.ts                   mcp-server/tools/
  emits AIREvent               → validates w/ AIREventSchema          get-session-generation-context.ts
  (12 types)                   → GraphBuilder.processEvent()      → returns GenerationContextV1
                               → StateEngine.generateStateSignature()
                               → Writes to SQLite:
                                   nodes, edges, events,
                                   outcomes, pending_actions,
                                   interaction_contexts
                               ↓
                               codegen.service.ts
                                   reads SQLite
                                   → buildGenerationContext()
                                   → deriveGenerationContext()
                                   → SelectorResolver.resolve()
                                   → returns GenerationContextV1
```

### Contract 1: Interceptor → Server (AIREvent Wire Contract)

**Defined in:** `core/types/events.ts` (Zod discriminated union)

The server accepts exactly 12 event types as a Zod discriminated union on `type`:

| Event Type | Schema | Key Payload |
|---|---|---|
| `click` | `ClickEventSchema` | fingerprint, seek, pageSnapshot |
| `input` | `InputEventSchema` | fingerprint, trigger (blur/change/input:progress), inputLength |
| `outcome` | `OutcomeEventSchema` | meta.settleType, meta.urlAfter, pageSnapshot |
| `custom-control-open` | `CustomControlOpenEventSchema` | controlFamily, triggerFingerprint |
| `custom-select` | `CustomSelectEventSchema` | selection.{label, value, index}, triggerFingerprint |
| `custom-menu-select` | `CustomMenuSelectEventSchema` | selection, controlFamily |
| `spa-route-change` | `SpaRouteChangeEventSchema` | navigation.{from, to, domDiff} |
| `submit` | `SubmitEventSchema` | meta.{formId, eventType} |
| `scroll` | `ScrollEventSchema` | scroll.{x, y, deltaY}, seek |
| `hover` | `HoverEventSchema` | meta.{domChanged, nodesAdded, nodesRemoved} |
| `network` | `NetworkEventSchema` | network.{transport, method, url, status} |
| `custom` | `CustomEventSchema` | payload (freeform) |

**CONTRACT HEALTH: ✅ TIGHT.** The interceptor emits exactly these shapes. The server validates them with Zod at ingestion. No implicit coercions or loose `any` casts at the boundary.

**CRITICAL FINDING:** `InputEventSchema` does NOT have a `followupMutation` field. If Gap #2 (post-input mutation correlation) is added to the interceptor, this schema MUST be updated simultaneously, or the field will be stripped by Zod's strict parsing at the server boundary.

---

### Contract 2: Server → SQLite (Graph DB Schema)

**Defined in:** `core/db/migrations.ts` (420 lines)

Core tables:

| Table | Purpose | Key Columns |
|---|---|---|
| `nodes` | Unique UI states (pages) | `canonical_hash`, `anchors` (JSON), `control_signature`, `normalized_url` |
| `edges` | Transitions between states | `from_node_id`, `to_node_id`, `fingerprint_hash`, `sample_size`, `outcome_type` |
| `events` | Raw event log | `session_id`, `trace_id`, `node_id`, `payload` (JSON), `intent` |
| `outcomes` | Probabilistic edge targets | `edge_id`, `target_node_id`, `probability`, `decayed_count` |
| `pending_actions` | Action awaiting outcome | `trace_id`, `from_node_id`, `status` |
| `interaction_contexts` | Per-URL DOM snapshot | `session_id`, `normalized_url`, `control_signature`, `snapshot_html` |
| `session_tab_state` | Multi-tab pointer | `session_id`, `tab_id`, `last_node_id` |

**CONTRACT HEALTH: ✅ SOLID.** The schema is additive migration-based (21 migrations tracked). All repositories do explicit snake_case → camelCase mapping (`mapNodeRow`, `mapEdgeRow`, etc.) preventing silent field-access failures.

**CRITICAL FINDING: The `edges` table has NO `intent` or `gesture_type` column.** Edges only store `fingerprint_hash` and `outcome_type`. The semantic intent (e.g. `select_Hyderabad`) is stored only in the `events` table, not on the edge. This means graph traversal for "what gesture produces this edge" requires a JOIN through `events`.

**Impact on Phase 2 healing:** When the healer needs to know "what action was at this failing step," it must go: `edge.triggerEventId → events.payload → fingerprint.intent`. There is no shortcut on the edge itself.

---

### Contract 3: SQLite → CodegenService (Internal Session DTO)

**Defined in:** `packages/codegen/src/types.ts` (1,129 lines)

The `CodegenSession` (internal DTO between DB and generation-builder) carries:
- `steps: CodegenStep[]` — enriched steps with selector resolution
- `userAssertions` — currently empty (assertion.stub.ts)
- `metadata` — source info

`CodegenStep` carries a rich set of fields including `selectorResolution` (full 12-class output with `warningCodes`), `fingerprint`, `assertions[]`, `outcomeType`.

**CONTRACT HEALTH: ✅ RICH.** The internal DTO is well-typed. The problem is NOT the schema — it is what gets populated into the schema (the stub assertions, the missing `followupMutation` field).

---

### Contract 4: CodegenService → MCP Tool (GenerationContextV1 — Public LLM Contract)

**Defined in:** `core/types/generation.ts` (230 lines) — **this is the canonical definition**, mirrored in `packages/codegen/src/runtime-schemas.ts`.

> [!IMPORTANT]
> **DUAL DEFINITION RISK:** `GenerationContextV1` / `GenerationStepV1` are defined in BOTH `core/types/generation.ts` and `packages/codegen/src/runtime-schemas.ts`. There is a comment in `runtime-schemas.ts` (line 94, 107, 122) saying "Must stay in sync with core/types/generation.ts." This is a maintenance hazard with NO compile-time enforcement.
>
> **Package boundary confirmed unverified:** The `packages/codegen` package has no dependency on `core/` — its `package.json` lists only `@air/shared`, and `tsconfig.build.json` has an empty `paths: {}`. Making `runtime-schemas.ts` import from `core/types/generation.ts` requires either adding a path mapping or restructuring the package dependency. This was labeled "Low effort" previously. It is **Medium effort** until the boundary is tested. Gap #9 effort updated accordingly.

**`GenerationStepV1` fields that reach the LLM (verified from `runtime-schemas.ts:68`):**
```
stepIndex, eventId, traceId, action, intent, value,
locatorStatus, resolvedTarget, fallbackHints,
selectorResolution, assertions, pageUrl, normalizedUrl,
outcomeType
```

> [!WARNING]
> **`confidence` is NOT in `GenerationStepSchemaV1`.** It exists on the internal `CodegenStep` DTO and is assigned in `codegen.service.ts:1624`. But `runtime-schemas.ts:GenerationStepSchemaV1` does not declare a `confidence` field. When `GenerationContextSchemaV1.parse(context)` runs in `generation-builder.ts:204`, Zod strips it silently. The LLM never sees it. Additionally, the value itself is unreliable: `codegen.service.ts:1574` assigns `edge?.probability ?? 1.0` — meaning steps with no graph edge (first-ever recordings, direct navigations) get `confidence: 1.0`, implying high confidence on completely unvalidated steps. Both problems must be fixed together: add the field to the schema AND fix the fallback logic.

**CONFIRMED MISSING from the public contract (does NOT appear in generation.ts or runtime-schemas.ts):**
- `stepWarnings: string[]` — top-level fragility flag (buried in `selectorResolution.selected.warningCodes`)
- `sequenceFlags` — no cross-step awareness exists in the schema at all
- `followupMutation` — the autocomplete correlation field proposed in Gap #2

---

### Contract 5: MCP Tool Pagination

**Defined in:** `packages/mcp-server/src/tools/get-session-generation-context.ts`

> [!NOTE]
> **Gap #6 previously listed here was WRONG.** Direct code inspection confirms `totalSteps` (line 70, 88) and `hasMore` (line 72, 91) are already fully implemented in the MCP tool. The original gap analysis was incorrect on this point.

Pagination **is** implemented: `offset`, `limit`, `totalSteps`, `hasMore` are all returned. Default 25 steps, max 100.

**What is actually missing** (documented as Gap G and Gap H below):
- `ignoredSteps` is returned as the full unsliced list on every paginated call — never paginated
- The `summary` object has no `fragileStepCount` field

---

## ★ NEW: Graph System Deep Analysis

### What the Graph IS (Confirmed)

The graph is a **live, probabilistic application map** built from every recorded session:

```
Node = unique UI state (identified by anchor hash or HTML hash)
  ↑
  canonical_hash = SHA-256 of sorted page anchors (inputs, buttons, headings, URL path)
  observation_count = how many times this state was visited
  control_signature = hash of interactive elements (stable page fingerprint)

Edge = observed transition between two states  
  ↑
  fingerprint_hash = hash of the element that triggered the transition
  sample_size = how many times this action was observed
  outcome_type = navigation | no_change | state_refresh | immediate_action
  
Outcome = probabilistic target of an edge (with Laplace smoothing on probability)
```

**The graph records EVERYTHING automatically across ALL sessions.** If 10 people record sessions on the same app, the graph has `sample_size=10` on shared edges and `observation_count` updated on shared nodes. This is the "multi-user reinforcement" property.

### The StateEngine — How Nodes Are Identified

**`state-engine.ts` (134 lines, full file read):**

**Strategy A (Primary):** SHA-256 of sorted `anchors[]` array
- Anchors = `URL:pathname`, `INPUT:type=text`, `BUTTON:text=Submit`, etc.
- Completely stable across CSS/DOM restructuring
- Two pages with the same functional elements → same node hash

**Strategy B (Fallback — "Thermonuclear HTML"):**
- Strips scripts, styles, comments, SVGs, Vue/React attrs, CSRF tokens
- Normalizes whitespace and class attribute ordering
- SHA-256 of the cleaned HTML

**Jaccard Similarity** (`calculateSimilarityScore`) compares `contextTokens` (aria-labels, names, roles) between nodes. This exists but is currently **NOT wired to any Phase 2 use case** — it was designed but never used for healing.

### The IntentDetector

**`intent-detector.ts` (119 lines, full file read):**

Converts any AIREvent into a human-readable `intent` string:
```
click_submit_button
type_leaving_from
select_hyderabad
open_city_dropdown
navigate_to_checkout
scroll_down
```

Intent is stored in `events.intent` column but NOT on the `edges` table. This is **Gap #7** (documented below).

### What the Graph Enables (Phase 2 Relevance)

The graph is the **application model** that makes autonomous maintenance possible:

1. **Change Detection:** If a node's `canonical_hash` changes (anchors differ from last recording), the page has structurally changed. The graph knows this BEFORE any test runs.

2. **Flow Discovery:** All recorded paths from page A to page B exist as node → edge → node chains. This is how to find "what is the test flow for checkout?" without reading test code.

3. **Sample-Weighted Reliability:** `edge.sample_size` tells you which flows are well-tested (high sample) vs. recorded once (sample_size=1, high risk of flakiness).

4. **Jaccard Similarity for Probable Healing Target:** If a node's hash changes, `calculateSimilarityScore` can find the most similar surviving node. The old node was page A; the closest surviving node is likely the migrated page A. This enables "the test was going to X; X no longer exists; Y is 87% similar; redirect the test to Y."

### CRITICAL GAP #7 — Graph Has No API Endpoint for the LLM

The graph is built correctly and stored in SQLite. But there is **no MCP tool, no REST route, and no API endpoint** that exposes the graph to the LLM or to the healing system.

Searched `packages/mcp-server/src/tools/` — only 3 tools exist:
- `get-session-generation-context` — returns codegen context for ONE session
- `get-session-flow-review` — returns flow review DTO
- `list-recorded-sessions` — lists sessions

Searched `platform-server.ts` routes — NO `/api/graph`, `/api/nodes`, or `/api/edges` routes exist.

The `nodeRepo.getAll()` and `edgeRepo.getAll()` methods exist in the repositories. But nothing calls them to produce a graph payload.

**What's missing:**
```
Missing MCP Tool A: get_app_graph
  Input: { projectId?, maxNodes?, sessionId? }
  Output: { nodes: [{id, normalizedUrl, anchors, observationCount}],
            edges: [{from, to, intent, outcomeType, sampleSize}] }

Missing MCP Tool B: get_similar_nodes
  Input: { referenceNodeId, threshold: 0.7 }
  Output: { candidates: [{nodeId, similarity, normalizedUrl}] }
  Uses: StateEngine.calculateSimilarityScore()

Missing REST route: GET /api/graph/export
  Returns adjacency list for visualization or Phase 2 blast-radius query
```

**This is the single highest-value missing piece for Phase 2.** Without graph access, the healer cannot:
- Know which pages are affected by a selector change
- Find the new location of a migrated element
- Understand which flows share a broken step

### CRITICAL GAP #8 — Graph → Codegen Contract Is One-Way

The `codegen.service.ts` reads from SQLite (events, interaction_contexts, nodes). But it does NOT read from the graph (nodes + edges + outcomes together).

Specifically, the `GenerationContextV1` given to the LLM contains:
- The steps from the recorded session (events table)
- The selector resolution (12-class resolver output)
- The page URL and anchors per step

But it does NOT contain:
- The graph node ID for each step's page state
- The edge that connects this step to the next state
- Whether this step's target node has been visited `N` times by other sessions
- The probability that this step leads to the expected outcome

**Practical impact:** The LLM generates code without knowing "this button has been clicked 47 times successfully → high confidence" vs "this button was only clicked once during recording → fragile."

The `sample_size` on edges and `observation_count` on nodes are computed but never surfaced to the LLM.

---

## Layer 1: The Interceptor — What It Captures vs. What We Need

### What Exists (Confirmed)

The interceptor at `interceptor.js` already has:

**Event capture (lines 1285-1314):**
```
click  → handleClick()
input  → handleInput() [debounced, emits on blur only]
scroll → handleScroll() [per-container, 30px threshold]
submit → handleSubmit()
blur   → handleBlur() [commits final input value]
change → handleChange() [SELECT + checkbox/radio]
focus  → handleFocus() [opens input session]
hover  → _attachHoverDetection() [MutationObserver, 300ms window]
```

**Custom Dropdown Engine (lines 1758-2132):**

This is significant. The interceptor has a full two-phase custom dropdown engine:
- **Phase 1 (TRIGGER)**: detects aria-haspopup, aria-expanded, known class patterns → fires `custom-control-open`
- **Phase 2 (SELECTION)**: detects option clicks via `role=option`, `OPTION_CLASS_PATTERNS` → fires `custom-select` with label+value+index

Known library patterns already covered:
```
Choices.js, Vue Select, Vue Multiselect, Ant Design, Angular Material,
Angular ng-select, Select2, react-select, Headless UI / Radix,
Bootstrap Select, PrimeNG
```

**Quiescence Engine (lines 32-157):**
- MutationObserver (for DOM stability detection during settling)
- Network counter (fetch + XHR patched)
- Min 3 stable checks at 300ms silence
- NOT linked to event causality — purely used to know when to capture snapshot

**Hover Detection (lines 1320-1385):**
- MutationObserver fires on hover events on buttons/links/LI/TR etc.
- Watches for DOM changes within 300ms of hover
- Records `nodesAdded` and `nodesRemoved`

---

### CRITICAL GAP #1 — Autocomplete Without ARIA/Known Library

**What works:** Custom dropdowns that use `aria-haspopup`, `aria-expanded`, or match known library class patterns are correctly tracked as `custom-control-open` → `custom-select`.

**What breaks:** AbhiBus-style autocomplete inputs where:
1. User types in a plain `<input>` (no `aria-haspopup`)
2. A `<ul>` or `<li>` list appears as a result (no known library class)
3. User clicks an `<li>` item

The interceptor does NOT detect this as a custom dropdown trigger because:
```javascript
// _resolveCustomDropdownTrigger checks:
const hasAriaSignal = popup != null || role === "combobox";
const matchesClass  = AIRInterceptor.TRIGGER_CLASS_PATTERNS.some(p => cls.includes(p));
```
A plain `<input type="text">` has neither `aria-haspopup` nor any trigger class pattern.

The `li` click IS captured as a generic click event. But the causal link between
"typing in the input" and "li appeared" is NEVER recorded. The LLM sees two
disconnected events: an `input` event and a `click` event on an `li`.

**What's missing:**
- A `MutationObserver` triggered by the `input` event that watches for new child elements appearing within 500ms
- If `<ul>` or `<li>` elements appear after an input event on a text field, record this mutation correlation in the `input` event payload as `followupMutation: { type: "list-appeared", listSelector: "...", itemCount: N }`

**Gap location:** `interceptor.js`, `handleInput()` / `_emitInputEvent()` methods (lines 1657-1757)

**Gap size:** MEDIUM. The hook is there (MutationObserver infrastructure exists). Need to add a post-input mutation watch in `_emitInputEvent`.

---

### CRITICAL GAP #2 — No Mutation Correlation on Input Events

Looking at `_emitInputEvent()` (lines 1714-1757), the emitted event contains:
```javascript
{
  type: "input",
  trigger,         // blur | change | input:progress
  fingerprint,
  inputValueMasked: maskedValue,
  inputLength,
  selectedLabel,
  traceId,
  pageSnapshot: subtreeSnapshot  // subtree of the TARGET element
}
```

The `subtreeSnapshot` captures the input field's immediate parent area — but only at the moment the blur/change fires (after the user has already interacted). It does NOT capture:
- What DOM appeared AFTER the user started typing
- Whether a dropdown appeared as a result of the typing
- What options were visible when the user made their selection

**What's missing in the payload:** A `postInputMutations` field that records what appeared in the DOM within 500ms of the first `input` event (not blur) on a text field.

**Gap size:** HIGH IMPACT. This is the root cause of the AbhiBus failure and will affect any application that doesn't use ARIA-annotated or known-library autocomplete.

---

### WHAT INTERCEPTOR GETS RIGHT (Strengths to Preserve)

1. **`custom-control-open` + `custom-select` action types are already emitted** — the codegen pipeline already handles these (see `generation-builder.ts:526`, `actionNeedsTarget` function).

2. **Hover detection with MutationObserver** already fires — the 300ms post-hover DOM mutation watch is the correct pattern. The same pattern needs to be added for input events.

3. **SPA route detection** via `pushState/popstate/hashchange` is fully implemented.

4. **Beacon + stash durability** is solid — events survive page unloads.

5. **`traceId` linking** already connects `custom-control-open` ↔ `custom-select` — the same mechanism can link `input` ↔ `autocomplete-selection`.

---

## Layer 2: The Codegen Pipeline — What It Processes vs. What We Need

### What Exists (Confirmed)

**`generation-builder.ts` — The Context Builder (639 lines)**

This file contains confirmed working:

1. **`actionNeedsTarget()` (line 526)**: knows that `custom-control-open`, `custom-select`, `custom-menu-select` need locators. Already handles the dropdown flow.

2. **`classifyNoiseStep()` (line 238)**: filters `broad_no_change_container_click` and `duplicate_lower_quality_action` out of the replay steps.

3. **`buildGenerationGuidance()` (line 424)**: emits 14 typed rules into every GenerationContext. Current rules include:
   - "Preserve custom-control-open steps; they are required for dropdown and menu visibility before selection."
   - "Map step.action to the semantically correct interaction for the resolved element type"
   - "If resolvedTarget.warningCodes includes 'positional-fallback-only' or 'ambiguous-action-binding', add a one-line comment"
   - "Replace `<LLM_GENERATE_MOCK_DATA>` with safe mock data or environment-backed test data."

4. **`looksLikeConcreteControl()` (line 317)**: already protects buttons, inputs, links from being noise-classified.

5. **`isBroadContainerSelector()` (line 357)**: token-based container classification with conservative token list.

**CRITICAL FINDING:** `warningCodes` ARE already fully plumbed through the type system. `types.ts` has `warningCodes?: string[]` on at minimum 14 different interfaces. The `smoke-kpi.ts` already aggregates failures by `warningCode`. The `SelectorResolutionSchema` (runtime-schemas.ts:24) includes `warningCodes: z.array(z.string()).optional()`.

**BUT:** The `generation-builder.ts` does NOT surface `warningCodes` from `selectorResolution.selected.warningCodes` into the `generationGuidance.rules` in a step-specific way. The rule says "if warningCodes includes X, add a comment" — but this guidance is given as a STATIC rule to the LLM, not as a per-step flag in the GenerationContext step data itself.

**Result:** The LLM has to manually cross-reference each step's `selectorResolution.selected.warningCodes` against the guidance rules. It does not get a step-level `isFragile: true` flag.

> [!IMPORTANT]
> **Gap #0 — Generation Guidance Rules Are Never Updated for New Fields.** `buildGenerationGuidance()` in `generation-builder.ts:424` returns a static, hardcoded list of 14 rules. The current rules say nothing about `followupMutation` (Gap #2), `stepWarnings` (Gap #4), `sampleSize`/`observationCount` (Gap #8), or `sequenceFlags` (Gap #3). When any of these fields ship, the LLM will silently ignore them — it has no instruction for what they mean or what to do with them. **This must be the FIRST thing updated before any schema addition ships.** Every new field needs a corresponding rule added to `buildGenerationGuidance()`.

---

### CRITICAL GAP #3 — No Sequence Awareness Pass

The `get-session-generation-context.ts` MCP tool (145 lines, entire file reviewed) does exactly this:

```typescript
const generationContext = service.buildGenerationContext(parsedArgs.sessionId);
const steps = generationContext.steps.slice(offset, offset + limit);
// → returns steps with pagination
```

The LLM receives paginated steps, not the full sequence. It processes them in batches of up to 100 steps. **There is no pre-generation awareness pass** that:
- Looks at the full step sequence holistically
- Detects that step 1 is an `input` with no follow-up selection step (autocomplete gap)
- Detects that two consecutive steps match an autocomplete pattern
- Generates `sequenceFlags` before code is written

This gap is fundamental. The LLM currently has to figure this out per-step as it generates code. It frequently fails because:
1. Step 1 looks complete by itself (`input` on a text field)
2. The `custom-select` step that should follow is either missing or unrecognised as related

**What's missing:**
- A `sequenceAnalysis` pass in `generation-builder.ts` that runs before `deriveGenerationContext()`
- This pass produces `sequenceFlags[]` attached to each step (or as a top-level field in the GenerationContext)
- The MCP tool returns these flags as part of the context

**Gap size:** HIGH IMPACT. This is the core of Phase 1. The infrastructure (GenerationContext schema, guidance rules) is there — the analytical pass is missing.

---

### CRITICAL GAP #4 — No Step-Level Fragility Flag Surfaced to LLM

`warningCodes` exist in the type system and selector resolution data. But in `generation-builder.ts`, the `mappedStep` (line 156-172) does NOT include a `isFragile` or `warningCodes` field in the final `GenerationStepV1` output.

Looking at `runtime-schemas.ts` (full file reviewed): `GenerationStepSchemaV1` (line 68) does NOT have a `warningCodes` field. The LLM sees `resolvedTarget.classId` and `selectorResolution.selected.warningCodes` buried in nested data, but there is no top-level `stepWarnings: string[]` field.

**What's missing:**
- Add `stepWarnings?: string[]` to `GenerationStepSchemaV1` in `runtime-schemas.ts`
- Populate it in `generation-builder.ts` from `selectorResolution.selected.warningCodes`
- Update `generationGuidance.rules` to reference `stepWarnings` directly (not the buried path)

**Gap size:** LOW effort, HIGH value. Makes fragile selector flagging automatic and visible to the LLM without it having to traverse nested objects.

---

### GAP D — Hover-Revealed Content Ignored

The interceptor captures hover events with a 300ms MutationObserver window recording `nodesAdded` and `nodesRemoved` — this data is in `HoverEventSchema.meta`. The `generation-builder.ts:526` correctly includes `hover` in `actionNeedsTarget()`. The guidance rule at line 451 does say `"hover" means a mouseover/hover interaction`.

**But:** The `generation-builder.ts` never reads `meta.nodesAdded` from a hover step. The LLM receives a hover step with a resolved target but zero information about what the hover revealed — no tooltip text, no dropdown that appeared. It generates `page.hover(selector)` with no wait for revealed content and no assertion on what appeared.

**What's missing:**
- Read `meta.nodesAdded` from hover events in the codegen pipeline
- Surface it as `postHoverMutation: { nodesAdded, nodesRemoved }` on the GenerationStepV1
- Add a guidance rule: "If a hover step has `postHoverMutation.nodesAdded > 0`, add a wait or assertion for the revealed element before proceeding to the next step."

---

### GAP E — `outcomeEffect` Extracted But Never Reaches LLM

`codegen.service.ts:831` has `extractOutcomeEffect(payloadJson)` which parses `payload.outcomeEffect`. It is assigned to `CodegenStep.outcomeEffect` at line 1626. This means the data is extracted from the DB.

**But:** `generation-builder.ts:156-172` — the `mappedStep` object that becomes `GenerationStepV1` does NOT include `outcomeEffect`. It is extracted from the event payload, placed on the internal `CodegenStep`, then silently dropped when the step is mapped to the public contract. `runtime-schemas.ts:GenerationStepSchemaV1` has no `outcomeEffect` field.

**Result:** The LLM has no knowledge that a step opened a new tab, triggered a `window.alert()`, or caused a modal to appear. It generates bare `page.click(selector)` with no `page.context().waitForEvent('page')` for new tab flows or `page.on('dialog')` handler for alerts.

**What's missing:**
- Add `outcomeEffect?: OutcomeEffect` to `GenerationStepSchemaV1`
- Pass it through from `CodegenStep` in `generation-builder.ts:156-172`
- Add guidance rule: "If `step.outcomeEffect.type === 'new_tab'`, use `page.context().waitForEvent('page')` instead of a plain click."

**Gap size:** LOW effort — the data is already extracted. Just needs the mapping and schema addition.

---

## Layer 3: The Smoke System — What Exists vs. What We Need

### What Exists (Confirmed — This Is Significant)

The `packages/codegen/src/smoke/` directory contains **a partially-built failure classification and repair system**. Confirmed capabilities:

**`smoke-classifier.ts` (95 lines):**
Already classifies Playwright failures into:
```
null                → test passed
air_blocked_step    → AIR resolver blocked the step (proof level "blocked")
air_unvalidated_step → AIR resolver unvalidated step
compile_error       → syntax/module error in generated code
locator_ambiguous   → strict mode violation (multiple matches)
navigation_timeout  → URL/navigation related failure
locator_not_found   → element not found (SELECTOR_STALE candidate)
action_timeout      → element found but action timed out
assertion_failure   → expect() assertion failed (NEVER auto-heal)
runtime_unknown     → catch-all
```

**THIS IS THE FAILURE CLASSIFIER WE NEED FOR PHASE 2.** The architecture is already defined. `locator_not_found` maps directly to `SELECTOR_STALE`. `assertion_failure` maps directly to "never auto-heal".

**`smoke-repair.ts` (13KB):**
Already generates repair suggestions for known `warningCodes`:
- `label-context-proof-only` → generates alternative locator strategy
- `custom-control-trigger-target-binding-ambiguous` → generates disambiguation suggestion
- `custom-control-trigger-structural-fallback` → generates structural fix

This is the skeleton of the healing proposal system.

**`smoke-kpi.ts` (11KB):**
Already aggregates `warningCodes` from smoke runs and tracks `failuresByWarningCode`. This is exactly the healing log / pattern database concept from Phase 2.

---

### CRITICAL GAP #5 — Smoke System Is Disconnected from CI Pipeline

The smoke system exists but based on the code, it runs as a **post-generation validation**, not as a **CI-integrated maintenance loop**. There is no:

1. **Trigger mechanism**: No code that watches CI for failures and invokes the smoke classifier on a real failing test
2. **Live page navigation**: The smoke repair system generates suggestions based on recorded data, not on a fresh DOM snapshot of the live page
3. **Locator dependency graph**: No static analysis of which POM files use which locator
4. **Multi-file healing commit**: Smoke repair produces a suggestion but doesn't update files

**What's missing for Phase 2:**

```
MISSING A: Trigger — CI failure → smoke-classifier invoked automatically
           Currently: smoke-runner.ts runs Playwright, classifies result.
           Gap: No webhook/CI hook that triggers this on real failures.

MISSING B: Live micro-snapshot — navigate to failing page, capture area
           around the original element, compute DOM diff.
           Currently: repair uses recorded data only.
           Gap: No "navigate to live page and capture" capability.

MISSING C: Locator dependency graph — which files reference which locators.
           Currently: nothing.
           Gap: Complete new system needed.

MISSING D: LLM healing call — send constrained input, receive locator.
           Currently: smoke-repair.ts generates rule-based suggestions.
           Gap: No LLM call with fingerprint + DOM diff → locator output.

MISSING E: Empirical validation gate — test proposed locator against live page.
           Currently: nothing.
           Gap: Needs Playwright session to validate proposed locator.

MISSING F: Multi-file commit — update POM + healing log atomically.
           Currently: nothing.
           Gap: New file writer needed.
```

**The good news:** A, B, E are buildable on top of the existing `smoke-runner.ts` + `playwright` dependency (already imported in `vscode-extension/src/extension.ts`). C, D, F are new systems.

---

## Layer 4: The Assertion Stub — Phase 2 Ready Hook

`assertion.stub.ts` (45 lines, full file reviewed):

```typescript
/**
 * TODAY: returns empty array. The interceptor has no mechanism yet for
 * the user to mark elements as assertion targets during recording.
 *
 * FUTURE (Phase 2): When the interceptor gains right-click → "Assert this"
 * or a keyboard shortcut to mark elements, those assertions will be stored
 * in a dedicated `user_assertions` table in the DB.
 */
export function getUserDefinedAssertions(...): UserDefinedAssertion[] {
  return []; // Phase 2 stub
}

export function hasUserAssertionSupport(_db: unknown): boolean {
  return false; // Returns false until Phase 2 migration
}
```

**This is the right design.** The schema contract (`CodegenSession.userAssertions`) already exists. The interceptor just needs the right-click mechanism to populate the `user_assertions` table.

For Phase 2 (self-healing with assertion awareness), this means: when the system heals a `locator_not_found` failure, it already knows which steps carry `user_defined` assertions. Those assertion-carrying steps are the ones that must NEVER be auto-healed — they require human review. This is already achievable without changing `assertion.stub.ts` — the assertion source flag (`source: 'user_defined'`) is already in the schema.

---

## Layer 5: The MCP Tool — Entry Point for LLM

`get-session-generation-context.ts` (145 lines, full file reviewed):

The MCP tool currently:
1. Calls `service.buildGenerationContext(sessionId)`
2. Paginates steps (default 25, max 100) — `totalSteps`, `hasMore`, `offset` all returned ✅
3. Returns `steps`, `ignoredSteps`, `generationGuidance`, `summary`

> [!NOTE]
> **Gap #6 (pagination missing `totalSteps`/`hasMore`) is closed.** These fields are fully implemented at lines 70, 72, 88, 91 of the MCP tool. The earlier analysis was wrong.

**What is actually missing from the MCP layer:**

**GAP G — `ignoredSteps` Is Never Paginated**

`steps` is correctly sliced: `generationContext.steps.slice(offset, offset + limit)`. But `ignoredSteps` at line 108 is always returned in full: `generationContext.ignoredSteps ?? []`. On a session with 200 steps and 60 ignored steps, every paginated call returns all 60 ignored steps regardless of the active page. On large recordings this is significant token waste — the LLM receives all context-only steps on every call.

**What's missing:** Apply the same offset/limit slice to `ignoredSteps`, or suppress them after the first page call with a flag like `includeIgnoredSteps?: boolean`.

---

**GAP H — `summary` Has No `fragileStepCount`**

The `summary` object (lines 93-99) returns: `resolvedSteps`, `unresolvedSteps`, `notApplicableSteps`, `assertionCount`, `ignoredStepsCount`. A session with 25 resolved steps but 18 fragile selectors looks identical to one with 0 fragile selectors from the summary alone. The LLM must scan all steps individually to know reliability.

**What's missing:** Add `fragileStepCount: number` to the summary — count of steps where `selectorResolution.selected.warningCodes` is non-empty.

**Gap size:** XS effort. One `.filter()` call in the MCP tool.

---

**GAP B — Production Log Leakage in `codegen.service.ts`**

These `console.error` calls fire on every `buildGenerationContext()` invocation — which is called on every MCP tool call:

```
Line 1662:  console.error('CODEGEN_STEP_MAPPED', { sessionId, step, eventId, traceId, selector, resolvedSelector })
Line 1814:  console.error('[DEBUG] loadSnapshots: jsdomCtor=', ...)
Line 1862:  console.error('[DEBUG] loadSnapshots: parsing error for', ...)
Line 2087:  console.error('[DEBUG] loadSnapshots: nodeId=', ...)
Line 2304:  console.error('[DEBUG] loadSnapshots inventory', ...)
```

These are leftover development-time debug calls. In production they dump `sessionId`, `traceId`, `selector`, and internal snapshot state to stderr on every generation request. **XS effort to fix** — remove or convert to `debugLogger.log()` calls.

---

**GAP C — `wrapWithPrivacy` Is a Label, Not a Redactor**

```typescript
export function wrapWithPrivacy<T>(data: T): { _meta: PrivacyMeta; data: T } {
  return { _meta: { privacy: "This context may contain local DOM excerpts..." }, data };
}
```

This wraps the payload in a `_meta` comment field. It does zero actual scanning or stripping. It does not inspect `step.value` for passwords or emails, does not strip raw HTML from `selectorResolution`.

**Severity is 🟠 not 🔴** because the primary protection happens upstream: the interceptor masks input values with `inputValueMasked` and the `<LLM_GENERATE_MOCK_DATA>` token. `wrapWithPrivacy` was added as a belt-and-suspenders note — it just doesn't do anything. Still worth fixing to avoid false confidence.

---

**What needs to change:** The MCP tool should optionally return a `sequenceAnalysis` field (produced by a new analysis pass in `generation-builder.ts`) that the LLM reads FIRST before iterating through steps for code generation.

```typescript
// PROPOSED addition to the MCP response:
sequenceAnalysis?: {
  flags: SequenceFlag[];          // per-step or cross-step issues
  overallReadiness: 'ready' | 'needs_attention' | 'incomplete';
  patternsSummary: string[];      // human-readable summary of detected patterns
}
```

**Gap size:** MEDIUM effort — new analysis function in `generation-builder.ts` + schema addition in `runtime-schemas.ts` + MCP tool updated to return it.

---

## Complete Gap Registry (Updated — v3, 2026-08-16)

> Gaps marked ✅ are confirmed closed. Efforts marked * are pending verification.

| # | Gap | Phase | Location | Effort | Impact |
|---|---|---|---|---|---|
| **0** | **Guidance rules never updated for new fields — blocks all gaps** | Phase 1 | `generation-builder.ts:buildGenerationGuidance()` | Low | 🔴 Blocks all |
| 1 | ARIA-less autocomplete detection | Phase 1 | `interceptor.js:handleInput()` | Medium | 🔴 Critical |
| 2 | Post-input mutation correlation | Phase 1 | `interceptor.js:_emitInputEvent()` | Medium | 🔴 Critical |
| 2b | `InputEventSchema` missing `followupMutation` field — atomic with #2 | Phase 1 | `core/types/events.ts` | Low | 🔴 Critical |
| **A** | **`confidence` field: Zod-stripped + 1.0 fallback on unvalidated steps** | Phase 1 | `runtime-schemas.ts` + `codegen.service.ts:1574` | Low | 🔴 Misleads LLM |
| **B** | **5 `[DEBUG]` / `console.error` calls in production (`codegen.service.ts`)** | Phase 1 | `codegen.service.ts:1662,1814,1862,2087,2304` | XS | 🔴 Info leakage |
| 3 | Sequence awareness pass before code generation | Phase 1 | `generation-builder.ts` (new function) | High | 🔴 Core of Phase 1 |
| 4 | Step-level fragility flag not top-level in `GenerationStepV1` | Phase 1 | `runtime-schemas.ts` + `generation-builder.ts` | Low | 🟠 High value |
| **D** | **Hover-revealed content (nodesAdded) ignored in generation pipeline** | Phase 1 | `generation-builder.ts` mapping | Low | 🟠 Gesture gap |
| **E** | **`outcomeEffect` extracted but dropped at `GenerationStepV1` mapping** | Phase 1 | `generation-builder.ts:156-172` | Low | 🟠 New tab/dialog missing |
| **F** | **Noise classifier is click-only by design — hovers/scrolls not filtered** | Phase 1 | `generation-builder.ts:244` | Low | 🟠 Noisy output |
| **C** | **`wrapWithPrivacy` adds comment only — no actual redaction** | Phase 1 | `mcp-server/src/utils/privacy.ts` | Medium | 🟠 False confidence |
| 7 | No MCP tool or REST route exposing the graph | Phase 2 | New MCP tool + platform-server route | Medium | 🟠 Phase 2 blocker |
| 9 | Dual definition of `GenerationStepV1` — drift risk | Both | `core/types/generation.ts` vs `runtime-schemas.ts` | Medium* | 🟠 Silent drift |
| 8 | Graph confidence data (`sample_size`, `observation_count`) not in LLM context | Phase 1+ | `codegen.service.ts` + `generation-builder.ts` | Medium | 🟡 Quality signal |
| **G** | **`ignoredSteps` never paginated — full list returned on every call** | Phase 1 | `get-session-generation-context.ts:108` | Low | 🟡 Token waste |
| **H** | **`summary` has no `fragileStepCount`** | Phase 1 | `get-session-generation-context.ts:93-99` | XS | 🟡 Missing signal |
| 6 | Pagination `totalSteps`/`hasMore` | ~~Phase 1~~ | ~~`get-session-generation-context.ts`~~ | ✅ **Already implemented** | — |
| 10 | `edges` table missing `intent` column | Phase 2 | `migrations.ts` + `edge.repository.ts` | Low | 🟡 Phase 2 JOIN |
| 5a | CI trigger for smoke system | Phase 2 | New CI integration / webhook | High | 🔵 Phase 2 |
| 5b | Live micro-snapshot capture | Phase 2 | New Playwright session module | High | 🔵 Phase 2 |
| 5c | Locator dependency graph | Phase 2 | New static analysis tool | High | 🔵 Phase 2 |
| 5d | LLM healing call | Phase 2 | New service (constrained prompt + schema validation) | Medium | 🔵 Phase 2 |
| 5e | Empirical validation gate | Phase 2 | New Playwright validation runner | Medium | 🔵 Phase 2 |
| 5f | Multi-file healing commit | Phase 2 | New file writer | Medium | 🔵 Phase 2 |

> `*` Gap #9 effort changed from Low to Medium* — `packages/codegen` has no path alias or dependency on `core/`. Fixing requires either package restructuring or path mapping. Unverified until attempted.

---

## What the Graph Enables (and Was Never Used For)

| Graph Capability | Lives In | Used Today? | Phase 2 Value |
|---|---|---|---|
| Node canonical hash (anchor-based) | `state-engine.ts` | ✅ Yes (node dedup) | Detect page structure changes |
| Jaccard similarity between nodes | `state-engine.ts` | ❌ Never used | Find "migrated" pages for healing |
| Edge sample_size | `edges` table | ❌ Never read by LLM | Confidence signal for generated tests |
| Node observation_count | `nodes` table | ❌ Never read by LLM | Frequency signal for reliability |
| Outcome probability (Laplace smoothed) | `outcomes` table | ❌ Never read by LLM | Predict flow reliability |
| Intent string on events | `events.intent` | ❌ Not on edges | Must JOIN to get gesture label for an edge |
| `interaction_contexts` per URL | `interaction_contexts` table | ✅ Used by resolver | Baseline snapshot for each page |
| Multi-tab state pointer | `session_tab_state` | ✅ Used by graph-builder | Tab-isolated recording |

---

## What Exists That Is Ready to Use (No Changes Needed)

| Component | Ready State | Notes |
|---|---|---|
| `smoke-classifier.ts` | READY | Failure types already defined including `locator_not_found` and `assertion_failure` |
| `warningCodes` type system | READY | 14+ interfaces already have `warningCodes` field |
| `custom-control-open`/`custom-select` handling | READY | Full two-phase dropdown engine in interceptor, handled in generation-builder |
| `generationGuidance.rules` | READY | 14 typed rules already emitted per session |
| `<LLM_GENERATE_MOCK_DATA>` token | READY | Already in generation guidance rules |
| `assertion.stub.ts` Phase 2 contract | READY | Schema exists, just needs interceptor UI to populate |
| `traceId` event linking | READY | Already links trigger → selection for custom dropdowns |
| `QuiescenceEngine` | READY | DOM + network stability already tracked |
| SPA route detection | READY | `pushState/popstate/hashchange` all monitored |
| `smoke-repair.ts` suggestion system | PARTIAL | Works for known warningCodes, needs LLM path added |
| `smoke-kpi.ts` warningCode aggregation | READY | Already aggregates failures by warningCode — proto-healing log |
| `VSCode extension` Playwright browser | PARTIAL — **NOT ready for Phase 2 live navigation** | Can launch a browser. Cannot reconstruct authenticated session state (login, cart contents, multi-step form pre-fill). Reaching step 17's broken button would yield a login redirect, not the target DOM. Phase 2 MISSING B (live micro-snapshot) must address session reconstruction explicitly. |
| `StateEngine.calculateSimilarityScore()` | READY | Jaccard similarity exists — just needs to be wired to a MCP tool |
| `nodeRepo.getAll()` + `edgeRepo.getAll()` | READY | Repository methods exist — just needs an API endpoint |
| `edge.sample_size` + `node.observation_count` | READY | Data exists in DB — just needs to be included in GenerationContext |

---

## Priority Order: What to Build First

### Immediate (Phase 1 — Unblock First Run)

**Step 1: Post-input mutation correlation in interceptor**
File: `interceptor.js`, function `_emitInputEvent()`

Add a `MutationObserver` that:
- Starts watching on the first `input` event (not blur)
- Watches for `<ul>` / `<li>` / `[role=listbox]` / `[role=option]` appearing within 500ms
- Records `followupMutation: { type, selector, itemCount }` in the emitted input event
- Disconnects after 500ms or when the user blurs the field

This bridges the gap between the existing hover detection pattern (lines 1354-1384) and the input event path.

**Step 2: Sequence analysis pass in generation-builder**
File: `generation-builder.ts`, new function `analyzeSequence(steps[])`

Detect patterns:
- `input` on a text field → no `custom-select` follows → flag `INCOMPLETE_AUTOCOMPLETE`
- `input` on a readonly field → flag `DATE_PICKER_PATTERN`
- Step with `warningCodes: ['positional-fallback-only']` → flag `FRAGILE_SELECTOR`
- Value contains `[REDACTED]` → flag `DYNAMIC_DATA_REQUIRED`
- Two inputs in sequence with `<LI>` clicks → flag `AUTOCOMPLETE_PAIR`

**Step 3: Surface sequence analysis in MCP tool**
File: `get-session-generation-context.ts`

Add `sequenceAnalysis` to the response. This is what the LLM reads first before generating code.

**Step 4: Add `stepWarnings` to GenerationStepSchemaV1**
File: `runtime-schemas.ts`

One field addition. Populated in `generation-builder.ts`. Removes the need for the LLM to traverse nested objects to find fragility warnings.

---

### Phase 2 (After Phase 1 is stable)

**Step 5: CI integration trigger**
Wire `smoke-runner.ts` to CI webhook. When a test fails, smoke-runner classifies the failure and, if `locator_not_found`, triggers the healing pipeline.

**Step 6: Live micro-snapshot module**
New module: `packages/codegen/src/healing/micro-snapshot.ts`
Uses the existing Playwright browser infrastructure from `extension.ts`.
Navigates to the failing URL, captures a localized snapshot (±2 parent levels of the original element area).

**Step 7: Locator dependency graph**
New tool: `packages/codegen/src/healing/locator-graph.ts`
Static TypeScript analysis: parses POM files, builds `locatorName → { file, line, usedBy: [] }` map.

**Step 8: Constrained LLM healing call**
New module: `packages/codegen/src/healing/healer.ts`
Input: `intent + fingerprint + DOM diff (200 chars max)`.
Output: `{ proposedLocator, locatorKind, confidence, reason }` (schema-validated).
Max 2 retries. No free-form code output allowed.

**Step 9: Empirical validation gate**
New module: `packages/codegen/src/healing/validator.ts`
Runs the proposed locator against the live page using Playwright.
Checks: exactly 1 match, visible, action succeeds, full test passes.

**Step 10: Multi-file healing commit**
New module: `packages/codegen/src/healing/commit.ts`
Updates POM file + appends to `.air/healing-log.json`.
Uses blast radius graph from Step 7 to re-validate all affected tests.

---

## The One Change That Unlocks the Most

If only one thing could be changed today, it is **Gap #2: post-input mutation correlation in the interceptor**.

Here is why:

Without this, the LLM sees:
```
Step 1: action=input, intent=type_Leaving_From
Step 2: action=click, intent=click_Hyderabad_li
```
These look like two disconnected actions. The LLM may or may not understand they are a gesture pair.

With post-input mutation correlation, the LLM sees:
```
Step 1: action=input, intent=type_Leaving_From,
        followupMutation: {
          type: "list-appeared",
          selector: "ul.city-suggestions",
          itemCount: 8,
          firstItemText: "Hyderabad"
        }
Step 2: action=click, intent=click_Hyderabad_li (linked via traceId)
```

Now the pattern is unambiguous. No sequence analysis pass is even needed — the mutation data makes the autocomplete gesture self-describing. The LLM can generate:
```typescript
await leavingFromInput.fill('Hyderabad');
await page.locator('ul.city-suggestions li').first().click();
```

This single interceptor change (15-20 lines of MutationObserver code added to `_emitInputEvent`) would fix the AbhiBus failure class, which is the single most common first-run failure pattern.

---

## Honest Assessment of Build Order Risk

| Risk | Level | Notes |
|---|---|---|
| Phase 1 interceptor change breaking existing captures | LOW | Adding a new field to existing events; all existing data paths unchanged |
| Phase 1 sequence analysis false positives | MEDIUM | Conservative flagging strategy (flag only when 90%+ confident a pattern exists) mitigates this |
| Phase 2 healing loop running on `assertion_failure` | HIGH | `smoke-classifier.ts` already guards this — implementation must wire classifier result as the gate |
| Phase 2 LLM proposing wrong locator passing validation | MEDIUM | Validation gate requires full test pass, not just element match |
| Phase 2 blast radius missing a file | LOW | Overflag (validate more files than needed) is the safe failure mode |
| Phase 3 autonomous agent navigating incorrectly | HIGH | Don't build Phase 3 until Phase 2 has 3+ months of stable data |

---

## The One New Finding That Changes the Build Order

The graph already has Jaccard node similarity (`state-engine.ts`), probabilistic outcomes (`outcomes` table), and per-edge sample counts. **None of this is accessible to anything outside the graph-builder.**

Building `get_app_graph` MCP tool (Gap #7) and adding `edge.sample_size` to the GenerationContext (Gap #8) should move UP in priority — they are LOW effort (the data exists) and HIGH impact (they make the LLM's generated tests confidence-weighted from day one).

**Revised build order for Phase 1 (incorporating all new gaps):**

1. **Gap 0** — Update `buildGenerationGuidance()` rules for all incoming fields *(must precede everything else)*
2. **Gap B** — Remove `[DEBUG]` console.error calls in `codegen.service.ts` *(XS, do immediately)*
3. **Gap H** — Add `fragileStepCount` to MCP summary *(XS, do with B)*
4. **Gaps #2 + #2b** — Post-input mutation watch + `InputEventSchema` update *(atomic pair)*
5. **Gap #4 + E** — `stepWarnings` field + `outcomeEffect` field in `GenerationStepV1` *(single mapping pass)*
6. **Gap A** — Add `confidence` to schema + fix 1.0 fallback logic
7. **Gap D** — Surface hover `nodesAdded` in generation pipeline
8. **Gap G** — Paginate `ignoredSteps` in MCP tool
9. **Gap #8** — Add `sampleSize` + `observationCount` to GenerationStep from graph
10. **Gap #7** — `get_app_graph` MCP tool
11. **Gap #3** — Sequence analysis pass
12. **Gap #9** — Resolve dual-definition drift (verify package boundary first)
13. **Gap #F** — Extend noise classifier to hovers/scrolls
14. **Gap C** — Implement real redaction in `wrapWithPrivacy`
15. **Gap #10** — Add `intent` column to `edges` table

---

*Initial analysis: 2026-08-09 | Contract + Graph update: 2026-08-15 | Second-pass verification: 2026-08-16*

*Source files verified (2026-08-16 pass): packages/codegen/src/generation-builder.ts (lines 424-466 guidance rules, 156-172 step mapping, 238-265 noise classifier), packages/codegen/src/codegen.service.ts (lines 1560-1680 step building, 1662/1814/1862/2087/2304 debug logs), packages/mcp-server/src/tools/get-session-generation-context.ts (full 145 lines), packages/mcp-server/src/utils/privacy.ts (full), packages/codegen/package.json, packages/codegen/tsconfig.build.json, packages/codegen/src/runtime-schemas.ts (lines 68-151)*
