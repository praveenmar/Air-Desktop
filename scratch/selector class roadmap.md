This is a razor-sharp refinement. Elevating **Direct Identity** to Class 1 respects the reality of enterprise SDET environments, merging the ownership classes cleans up the architectural boundary, and sandboxing **Stateful Constraints** prevents the exact race conditions that plague naive automation tools.

Here is the fully updated masterplan. I have kept the core document exactly intact while carefully weaving in your additions, reordering the classes to match your final hierarchy, and updating the Development Phases accordingly.

---

# AIR Selector Class Roadmap V1

## Purpose

Define the official AIR selector-engine roadmap after resolver retirement.

This document is the source of truth for selector-engine evolution.

AIR is no longer pursuing a resolver-first architecture.

AIR is moving toward:

Record-time Proof Capture
↓
Shadow Selector Emission
↓
Validation
↓
Production Adoption

No selector class enters the main pipeline until it has proven itself in shadow mode.

---

# Core Principles

## Principle 1 — Proof First

AIR does not invent selectors.

AIR only emits selectors that can be proven from captured evidence.

Proof must originate from the interceptor.

Generation layers may synthesize selectors only from recorded proof.

---

## Principle 2 — Record-Time Truth

If proof is not captured during recording,
it does not exist.

No replay-time DOM reconstruction.

No synthetic inference.

No resolver-style guessing.

---

## Principle 3 — Shadow Before Production

Every selector class follows:

Capture
→ Shadow Emit
→ Validation
→ Production

Never:

Capture
→ Production

---

## Principle 4 — Generic Classes Over Widgets

AIR does not build:

* OrangeHRM selectors
* RedBus selectors
* SauceDemo selectors
* React selectors
* Angular selectors

AIR builds generalized selector classes.

A single selector class should unlock hundreds of UI patterns.

---

## Principle 5 — Deterministic Over Clever

Deterministic proof always wins over LLM inference.

The selector engine should be explainable.

A future engineer must be able to answer:

"Why was this selector generated?"

using proof alone.

---

# Official Selector Classes

---

## Class 1: Direct Identity

Examples:

* data-testid
* stable id
* stable name

Proof:

* target owns stable identity

Status:

READY

Interceptor work required:

NO

Shadow generation required:

YES

Notes:

This is the strongest selector tier. UI text changes more often than test IDs. Direct Identity outranks Semantic Identity.

---

## Class 2: Semantic Identity

Examples:

* getByRole
* getByLabel
* getByText
* getByAltText

Proof:

* role
* accessibleName
* accessibleNameSource

Status:

READY

Interceptor work required:

NO

Shadow generation required:

YES

---

## Class 3: Label Bound Identity

Examples:

Label → Input

Email → textbox

Password → textbox

Proof:

* fieldLabelText
* fieldRelation
* duplicateLabelCount
* targetControlKind

Status:

READY

Interceptor work required:

NO

Shadow generation required:

YES

Notes:

This is a first-class selector philosophy, distinct from generic Structural Adjacency and Semantic Identity. Label relationships (`Label → Control`) are formal cryptographic proofs of intent.

---

## Class 4: Semantic Context Filtering

Examples:

Card → Action

Dialog → Action

Row → Action

Customer John → Edit

Proof:

* container summary
* anchor text
* target action

Status:

READY

Interceptor work required:

NO

Shadow generation required:

YES

---

## Class 5: Structural Adjacency

Examples:

following-sibling

ancestor

descendant

bounded wrapper relationships

Proof:

* DOM relationships
* bounded field context

Status:

READY

Interceptor work required:

NO

Shadow generation required:

YES

Notes:

Target is adjacent WITHOUT a formal label relationship. Weaker than Label Bound Identity.

---

## Class 6: Structural Disambiguation

Examples:

nth()

position within stable parent

Proof:

* ambiguity counts
* duplicate counts
* stable ordering

Status:

READY

Interceptor work required:

NO

Shadow generation required:

YES

Notes:

Fallback tier only.

Never preferred.

---

## Class 7: Stateful Lifecycle Linkage

Examples:

Autocomplete

Combobox

Datepicker

Detached popup

Trigger → Panel → Option

Proof:

* Explicit linkage (`aria-controls`, `aria-owns`)
* Implicit linkage (`active session`, `mutation ownership`)

Status:

Architecture complete, runtime blocked.

Interceptor work required:

YES

Priority:

CRITICAL

Notes:

Merges Composite Control Ownership and Transient Temporal Linkage. The final selector class is the same regardless of whether the proof source is explicit ARIA attributes or implicit temporal mutation events.

---

## Class 8: Collection Membership

Examples:

Grid

List

Virtualized collection

Proof:

* collection boundaries
* row position
* column position

Status:

Architecture complete, runtime blocked.

Interceptor work required:

YES

Priority:

MEDIUM

---

## Class 9: Hierarchical Navigation

Examples:

Tree

TreeItem

Breadcrumb

Nested Navigation

Proof:

* hierarchy path
* parent identity
* node depth

Status:

Likely runtime blocked.

Interceptor work required:

YES

Priority:

MEDIUM

---

## Class 10: Boundary Traversal

Examples:

Shadow DOM

Iframe

Nested boundaries

Proof:

* boundary type
* host identity

Status:

PARTIAL

Interceptor work required:

YES

Priority:

HIGH

---

## Class 11: Native DOM Normalization

Examples:

normalize-space()

whitespace normalization

text canonicalization

Proof:

* captured text

Status:

READY

Interceptor work required:

NO

Shadow generation required:

YES

Notes:

This is a selector-strengthening class.

Not a standalone locator strategy.

---

## Class 12: Replay Readiness / State Awareness

Examples:

aria-selected

aria-expanded

checked

active

disabled

Proof:

* state snapshots

Status:

MISSING

Interceptor work required:

YES

Priority:

LOW

Notes:

Purpose is Precondition Validation and State Awareness.

Rule: State attributes may NEVER become the primary identity selector due to race conditions.

Allowed: "Is the panel already open?"
Not Allowed: `locator('[aria-selected="true"]')` as primary identity.

---

# Official Development Order

Phase A

Shadow-only implementation using existing proof.

1. Direct Identity
2. Semantic Identity
3. Label Bound Identity
4. Semantic Context Filtering
5. Structural Adjacency
6. Structural Disambiguation
7. Native DOM Normalization

Goal:

Validate proof quality without changing production selector selection.

---

Phase B

Interceptor enhancements.

1. Stateful Lifecycle Linkage
2. Boundary Traversal
3. Collection Membership
4. Hierarchical Navigation
5. Replay Readiness / State Awareness

Goal:

Capture missing proof.

No production selector changes.

---

Phase C

Proof Packet

Introduce SelectorProofPacketV0.

Shadow only.

No GenerationContext changes.

No MCP changes.

No DB contract changes.

---

Phase D

Production Adoption

Promote validated selector classes one-by-one.

No bulk migrations.

No big-bang rollout.

Each selector class must prove replay stability before promotion.

---

# Explicit Non Goals

Not rebuilding the resolver.

Not introducing ranking systems.

Not introducing LLM selector generation.

Not introducing replay-time selector synthesis.

Not introducing site-specific selector rules.

Not introducing OrangeHRM fixes.

Not introducing SauceDemo fixes.

Not introducing RedBus fixes.

AIR solves classes of problems, not websites.