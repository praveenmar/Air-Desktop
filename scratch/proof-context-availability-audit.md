# Proof Context Availability Audit

## Purpose

This is Phase 0 of the selector-engine validation plan.

The purpose is to inspect the current record-time capture path, transport path, persistence path, and GenerationContext read path before any selector-engine expansion work starts.

This is an audit only.

No selector-engine behavior, pipeline behavior, GenerationContext behavior, MCP behavior, or DB write behavior should change as part of this phase.

## Architecture Boundary

AIR currently follows this boundary:

- Interceptor captures evidence.
- Current selector engine emits selector decisions.
- AIR data pipeline preserves selector decision data.
- GenerationContext receives selector decision data from the pipeline. It must not synthesize missing selector proof.
- Codegen and MCP consume selector decisions and GenerationContext. They must not invent missing selector proof.

Algorithm v1 boundary:

- Algorithm v1 is shadow-only for now.
- Algorithm v1 shadow output must not affect `selectorDecision`, `selectorResolution`, `resolvedTarget`, `replaySafe`, `locatorStatus`, `GenerationContext`, MCP output, or DB write behavior until explicitly promoted.

## Audit Questions

This audit answers five questions:

1. What selector proof context is already captured at record time?
2. What survives the transport and persistence path?
3. What is promoted as first-class selector data?
4. What actually reaches GenerationContext?
5. Which fields are record-time critical versus safely derivable later?

## Files Inspected

Primary capture and transport path:

- `packages/vscode-extension/interceptor.js`
- `packages/vscode-extension/src/types/event-schema.ts`

Primary event and fingerprint contracts:

- `core/types/fingerprint.ts`
- `core/types/events.ts`

Persistence path:

- `core/db/repositories/event.repository.ts`

GenerationContext path:

- `core/types/generation.ts`
- `packages/codegen/src/runtime-schemas.ts`
- `packages/codegen/src/generation-builder.ts`
- `packages/codegen/src/codegen.service.ts`

Validation references:

- `core/__tests__/event-schema-survival.spec.ts`
- `core/__tests__/phase2-selector-persistence.spec.ts`
- `core/__tests__/phase3a-generation-context.spec.ts`
- `core/__tests__/phase3b-metadata.spec.ts`

## Current End-to-End Path

### 1. Record-Time Capture

The interceptor currently captures more selector proof context than the downstream public pipeline exposes.

Observed capture-time evidence includes:

- `fingerprint.selector`
- `fingerprint.selectorCandidates`
- `fingerprint.selectorAmbiguity`
- `fingerprint.boundedFieldContext`
- `fingerprint.accessibilityEvidence`
- `fingerprint.targetNodeId`
- `fingerprint.targetIdentitySource`
- `fingerprint.targetIdentityStatus`
- `event.nestedContext`
- internal selector decision via `fingerprint._selectorDecision`

For transient custom controls, the interceptor also maintains runtime-only ownership state such as:

- `_openDropdown`
- `activeInputSessions`
- pending option selection cache
- trigger fingerprint linkage
- transient option interaction context

This is especially relevant for autocomplete and custom-select scenarios.

### 2. Wire Normalization

Before transport, the interceptor narrows the internal selector decision.

Current cut point:

- `fingerprint._selectorDecision` is removed from the transported event
- a narrowed `selectorResolution` object is emitted via `_buildSelectorResolutionForWire(decision)`

The wire contract currently keeps:

- `schemaVersion`
- `status`
- `selected.selector`
- `selected.engine`
- `selected.family`
- `selected.source`
- `selected.proposalSource`
- `selected.matchCount`
- `selected.visibleMatchCount`
- `selected.replaySafe`
- `selected.confidence`
- `selected.warningCodes`
- `selected.proofSource`
- `selected.selectedReason`
- `blockedReason`

This means AIR already computes richer proof context than it publicly promotes.

### 3. Persistence

The repository persists the whole event payload as JSON:

- `EventRepository.insertIfAbsent()` writes `JSON.stringify(event)` into `events.payload`

Important consequence:

- any field present on the event object at enqueue/write time survives raw DB persistence
- any field stripped before enqueue/write time does not survive

So the database is not the primary bottleneck.

The primary bottleneck is what the interceptor chooses to emit as first-class payload fields.

### 4. Read-Side Metadata Extraction

The current GenerationContext metadata extractor intentionally reads only a narrow subset:

- `payload.selectorResolution`
- `payload.fingerprint.selector` as `legacySelector`
- `payload.fingerprint.textExcerpt` as `elementText`
- `payload.fingerprint.tagName` as `tagName`

This is a lean consumer contract, not a proof-rich contract.

### 5. GenerationContext Derivation

`deriveGenerationContext()` currently promotes a resolved target only when:

- `selectorResolution.status === "resolved"`
- `selected.replaySafe === true`
- `selected.selector` is non-empty
- `selected.engine` is `css` or `xpath`

Otherwise GenerationContext falls back to lightweight hints only:

- `legacySelector`
- `elementText`
- `tagName`

GenerationContext does not currently synthesize missing proof from:

- selector candidate arrays
- bounded field proof
- accessibility proof
- nested context
- target identity metadata
- shadow proof diagnostics

That boundary is correct for the current architecture.

## Availability Summary

| Proof Area | Captured At Record Time | Survives Raw `events.payload` | Promoted As First-Class Pipeline Data | Visible To GenerationContext | Record-Time Critical | Notes |
|---|---|---|---|---|---|---|
| Final selector decision outcome | Yes, via internal `_selectorDecision` | Partially, only after narrowing to `selectorResolution` | Yes | Yes | Yes | Current public selector contract is the narrowed `selectorResolution` object |
| Replay-safe selected selector | Yes | Yes | Yes | Yes | Yes | This is the main currently consumable success path |
| Selector candidate universe | Yes, via `fingerprint.selectorCandidates` | Yes | No | No | Medium | Useful for diagnostics and future proof packets, not currently promoted |
| Selector ambiguity metadata | Yes | Yes | No | No | Medium | Preserved raw, but not exposed as first-class selector decision context |
| Bounded field proof | Yes, via `fingerprint.boundedFieldContext` | Yes | No | No | High | Strong capture already exists, but pipeline does not surface it |
| Accessibility proof | Yes, via `fingerprint.accessibilityEvidence` | Yes | No | No | Medium | Preserved raw, not promoted to GenerationContext |
| Nested shadow / iframe context | Yes, via `event.nestedContext` | Yes | No dedicated selector-proof packet | No | High | Important boundary signal, but currently outside lean GenerationContext contract |
| Target identity metadata | Yes, via `targetNodeId`, `targetIdentitySource`, `targetIdentityStatus` | Yes | No | No | High | Especially important for stale-node and snapshot-backed targeting analysis |
| Custom control trigger linkage | Partial, via runtime session state and `triggerFingerprint` on emitted custom-control events | Partial | No unified first-class proof packet | No | High | AIR carries pieces, but not a stable transient-control proof contract |
| Active input / active trigger ownership | Partial, runtime-only state observed | No stable payload field | No | No | Critical | Needed for RedBus-style autocomplete ownership |
| Active panel ownership | Partial, runtime-only state observed | No stable payload field | No | No | Critical | Biggest current gap for duplicate option text and multi-panel ambiguity |
| Shadow comparison proof diagnostics | Yes, computed in shadow mode | No stable event field observed | No | No | Medium | Available for debug/shadow analysis, not for official downstream consumption |
| Lightweight fallback hints | Yes, via fingerprint fields | Yes | Yes, through metadata extraction | Yes | Low | Deliberately lean and consumer-safe |

## What The Interceptor Already Knows But Does Not Promote

During shadow comparison, the interceptor computes a richer proof universe than `selectorResolution` exposes.

Observed proof dimensions include:

- canonical target summary
- label-context evidence
- accessibility evidence
- bounded-field evidence
- bounded-field proposal summaries
- option-panel evidence
- table-row evidence
- generic-container evidence
- selector preference summaries
- weak-coverage summaries
- timing summaries

This is important because it means the main missing work is not "invent the proof from nothing."

The main missing work is:

- decide which proof must become first-class
- preserve it in a stable compact packet
- keep GenerationContext lean while still allowing downstream consumers to rely on record-time proof

## Primary Boundary Cuts Observed

### Cut 1: Internal Decision To Public Resolution

Current behavior:

- rich internal `_selectorDecision`
- narrowed public `selectorResolution`

Impact:

- replay-safe final output is available
- proof context behind the decision is largely not available downstream

### Cut 2: Raw Persistence To Lean Read Model

Current behavior:

- raw event payload keeps many fingerprint fields
- metadata extraction ignores most of them

Impact:

- AIR already stores useful raw material
- GenerationContext intentionally does not consume most of it

### Cut 3: Framework-Neutral Target Contract Limited To `css | xpath`

`ResolvedTargetSchema` supports broader target kinds:

- `css`
- `xpath`
- `role`
- `text`
- `label`
- `placeholder`
- `testid`

But current derivation promotes only:

- `css`
- `xpath`

Impact:

- AIR has a broader public target model than the current promoted selector-resolution path actually uses

## Record-Time Critical Vs Derivable Later

### Record-Time Critical

These fields or proof objects should be treated as record-time critical because reconstructing them later is unsafe or lossy:

- active input ownership
- active trigger ownership
- active panel ownership
- transient control family at the moment of interaction
- composed path / nested boundary state
- target identity before node replacement
- visibility and ambiguity state at interaction time
- degraded or blocked reasons tied to the live interaction moment
- overlay, hover, or detachment race context

### Safely Derivable Later If Raw Fields Are Preserved

These are often derivable later if AIR keeps the underlying raw event data:

- basic fallback hints
- some accessibility summaries
- some bounded-field summaries
- some candidate reporting views
- some warning aggregation

### Not Safely Derivable Later If Never Captured

These should not be assumed reconstructible after the fact:

- active panel ownership
- transient hover-reveal state
- stale DOM replacement identity
- closed-shadow internal target identity
- cross-origin iframe internal semantics
- visual obstruction state

## Minimal Proof-Context Packet

Before coding, AIR should define the smallest stable proof packet that preserves record-time selector context without turning GenerationContext into a heavy debug payload.

Recommended compact packet shape:

### Always Needed

- decision status
- selected selector summary
- replay-safe flag
- blocked reason
- warning codes
- proof source

### Target Identity

- `targetNodeId`
- `targetIdentitySource`
- `targetIdentityStatus`
- `nestedContext` summary

### Field / Accessibility Proof

- bounded-field summary:
  - `fieldLabelText`
  - `fieldRelation`
  - `targetControlKind`
  - `targetIndexWithinContainer`
  - `duplicateLabelCount`
  - `isValid`
  - `blockedReason`
- accessibility summary:
  - `role`
  - `accessibleName`
  - `accessibleNameSource`

### Structural / Collection Proof

- candidate count
- visible candidate count
- ambiguity summary
- option-panel summary
- table-row summary
- generic-container summary

### Transient-Control Proof

- control family
- trigger fingerprint summary
- active ownership status
- panel selector summary
- visible option count
- duplicate option text count

### Policy / Warning Layer

- warning codes including future cases such as `business-data-dependent`
- degraded status where AIR intentionally captured incomplete proof

This packet should remain compact.

It should not include:

- full DOM snapshots
- full candidate arrays by default
- resolver-invented proof
- consumer-synthesized proof

## Initial Gap Classification

### Already Strong

- raw event persistence
- narrow public `selectorResolution` contract
- lightweight fallback-hint extraction
- framework-neutral GenerationContext boundary

### Partial

- bounded-field capture exists, but is not first-class downstream
- accessibility capture exists, but is not first-class downstream
- target identity capture exists, but is not first-class downstream
- nested boundary context exists, but is not first-class downstream
- custom-control linkage exists in pieces, but not as a stable proof packet

### Missing

- first-class proof-context packet
- active panel ownership packet
- stable transient-control ownership packet
- compact boundary proof for shadow / iframe cases
- business-data-dependent warning policy in promoted selector data
- GenerationContext-accessible proof metadata beyond final selector outcome

## Audit Conclusion

The current AIR path already captures meaningful selector proof at record time.

The biggest gap is not capture from zero.

The biggest gap is that AIR narrows the proof too early:

- rich proof exists in the interceptor
- raw payload can already preserve many useful fields
- the official public pipeline promotes only a narrow selector-resolution outcome
- GenerationContext intentionally consumes only that narrow outcome plus lightweight fallback hints

This confirms the next non-coding step:

- freeze the proof-context audit
- decide the minimal first-class proof packet
- keep Algorithm v1 shadow-only
- start implementation only after the packet boundary is agreed

## Recommended Next Step

Do not start implementation from live failures directly yet.

The next step should be:

1. Review this audit against the matrix.
2. Decide the minimal proof-context packet.
3. Mark which parts belong in:
   - raw event only
   - first-class selector pipeline
   - GenerationContext
   - debug-only shadow diagnostics
4. Then pick the first missing abstraction to implement, most likely:
   - active input or trigger -> active panel -> selected option

That keeps AIR aligned with the current architecture instead of drifting back toward resolver-era reconstruction.
