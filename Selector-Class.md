
# AIR Selector Classes — Canonical Reference

> A single source of truth for the 12 selector classes: what each one **is**, the
> **problem it solves**, the **real-web gap it fills**, what **proof** it consumes,
> what it **generates**, how it **differs from its neighbors**, and its **current
> build status**.
>
> Companion documents: `scratch/selector class roadmap.md` (roadmap), `Sel philospy.txt`
> (philosophy). Where they conflict, the roadmap defines *scope/status* and the
> philosophy defines *judgment/ordering*.

---

## 1. The mental model

A selector class is **not** a selector syntax. It is a **category of proof-backed
intent**. Two selectors that look identical (`div.oxd-select-text`) can belong to
different classes depending on *why* AIR chose them and *what evidence* justified them.

The engine's job, per the philosophy, is to find the **optimal proof-backed path**,
not just any path that happens to match right now. Each class encapsulates one such
path, the evidence required to walk it, and the conditions under which it is allowed
to emit.

### Three non-negotiable principles (from the roadmap)

1.  **Proof First** — AIR never invents selectors. It only emits selectors that can be
    *proven* from evidence captured by the interceptor at record time.
2.  **Record-Time Truth** — If proof was not captured during recording, it does not
    exist. No replay-time DOM reconstruction, no synthetic inference, no guessing.
3.  **Shadow Before Production** — Every class follows
    `Capture → Shadow Emit → Validation → Production`. Never `Capture → Production`.

### What "optimal" means (from the philosophy)

Optimal ≠ shortest. A selector is **optimal** when it is unique, stable, semantic,
replay-safe, not tied to volatile state text, not positional unless unavoidable,
explainable, and proof-backed. A short-but-weak selector (`.oxd-select-text`) loses to
a longer-but-proven one (`label → container → trigger`).

A selector is **bad only when AIR chose it while stronger proof existed.** No selector
*type* (XPath, class, text, index) is bad by itself — only bad *relative to available
proof*.

---

## 2. The preference ordering (design intent — ranking not yet built)

The classes are numbered in **descending strength**. This ordering is the intended
ranking/preference tier. **Ranking is deliberately not implemented yet** — current
sequencing is *proof generation first, ranking last*. Until ranking exists, multiple
classes may emit candidates for the same element; deduplication/selection is a future
phase.

---
STRONGEST
  1  Direct Identity           — stable machine identity
  2  Semantic Identity         — accessibility role + name
  3  Label Bound Identity      — formal label→control association
  4  Semantic Context Filtering — container + anchor text → action
  5  Structural Adjacency      — DOM relationship, no formal label
  6  Structural Disambiguation — nth / positional   (FALLBACK ONLY)
 11  Native DOM Normalization  — text canonicalization (STRENGTHENER, not standalone)
  7  Stateful Lifecycle Linkage — trigger→panel→option (record-time linkage)
  8  Collection Membership     — grid/list/virtualized position
  9  Hierarchical Navigation   — tree/breadcrumb path
 10  Boundary Traversal        — shadow DOM / iframe host chain
 12  Replay Readiness          — state precondition (NEVER primary identity)
WEAKEST / SPECIAL-PURPOSE
---

Explicit rules baked into the ordering:
- **"Direct Identity outranks Semantic Identity"** — test IDs change less often than UI text.
- **Label relationships are "formal cryptographic proofs of intent"** — Class 3 is first-class, above generic structure.
- **Class 6 is "fallback tier only, never preferred."**
- **Class 11 is a strengthener**, not a standalone locator strategy.
- **Class 12 may never be the primary identity** (race-condition risk).

> **See [Section 9 — Open tensions & resolutions](#9-open-tensions--resolutions-living-log)** for the
> doctrinal questions this ordering depends on, including the **resolved** rules that
> *determinism is a hard gate* and *frozen proof enables healing rather than causing
> brittleness.*

---

## 3. Status legend & at-a-glance table

| Status | Meaning |
|---|---|
| **DONE** | End-to-end live in the V0 shadow packet: producer → escrow → push → route → generator, with tests. |
| **PARTIAL** | Some links exist (often the proof producer) but the V0 path is incomplete or a branch is dead. |
| **MISSING** | No V0 implementation. May exist only as a contract id or a legacy (non-V0) helper. |

| # | Class | Engine | Roadmap status | **Build status** | Primary gap |
|---|---|---|---|---|---|
| 1 | Direct Identity | `playwright-css` | READY | **DONE**\* | No dedicated isolated unit test for the generator |
| 2 | Semantic Identity | `playwright-aria` | READY | **DONE** | Dynamic-name guard deferred (telemetry only) |
| 3 | Label Bound Identity | `playwright-aria` | READY | **DONE** | `exact` vs colon-stripped label (deferred) |
| 4 | Semantic Context Filtering | `playwright-native` | READY | **PARTIAL** | Only `bounded-field` live; `table-row`/`generic-container` dead (known issue) |
| 5 | Structural Adjacency | `playwright-css` | READY | **MISSING** | No V0 generator/escrow/route; legacy `structural.js` is wrong shape |
| 6 | Structural Disambiguation | `playwright-css` | READY | **MISSING** | Not started; fallback-only |
| 7 | Stateful Lifecycle Linkage | (tbd) | PARTIAL/MISSING | CRITICAL | **PARTIAL** | Producer exists (`option-panel.js`); no V0 generator |
| 8 | Collection Membership | (tbd) | PARTIAL - MEDIUM | **MISSING** | Not started |
| 9 | Hierarchical Navigation | (tbd) | MISSING - MEDIUM | **MISSING** | Not started |
| 10 | Boundary Traversal | (tbd) | PARTIAL - HIGH | **MISSING** | Not started |
| 11 | Native DOM Normalization | strengthener | READY | **PARTIAL** | Legacy only; no V0 strengthener hook |
| 12 | Replay Readiness | n/a (validation) | MISSING - LOW | **MISSING** | Not started; never primary identity |

\* Class 1 is functionally end-to-end but lacks an isolated generator unit test.

---

## 4. Per-class specifications

Each entry uses a fixed shape:
**Responsibility • Problem solved • Real-web gap • Proof inputs • Generates • Engine • Boundary vs neighbors • Failure modes • Status & gap.**

---

### Class 1 — Direct Identity

- **Responsibility:** Select an element by a stable machine identity it owns directly.
- **Problem solved:** When the author gave the element an explicit, stable hook
  (`data-testid`, a non-dynamic `id`, a stable `name`), nothing else is needed.
- **Real-web gap:** Distinguishes *intentional* test hooks from incidental attributes;
  filters out framework-generated dynamic ids that look stable but aren't.
- **Proof inputs:** `identityType` ∈ {`data-testid`, `id`, `name`, … }, the attribute
  value, and a dynamic-id heuristic flag.
- **Generates:** A direct attribute/id selector (e.g. a `data-testid` locator).
- **Engine:** `playwright-css`.
- **Boundary vs neighbors:** Strictly *self-owned identity*. The moment identity comes
  from a **related** element (a label), it is Class 3, not Class 1.
- **Failure modes:** Dynamic ids masquerading as stable (mitigated by the heuristic);
  duplicated `name` attributes (weaker than test-id — see philosophy Refinement B).
- **Status & gap:** **DONE** end-to-end. Gap: no dedicated isolated unit test for the
  generator (logic exercised only indirectly).

---

### Class 2 — Semantic Identity

- **Responsibility:** Select by the element's **accessibility role + accessible name**.
- **Problem solved:** Most interactive controls have a stable role and a human-meaningful
  name; this is how a *user* identifies the control ("the Submit button").
- **Real-web gap:** Survives styling/markup churn that breaks CSS; encodes intent the
  way assistive tech sees it. More stable than structure, less brittle than text.
- **Proof inputs:** `role`, `accessibleName`, `accessibleNameSource`, and a dynamic-name
  signal (`accessibleNameIsDynamic`, currently telemetry only).
- **Generates:** `getByRole('<role>', { name: '<name>', exact: true })` (string form),
  with the accessible name as the source of truth.
- **Engine:** `playwright-aria`.
- **Boundary vs neighbors:** Uses the *computed accessible name* regardless of where it
  came from. Where the name is sourced **from a formal label**, Class 3 *also* emits a
  `getByLabel` candidate — overlap is intentional and resolved later by ranking.
- **Failure modes:** Dynamic names (`"Total: $42.00"`) are replay landmines; the dynamic
  flag exists but **no guard consumes it yet** (deferred by decision). Name-less roles
  (`getByRole('button')`) are ambiguous — filtered at the push site (requires a name).
- **Status & gap:** **DONE** with tests. Gap: dynamic-name suppression intentionally
  deferred until a downstream modifier exists.

---

### Class 3 — Label Bound Identity

- **Responsibility:** Select a control via a **formal label→control association**.
- **Problem solved:** Form fields are identified by their visible label
  ("Email", "Password"), not by their own attributes.
- **Real-web gap:** Encodes the single most common human intent on forms. The roadmap
  calls label relationships *"formal cryptographic proofs of intent"* — stronger than
  any structural guess.
- **Proof inputs:** `fieldLabelText`, `fieldRelation`, `duplicateLabelCount`,
  `targetControlKind`, `isValid`.
- **Generates:** `getByLabel('<label>')`.
- **Engine:** `playwright-aria`.
- **Boundary vs neighbors:** **Only FORMAL relations** qualify:
  `label-for`, `wrapped-label`, `aria-labelledby`. Heuristic relations
  (`sibling-label`, `bounded-container`) are **not** Class 3 — they belong to Class 5 /
  Class 4. This gate is a *correctness* boundary: `getByLabel` will not resolve a
  non-formal association.
- **Failure modes:** Label text normalization strips trailing `:`/`*`, which can break
  `exact` matching (handled by emitting non-exact / deferred); `duplicateLabelCount > 1`
  → ambiguous match (carried as telemetry, not yet suppressed).
- **Status & gap:** **DONE** with tests. Gap: `exact`-vs-stripped-text nuance deferred.

---

### Class 4 — Semantic Context Filtering

- **Responsibility:** Select an action **inside a meaningful container, disambiguated by
  anchor text** (container + text → action).
- **Problem solved:** Repeated controls that are only distinguishable by their context —
  the **Edit** button in the **John** row, the action in *this* card/dialog.
- **Real-web gap:** This is the case pure identity/label cannot solve: many identical
  actions, told apart only by *which container's content* surrounds them.
- **Proof inputs (by sub-type):**
  - `bounded-field`: `cleanParentSelector`, `cleanChildSelector`, `fieldLabelText`,
    `fieldRelation === 'bounded-container'`, `duplicateLabelCount`.
  - `table-row`: table/row/action selectors + row identity text + uniqueness flags.
  - `generic-container`: container kind, anchor text, action name/role/tag + uniqueness.
- **Generates:** `locator('<container>').filter({ hasText: '<anchor>' }).locator('<target>')`
  (or `.getByRole(...)` for the action).
- **Engine:** `playwright-native`.
- **Boundary vs neighbors:** Class 4 = **structure + text filtering**. Class 5 =
  **structure only, no text**. That mechanical line keeps them disjoint. Versus Class 3,
  Class 4 handles the *non-formal / many-control* container cases Class 3 refuses.
- **Failure modes:** Text-based `hasText` filtering is sensitive to volatile content
  (the dropdown lesson — never filter on a *selected value*); ambiguity when the anchor
  text repeats. Escaping of interpolated text is required (apostrophes/backslashes).
- **Status & gap:** **PARTIAL.** The `bounded-field` sub-type is live end-to-end with
  tests and proper escaping. The `table-row` and `generic-container` sub-types are
  **not live** — their guards never pass because matching proof producers do not emit
  the expected field schema (**accepted known issue**; deferred until producers exist).

---

### Class 5 — Structural Adjacency

- **Responsibility:** Select via a **DOM relationship** (following-sibling, ancestor,
  descendant, bounded wrapper) when there is **no formal label**.
- **Problem solved:** The control has no test-id, no clean role+name, no formal label —
  but it sits in a *stable structural relationship* to an identifiable anchor.
- **Real-web gap:** Bridges the space between "has a formal hook" (Classes 1–3) and
  "needs raw positional disambiguation" (Class 6). The roadmap: *"adjacent WITHOUT a
  formal label relationship. Weaker than Label Bound Identity."*
- **Proof inputs:** DOM relationship + bounded-field context; the natural source is
  `fieldRelation === 'sibling-label'` plus a **stable container anchor** and a
  `uniqueness/match-count` signal.
- **Generates:** A container-scoped CSS relationship selector.
- **Engine:** `playwright-css`.
- **Boundary vs neighbors:** Must use **stable structural anchors** (clean container
  class/id + relationship) and must **refuse nth/positional chains** — those are
  Class 6. Versus Class 4: **no text filtering** (structure only). Versus Class 3: the
  *non-formal* counterpart of the same evidence object.
- **Failure modes:** The most replay-fragile class so far — without a uniqueness signal
  it can only be telemetry. Easy to drift into positional brute force (must be fenced).
- **Status & gap:** **MISSING** in V0. No generator, escrow, route, or tests. A legacy
  producer (`generators/structural.js`, `collectStructuralCandidates`) exists with
  excellent class-token stability scoring, but it is **DOM-bound and the wrong shape**
  for the pure proof-in V0 pipeline (it feeds the legacy candidate path). Its scoring
  logic is the asset to reuse for the "is this anchor stable?" gate.

---

### Class 6 — Structural Disambiguation

- **Responsibility:** Resolve *which one* among otherwise-identical matches by position
  (`nth`, index within a stable parent).
- **Problem solved:** Two genuinely indistinguishable controls where no stronger proof
  exists — the only remaining lever is stable ordering.
- **Real-web gap:** The honest **last resort** before giving up — captures the
  positional fallback that real selector tools (e.g. SelectorHub's `nth(0)/nth(1)`) use,
  but only *after* all proof-backed paths are exhausted.
- **Proof inputs:** ambiguity counts, duplicate counts, stable ordering.
- **Generates:** An `nth()` / positional selector scoped to a stable parent.
- **Engine:** `playwright-css`.
- **Boundary vs neighbors:** **"Fallback tier only. Never preferred."** It is the floor
  beneath Class 5: Class 5 uses *relationships*, Class 6 uses *raw position*. Class 5
  must hand off here rather than emit positional itself.
- **Failure modes:** Inherently brittle to reordering, insertion, virtualization. Must
  never be chosen while any stronger proof was available (philosophy's "bad selector"
  rule).
- **Status & gap:** **MISSING.** Contract id exists; no implementation.

---

### Class 7 — Stateful Lifecycle Linkage

- **Responsibility:** Link a **trigger → transient panel → option** across a control's
  lifecycle (autocomplete, combobox, datepicker, detached popup).
- **Problem solved:** The option the user clicks lives in a panel that **did not exist**
  until the trigger opened it, and may be **detached** from the trigger in the DOM.
  Identity must span that lifecycle.
- **Real-web gap:** The hardest, highest-value real-web case - custom dropdowns/menus
  where naive selectors capture volatile panel content or transient nodes. Roadmap marks
  it **CRITICAL**.
- **Proof inputs:**
  - *Explicit linkage:* `aria-controls`, `aria-owns`.
  - *Implicit linkage:* active-session / mutation-ownership captured at record time.
  - The class is the same regardless of which proof source applies.
- **Generates:** A trigger-anchored path to the option within the owned panel.
- **Engine:** TBD (likely a composite native/css path).
- **Boundary vs neighbors:** Unlike Classes 4/5 (which assume the target is present in a
  static container), Class 7 owns the **temporal/ownership** dimension — panels that
  appear, move, or detach. It explicitly **merges** the former "Composite Control
  Ownership" and "Transient Temporal Linkage" ideas.
- **Failure modes:** Race conditions; capturing the wrong (volatile) panel text; losing
  the link when the panel is portaled elsewhere.
- **Status & gap:** **PARTIAL.** A producer exists (`context/option-panel.js`,
  `resolveOptionPanelContextEvidence`, plus bridging) and is used in the **legacy**
  path. There is **no V0 shadow generator/escrow/route** consuming it yet. Requires
  interceptor work (record-time linkage capture).

---

### Class 8 — Collection Membership

- **Responsibility:** Identify an item by its **membership/position in a collection**
  (grid, list, virtualized set) — row/column coordinates within collection boundaries.
- **Problem solved:** Items in large/virtualized collections have no individual identity;
  they are defined by *where they sit* in the collection.
- **Real-web gap:** Data grids and virtualized lists where DOM nodes are recycled and
  only the logical coordinate is stable.
- **Proof inputs:** collection boundaries, row position, column position.
- **Generates:** A collection-scoped coordinate selector.
- **Engine:** TBD.
- **Boundary vs neighbors:** Distinct from Class 4 `table-row` (which disambiguates by
  *row text*); Class 8 reasons about *collection structure and coordinates*, including
  virtualization. Distinct from Class 6 (collection-aware, not raw nth).
- **Failure modes:** Virtualization/recycling; lazy loading; sort/filter reordering.
- **Status & gap:** **MISSING** in V0 (roadmap: PARTIAL). Requires interceptor work.

---

### Class 9 — Hierarchical Navigation

- **Responsibility:** Identify a node by its **path through a hierarchy** (tree, treeitem,
  breadcrumb, nested navigation) — parent identity + depth.
- **Problem solved:** Tree/nav nodes are ambiguous by label alone ("Settings" appears in
  many branches); the *path* disambiguates.
- **Real-web gap:** File trees, nested menus, breadcrumb-driven navigation where the same
  label recurs at different depths.
- **Proof inputs:** hierarchy path, parent identity, node depth.
- **Generates:** A path-scoped selector chaining parent identity to the node.
- **Engine:** TBD.
- **Boundary vs neighbors:** Class 9 is recursive/path-based, unlike Class 4's single
  container hop. Unlike Class 8, it is about *named hierarchy*, not collection coordinates.
- **Failure modes:** Deep/variable paths; lazy-expanded branches; label recurrence.
- **Status & gap:** **MISSING** (roadmap: MISSING). Requires interceptor work.

---

### Class 10 — Boundary Traversal

- **Responsibility:** Cross **encapsulation boundaries** — shadow DOM, iframes, nested
  boundaries — to reach the target, anchored to the host identity.
- **Problem solved:** Standard selectors stop at shadow/iframe boundaries; the target is
  only reachable by explicitly traversing the host chain.
- **Real-web gap:** Web-component apps (shadow roots) and embedded iframes, increasingly
  common in enterprise UIs.
- **Proof inputs:** boundary type, host identity.
- **Generates:** A boundary-aware selector chain (host → boundary → target).
- **Engine:** TBD.
- **Boundary vs neighbors:** Orthogonal/composable — it is the **traversal wrapper** that
  may combine with any inner class once inside the boundary.
- **Failure modes:** Closed shadow roots; cross-origin iframes; dynamic host identity.
- **Status & gap:** **MISSING** in V0 (roadmap: PARTIAL, **HIGH** priority). Requires
  interceptor work.


### Class 11 — Native DOM Normalization

* **Responsibility:** **Strengthen** a text-bearing selector by canonicalizing text
(`normalize-space`, whitespace/text canonicalization).
* **Problem solved:** Captured text and rendered text differ by incidental whitespace;
naive text matching fails on that difference.
* **Real-web gap:** Makes text-based matches robust to formatting noise without changing
the underlying strategy.
* **Proof inputs:** captured text.
* **Generates:** Nothing standalone — it **modifies** another class's text matching.
* **Engine:** strengthener (applies to whichever engine the host candidate uses).
* **Boundary vs neighbors:** **Not a locator strategy.** It is a modifier that improves
Classes 2/3/4 (any text-bearing candidate). It must never be a standalone candidate.
* **Failure modes:** Over-normalization hiding a real text mismatch.
* **Status & gap:** **PARTIAL** (roadmap: READY). Logic exists in the legacy path; no V0
strengthener hook wired into the packet yet.

---

### Class 12 — Replay Readiness / State Awareness

* **Responsibility:** Capture **state** (`aria-selected`, `aria-expanded`, `checked`,
`active`, `disabled`) for **precondition validation**, not identification.
* **Problem solved:** Replay needs to know *"is the panel already open?"* before acting —
a state check, not a way to find the element.
* **Real-web gap:** Prevents flaky replays that act before a control reaches the expected
state — addresses timing/race issues that identity selectors cannot.
* **Proof inputs:** state snapshots.
* **Generates:** A **precondition/assertion**, never a primary locator.
* **Engine:** n/a (validation, not location).
* **Boundary vs neighbors:** **Hard rule:** state attributes may **never** become the
primary identity selector (e.g. `locator('[aria-selected="true"]')` as identity is
forbidden) due to race conditions. Allowed only as a guard alongside a real locator.
* **Failure modes:** Using state as identity → race conditions and false matches (the
exact thing the rule forbids).
* **Status & gap:** **MISSING** (roadmap: MISSING, **LOW** priority).

---

## 5. Pairwise boundary matrix (anti-sprawl)

The recurring failure mode in a class system is **sprawl** — two classes claiming the
same case. These are the locked boundary rules that keep them disjoint.

| Pair | The line between them |
| --- | --- |
| **1 vs 3** | Identity the element **owns itself** (1) vs identity from a **related label** (3). |
| **2 vs 3** | **Computed accessible name** via role (2) vs **formal `getByLabel**` association (3). They *overlap by design* when the name comes from a formal label; both emit, ranking dedups later. |
| **3 vs 5** | **Formal** label relation `{label-for, wrapped-label, aria-labelledby}` (3) vs **heuristic** relation `{sibling-label}` (5). Correctness gate: `getByLabel` only resolves formal. |
| **3 vs 4** | Single formal label→control (3) vs **container + anchor text → action** for non-formal/many-control cases (4). |
| **4 vs 5** | **Structure + text** (`hasText`) (4) vs **Structure only, no text** (5). The mechanical dividing line. |
| **5 vs 6** | **Stable relationship** anchor (5) vs **raw position / nth** (6). Class 5 must refuse positional and hand off to 6. |
| **4 vs 8** | Disambiguate by **row text** (4 table-row) vs by **collection coordinates / virtualization** (8). |
| **4 vs 9** | **Single container hop** (4) vs **recursive hierarchy path** (9). |
| **8 vs 9** | **Collection coordinates** (8) vs **named hierarchy path** (9). |
| **2/3/4 vs 11** | Locator strategies (2/3/4) vs **text strengthener that modifies them** (11). 11 is never standalone. |
| **any vs 7** | Static-container assumption (others) vs **temporal/ownership linkage** for panels that appear/move/detach (7). |
| **any vs 10** | In-document selection (others) vs **boundary-crossing wrapper** (shadow/iframe) (10), composable with an inner class. |
| **any vs 12** | Identification (others) vs **state precondition only** (12). 12 may never be primary identity. |

---

## 6. Build phases (roadmap)

* **Phase A - Shadow-only using existing proof:** Classes 1, 2, 3, 4, 5, 6, 11.
*Goal: validate proof quality without changing production selection.*
* **Phase B - Interceptor enhancements (capture missing proof):** Classes 7, 10, 8, 9, 12.
*Goal: capture missing proof. No production selector changes.*
* **Phase C - Proof Packet:** introduce `SelectorProofPacketV0`; shadow only; no
GenerationContext / MCP / DB contract changes.
* **Phase D - Production Adoption:** promote validated classes **one-by-one**; no bulk
migration; each class must prove replay stability before promotion.

**Where we are:** Phase A is in progress — Classes 1-3 done, Class 4 partial
(bounded-field only), Class 5 next. The V0 packet (Phase C plumbing) already exists and
is shadow-only. No production path, MCP, or DB contract has been changed.

---

## 7. Explicit non-goals (roadmap)

* Not rebuilding the resolver.
* Not introducing replay-time selector synthesis.
* Not introducing LLM selector generation.
* Not introducing site-specific selector rules — **"AIR solves classes of problems, not
websites."**
* Ranking exists as *design intent* (Section 2) but is intentionally **not built yet**.

---

## 8. Glossary

* **Proof / evidence** — record-time data captured by the interceptor that justifies a
selector. Produced by `context/*.js` and `accessibility/role-name.js`.
* **Escrow** — the wrapper return fields (`rawAccessibilityProof`, `rawLabelProof`,
`rawBoundedFieldProof`, …) that carry evidence from the shadow comparison out to the
fingerprint assembly.
* **Push site** — where `generateFingerprint` gates evidence and pushes it into the
`proofs[]` array with a `proofType`/`identityType`.
* **Generator** — a **pure** function in `generators/` that turns one proof into one
immutable candidate via `createCandidate(...)`. No DOM access, no mutation.
* **SelectorProofPacketV0** — the shadow output: `{ version: 0, candidates: [...] }`.
Strictly proof-in, candidate-out; if no candidate is generated the proof is silently
ignored.
* **Shadow pipeline** — the parallel, side-effect-free path that emits candidates for
validation without affecting production selection.

---

## 9. Open tensions & resolutions (living log)

A design philosophy is only as strong as the contradictions it survives. This section
records the hard doctrinal questions surfaced by adversarial review, each as: **the
tension** (what we say vs. what is actually true), **the bite** (why it matters), and
**the rule** (resolved) or **status** (open). New tensions are appended; resolved ones
become binding decisions referenced by the class specs.

### RESOLVED

#### T1 — "Think like a human" (adaptive) vs. "Record-Time Truth" (frozen proof)

* **Tension:** A human adapts at replay - if a label drifts `ESS` → `ESS - Employee Self Service`, they still click it. AIR freezes proof at record time, forbids
replay-time DOM re-inspection, and matches with `exact:true`. On the axis that makes
humans robust, a *naive* reading says AIR looks *less* adaptive than even codegen.
* **Resolution (decision):** The framing "AIR is less adaptive than codegen" is
**retracted.** The inverse is true. Codegen freezes a selector with **nothing behind
it** — when it breaks, brittleness is *terminal*. AIR freezes a selector but **retains
the proof packet** behind it, so a break is a **recoverable signal**, not a dead end.
Therefore:
* **The matcher stays strict** (frozen, `exact`, no guessing). Strictness is a
*feature*: a strict matcher produces a **clean, unambiguous failure signal**. A
fuzzy matcher would silently click the wrong element.
* **Adaptivity lives in the healing layer, not the matcher.** Healing re-resolves from
the *retained proof* (proof-time re-resolution), which is **allowed** — distinct
from replay-time DOM reconstruction, which remains **forbidden**.
* **Three recovery tiers** (all of which codegen lacks):
1. **Automatic** — healing re-resolves a valid selector from the retained proof packet.
2. **Assisted** — MCP surfaces the broken proof + candidate alternatives for the user to confirm.
3. **Authored** — the user proactively updates a selector/proof via MCP because they *know* a change is coming.


* **Dependency (IOU):** Proof-guided healing is **not yet wired into the shipped path**.
The doctrine is sound by design; the healing layer is the implementation debt that
cashes this check. Name this dependency whenever T1 is invoked.



#### T4 — "Optimal ≠ shortest" is unfalsifiable without virtue ordering

* **Tension:** "Optimal" was defined as a *list of virtues* (unique, stable, semantic,
replay-safe, explainable) with **no ordering among them**. They can conflict — e.g.
`getByRole('option',{name:'ESS'})` is maximally semantic but may not be unique (two
open panels), while a scoped CSS is unique but less semantic. Without an ordering,
"optimal" decays into taste and every class-boundary argument is re-litigated.
* **Resolution (decision):** Split the virtues into a **hard gate** and **soft tie-breakers**.
* **Determinism / uniqueness is a HARD GATE.** A non-unique (non-deterministic)
selector is **disqualified**, regardless of how semantic, short, or pretty it is.
* **Everything else is a SOFT TIE-BREAKER, applied only to survivors of the gate:**
semantic > structural, stable > volatile, short > long, explainable > opaque.
* This makes "optimal ≠ shortest" falsifiable and unblocks future ranking: **gate
first, then score the survivors.**



### OPEN

* **T2 — state-as-identity vs. state-as-incidental.** Picking the option named
`"Enabled"`/`"ESS"` is legitimate identity even though the word is a status value;
`[aria-selected="true"]` as identity is forbidden. The current doctrine conflates
"text that *names* the element" with "attribute that *reflects transient state*".
Needs an explicit rule distinguishing the two (sharpens Class 12).
* **T3 — "ranking last" defers the hardest, most user-visible problem.** Generation
without a per-candidate confidence signal isn't shippable; confidence (0-1) should be
treated as a **Phase-A requirement**, not a later "refinement". Class number orders
*across* classes but gives **no tie-breaker within a class**.
* **T5 — disjointness is asserted, not enforced.** Nothing in code prevents an element
from emitting in two mutually-exclusive classes; the only guard is routing-by-
`fieldRelation`. No test asserts "no element emits in two exclusive classes" → sprawl
can creep back silently.
* **T6 — taxonomy is over-fit to the recorded corpus.** Classes 1-7 cover the forms/
selects/nav we have sessions for; classes 8/9/10 (collections, trees, shadow DOM/
iframes) are MISSING **and have no proof producers and no test sessions to validate
against.** "AIR solves classes of problems" is unbacked for ~half the classes.
* **T7 — "Shadow before production" has no exit criterion.** Phase D says "prove replay
stability before promotion" but defines no metric/baseline/threshold. Without a
falsifiable promotion gate, shadow can become *shadow forever*.
* **Meta — selector precision vs. flow truth.** The most visible failures in real specs
(unresolved step, duplicate click, assertion mismatch) are **flow/state** problems the
selector engine cannot touch — that's the paused graph module. Be deliberate that
selector precision is the chosen axis; perceived reliability may hinge as much on the
flow half.