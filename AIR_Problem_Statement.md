# AIR: Problem Statement, Purpose of the Gap Analysis, and What We Are Solving

> Written from the ground up based on actual code inspection, real failure observations,
> and direct conversation. No filler. No marketing language. Everything here is traceable
> to something real.

---

## 1. The Problem We Started With

### The AbhiBus Failure — A Concrete, Real Example

When AIR recorded a bus booking flow on AbhiBus and generated a Playwright script, the
script looked correct. It had the right selectors. The intent was clear. The steps made
sense when you read them.

When the test ran, it failed at the very first meaningful interaction:
```
Error: Please enter your Origin City
```

The generated code was:
```typescript
await page.locator('input[placeholder="Leaving From"]').fill('Hyderabad');
```

This is technically correct JavaScript. It types "Hyderabad" into the input. But AbhiBus
uses an autocomplete widget. When a user types "Hyderabad," a dropdown list of suggestions
appears. The user must then **click** on "Hyderabad" in that list. The `.fill()` alone does
not trigger the JavaScript event that registers the selection. The city is never confirmed.
The form refuses to proceed.

**The recorder captured the `input` event. It did not capture:**
1. The DOM mutation that happened after typing (the `<ul>` suggestion list appearing)
2. The `click` on the `<li>` item that the user actually clicked
3. The causal link between "the text was typed" and "a dropdown appeared as a result"

To the recorder, step 1 looked complete (`input` on a text field). Step 2 was a generic
`click` on a list item — disconnected, with no visible relationship to step 1.

The LLM received two disconnected events and generated code for them separately. Neither
alone was wrong. Together, they were incomplete — and the test failed on the very first run.

This is not an edge case. This happens on every application that uses custom autocomplete,
city pickers, location search, tag inputs, comboboxes, and any input that shows a suggestion
list. Which is most modern web applications.

---

## 2. The Wider Problem: Why All Existing Approaches Break Here

This is not an AIR-specific problem. Every tool in this space fails at the same place.

### Approach 1: Raw Record-and-Replay
Records DOM events literally. A click is a click. An input is an input. If the user's actual
gesture was "type + wait for dropdown + click suggestion," the recorder sees "input" and
"click" — two separate atoms with no relationship between them. The replay fails because
it executes the atoms, not the gesture.

### Approach 2: Playwright MCP / LLM-as-Runtime-Agent
The LLM drives the browser live, deciding each action in real time. This is powerful but
fundamentally misuses the LLM. The LLM:
- Has to process every live DOM state (slow, expensive)
- Makes decisions under time pressure (inconsistent)
- Cannot run in parallel (serial by nature)
- Produces different results on different runs (non-deterministic)
- Fails whenever the LLM's contextual understanding of the live DOM is wrong

For a CI pipeline that runs 500 tests in parallel at 2 AM, this is completely impractical.

### Approach 3: AI-Generated from Natural Language
"Write a test that books a bus from Hyderabad to Chennai on AbhiBus." The LLM generates
code from a description with no ground truth. It hallucates selectors. It invents steps that
don't match the real UI. The developer spends more time fixing the generated code than
writing it manually.

### What All Three Miss
None of these approaches make the distinction between:
- **What the user physically did** (keyboard + mouse events)
- **What the application responded with** (DOM mutations, network calls, quiescence)
- **What the complete user gesture was** (the intent behind the combination of both)

The gap is in the understanding of gestures, not individual events.

---

## 3. What AIR Is Actually Trying to Build

### The Core Architecture Idea

```
PHASE 1: RECORD (No LLM)         PHASE 2: GENERATE (LLM fires ONCE)    PHASE 3: EXECUTE (No LLM)
─────────────────────────         ─────────────────────────────────────  ─────────────────────────
Browser records rich signals:     LLM acts as a compiler:                Pure Playwright.
  - User events (12 types)          - Reads signal-rich payload           Deterministic.
  - DOM mutations                   - Recognizes incomplete gestures       Fast.
  - Network calls                   - Completes missing steps              Parallelizable.
  - Quiescence signals              - Flags fragile selectors              Runs in CI at scale.
  - Accessibility state             - Generates runnable, complete code
  - Custom dropdown detection     One output. Correct first time.
Store everything.
Classify nothing.
```

The LLM is **not** a runtime agent. It is a **one-time compiler** that:
- Receives a signal-rich recorded payload
- Understands the user's intent from combined signals
- Produces deterministic, executable Playwright code
- Never needs to run again for the same test

After the LLM fires once, no AI is needed for test execution. A test that runs 1,000 times
runs the same deterministic code all 1,000 times. This is why it scales.

### The Shift-Left Intelligence Principle
The insight is about **when** intelligence is applied:

| Approach | When LLM Runs | Cost Per Test Run |
|---|---|---|
| LLM-as-agent | Every test run, every step | Very High |
| AIR (target) | Once, at generation time | Zero (after first run) |
| Manual scripting | Never (human writes once) | Zero |

AIR's target position is: **human-level quality of reasoning, applied once, with zero
ongoing cost per execution.**

### Why "Signal-Rich" Is the Key Phrase
The LLM is powerful but only if it has enough information to reason from. If you give it
`type 'Hyderabad'` it cannot know if that is a simple text fill or an autocomplete gesture.
If you give it:
```json
{
  "action": "input",
  "intent": "type_leaving_from",
  "followupMutation": {
    "type": "list-appeared",
    "selector": "ul.city-suggestions",
    "itemCount": 8,
    "firstItemText": "Hyderabad"
  }
}
```
...it immediately recognizes an autocomplete pattern and generates the correct two-step
gesture. Same LLM. Same model. Completely different outcome — because the input was right.

**The difference between a failing test and a passing test is 15 lines of code in the
interceptor.** That is the gap.

---

## 4. Why the Gap Analysis Was Necessary (The Direct Answer)

### The Backstory
After the AbhiBus failure and the architectural discussions, there was a clear 3-phase plan:
1. **Phase 1**: Make generated scripts runnable on first generation (no debugging needed)
2. **Phase 2**: Autonomous self-healing when the app UI changes
3. **Phase 3**: Bounded autonomous re-recording when entire flows change

The obvious next step is to start building. But before writing a single line, a question
had to be answered:

> *"In which position is the codebase? What already exists? What is actually missing?
> What do we need to change vs. what do we need to build from scratch?"*

If this question is not answered first:
- You build something that already exists (wasted effort)
- You miss something that must change in a different file (broken integration)
- You underestimate what Phase 2 actually requires (surprise architectural work)
- You make a change that breaks a contract between layers (regression)

### What the Gap Analysis Is
A direct code inspection — no assumptions, no architecture documents, no guessing — of
every file in the critical path between the browser recording and the LLM output.

Files read directly:
- `interceptor.js` (3,529 lines) — the recorder
- `core/types/events.ts` (333 lines) — the wire contract between recorder and server
- `core/graph/graph-builder.ts` (1,043 lines) — the event-to-graph orchestrator
- `core/graph/state-engine.ts` (134 lines) — the page-state hashing engine
- `core/graph/intent-detector.ts` (119 lines) — the semantic intent generator
- `core/db/migrations.ts` (420 lines) — the full SQLite schema
- `core/types/generation.ts` (230 lines) — the LLM contract
- `packages/codegen/src/generation-builder.ts` (639 lines) — the context builder
- `packages/codegen/src/smoke/smoke-classifier.ts` (95 lines) — failure classifier
- `packages/codegen/src/smoke/smoke-repair.ts` (13KB) — repair system
- All 4 MCP server tools
- All 7 DB repositories

The output is a factual registry of what exists, what is missing, and where exactly to
change each file.

---

## 5. What We Discovered (The Findings That Mattered)

### Finding 1: The Failure Classifier Already Exists
This was the biggest surprise. In `packages/codegen/src/smoke/smoke-classifier.ts`, there
is already a complete failure classification system:

```
null                → test passed
locator_not_found   → selector stale (the Phase 2 primary healing target)
locator_ambiguous   → multiple matches
action_timeout      → element found but action timed out
assertion_failure   → expect() failed (NEVER auto-heal this)
compile_error       → syntax or module error in generated code
navigation_timeout  → URL/navigation related failure
runtime_unknown     → catch-all
```

This is exactly what Phase 2 needs. The bones of the autonomous healing architecture are
already there. They just need to be wired to a CI trigger and a healing loop.

**Practical implication:** Phase 2 was assumed to be "build from scratch." It is not.
Phase 2 starts from a partially-built foundation. The estimate for Phase 2 just dropped
significantly.

### Finding 2: The Graph Is Built But Nobody Can Read It
The `core/graph/` system builds a live probabilistic map of every application recorded:
- **Nodes** = unique UI states (pages), identified by a SHA-256 hash of their functional anchors
- **Edges** = transitions between states, with `sample_size` (how many times observed) and `outcome_type`
- **Outcomes** = probabilistic targets, with Laplace-smoothed probability

This graph records EVERYTHING across ALL sessions automatically. If 10 QA engineers record
the same booking flow, the edges have `sample_size=10`. High sample = high confidence in
that path.

The `StateEngine` even has a Jaccard similarity function (`calculateSimilarityScore`) that
can compare two page states by their semantic tokens — exactly what Phase 2 needs to find
"the page moved, but here is where it probably went."

**The problem:** There is no API for any of this. No MCP tool. No REST route. No
endpoint that the LLM or the healing system can query. The graph exists, is fully populated,
and is completely invisible to anyone outside the graph-builder.

`nodeRepo.getAll()` and `edgeRepo.getAll()` are already implemented in the repositories.
They just need an endpoint.

**Practical implication:** Building `get_app_graph` as an MCP tool is a LOW effort, HIGH
value item. The data is there. The query is written. It needs a wrapper.

### Finding 3: A Contract Bomb Waiting to Go Off
`GenerationStepV1` — the data structure the LLM reads to generate code — is defined in
**two separate files**:
- `core/types/generation.ts` (the canonical source)
- `packages/codegen/src/runtime-schemas.ts` (a copy)

They are kept in sync only by a code comment that says "Must stay in sync." There is no
compile-time enforcement, no test, no check. The moment someone adds a field to one and
forgets the other — which is a matter of when, not if — the LLM receives stale data and
generates broken code, with no error, no warning, and no way to detect it from the output.

**Practical implication:** This must be resolved before Phase 1 ships. It is a single-file
refactor (make one import from the other) but it has zero impact on functionality and
eliminates an entire class of silent failures.

### Finding 4: The Interceptor Change and the Schema Change Must Be Atomic
The biggest gap for Phase 1 (autocomplete detection) requires a change in the interceptor:
add a `followupMutation` field to the input event payload when a dropdown appears after
typing.

But `InputEventSchema` in `core/types/events.ts` does NOT have this field. The server
uses Zod to validate incoming events. **Zod strips unrecognised fields silently.** If the
interceptor sends `followupMutation` and the schema doesn't know about it, the field
disappears before it reaches the database — without any error.

This means the interceptor fix and the schema fix are a single atomic change. If anyone
does one without the other, the fix silently does nothing.

**Practical implication:** Document this dependency explicitly. Any PR for Gap #2 must
touch both `interceptor.js` AND `core/types/events.ts` or it is incomplete.

### Finding 5: The Graph Confidence Data Never Reaches the LLM
The edges table has `sample_size`. The nodes table has `observation_count`. The outcomes
table has `probability` (Laplace-smoothed). None of this is included in the
`GenerationContextV1` that the LLM receives.

The LLM currently generates a test for a step with `sample_size=1` (recorded once, possibly
wrong) with the same confidence as a step with `sample_size=47` (well-tested across many
sessions). This is a missed signal.

If the LLM knew "this selector has been validated 47 times," it would write a more
assertive locator. If it knew "this step was only recorded once," it would add a comment
flagging it as fragile.

**Practical implication:** Adding `sampleSize` and `observationCount` to `GenerationStepV1`
is a schema addition and a DB query addition — medium effort with meaningful LLM output
quality improvement.

---

## 6. What We Are Solving — Layered, From Root to Leaf

### Layer 0: The Fundamental Problem
Current test automation tools either require a human to maintain tests manually (expensive,
doesn't scale) or they use AI at runtime in ways that are slow, expensive, and
non-deterministic (doesn't work in CI).

Neither approach is acceptable for a serious QA team running hundreds of tests per day.

### Layer 1: The First-Run Failure Problem (Phase 1)
Scripts generated by AIR are syntactically correct but semantically incomplete. They fail
on the first run because the recording misses multi-step gestures (autocomplete, date
pickers, drag-drop, file upload with custom UI).

**What we are solving:** Make the recording complete enough that the LLM can produce a
runnable script on the very first generation. No manual debugging. No "fix the selector."
Run it and it works.

**How:** Add post-input mutation detection to the interceptor. Add sequence analysis to the
generation pipeline. Surface fragility signals as first-class fields in the LLM contract.

### Layer 2: The Maintenance Problem (Phase 2)
Even if a test runs on day one, it breaks when the application UI changes. A developer
renames a button. A designer restructures the form layout. A product manager changes the
booking flow. The test that worked yesterday fails today — and nobody knows which of the
500 tests are affected until CI runs at 2 AM.

**What we are solving:** When a test fails due to a UI change (specifically `locator_not_found`),
automatically:
1. Identify which selector broke and where it is in the codebase
2. Navigate to the live page
3. Capture a localized DOM snapshot around where the element should be
4. Ask the LLM (with a tightly constrained input) to propose a new locator
5. Validate the proposed locator against the live page
6. If it passes, update the POM file and log the healing event
7. If it doesn't pass, escalate to a human with full context

The `smoke-classifier.ts` already does step 1. The Playwright browser infrastructure
in the VSCode extension already does steps 2 and 5. The graph's `interaction_contexts`
table already stores step 3. Only steps 4, 6, and 7 need to be built from scratch.

**What we are NOT solving in Phase 2:** Assertion failures. If `expect(page).toHaveText()`
fails, the application behavior changed — not just the selector. That requires human judgment.
The system will never auto-heal an assertion failure. This is a hard constraint, already
enforced by the `smoke-classifier.ts` design.

### Layer 3: The Scale and Flow-Change Problem (Phase 3)
When entire flows change (the booking process gains a new step, the login page is
redesigned), individual test healing is not enough. The whole test needs to be re-recorded.

**What we are solving:** Using the graph (which already knows the old flow as a node-edge
chain), detect when a flow has structurally diverged. Then, using bounded autonomous
re-recording (with human confirmation gates), propose an updated test flow.

This is Phase 3. It is out of scope until Phase 2 is stable.

---

## 7. The Benefit — What QA Engineers Get From This

### Today (Without These Changes)

1. QA engineer records a session → script generated → script fails on first run
2. QA engineer debugs the script, discovers the autocomplete wasn't captured
3. QA engineer manually writes `await page.locator('ul li').first().click()`
4. Test works. But tomorrow a developer changes the dropdown library. The selector breaks.
5. CI fails at 2 AM. QA engineer spends 30 minutes in the morning finding the broken test.
6. QA engineer fixes the selector. Repeat step 5 next sprint.

**Cost:** Every test requires a human in the loop for creation AND for every UI change.
This is why "QA automation" backlogs grow and test suites decay over time.

### After Phase 1

1. QA engineer records a session → script generated → script runs correctly the first time
2. No debugging. No manual selector writing. Done.

**Benefit:** QA engineers can record and ship tests at the speed of recording, not at the
speed of manual debugging. A 10-minute recording produces a 10-minute test, not a 2-hour
debugging session.

### After Phase 2

1. Developer renames a button → CI detects `locator_not_found` → healer runs
2. Healer navigates to the live page, captures the area, asks LLM for a new locator
3. LLM proposes `page.getByRole('button', { name: 'Book Now' })`
4. Healer validates: element found, visible, action succeeds, test passes
5. POM file updated automatically. Healing log appended. PR created (optional).
6. QA engineer receives notification: "Test healed. Review the proposed change."

**Benefit:** UI changes no longer break tests silently. Tests self-maintain between UI
iterations. QA engineers review healing decisions rather than performing them manually.
The test suite stays healthy without manual maintenance work.

### After Phase 3

1. The entire checkout flow changes (new page added between search and payment)
2. Graph detects: old flow path (search → payment) no longer exists as recorded
3. System proposes: re-record this flow? Here is the new suggested path based on graph analysis.
4. QA engineer approves → re-recording runs autonomously → new test generated
5. Old test archived. New test validated.

**Benefit:** Entire test suites survive major product redesigns without being thrown away
and rebuilt from scratch.

---

## 8. What Makes This Different From Everything Else

| Dimension | Playwright MCP Agent | GitHub Copilot for Tests | Selenium AI | AIR (Target) |
|---|---|---|---|---|
| LLM at runtime? | Yes (every step) | No | No | No |
| LLM at generation? | No | Yes (from description) | Yes (from description) | Yes (from recorded signals) |
| Ground truth? | Live DOM | Natural language description | Natural language description | Actual recording + DOM mutations + network |
| First run success? | Usually | Rarely | Rarely | Target: Always |
| Self-healing? | No | No | No | Phase 2 target |
| CI-safe? | No (slow, serial) | Yes | Yes | Yes |
| Cost per test run? | LLM cost × steps × runs | Zero (after generation) | Zero | Zero (after generation) |
| Deterministic? | No | Yes | Yes | Yes |

The key differentiator is **ground truth**. When the LLM works from a recorded session
with DOM mutations, quiescence signals, and network calls — rather than from a natural
language description or a live DOM screenshot — it can produce code that matches the
actual application behavior, not a plausible approximation of it.

---

## 9. Why the Gap Analysis Was the Right First Move (Not Coding)

It would have been easy to immediately start writing the post-input mutation observer code
in the interceptor. That would have been wrong for three reasons:

**Reason 1: The schema dependency would have been missed.**
The interceptor sends data. The server validates it with Zod. If the schema isn't updated
atomically, the data is silently dropped. Discovering this mid-development wastes a full
debugging session.

**Reason 2: The smoke classifier already exists.**
If Phase 2 work started without reading `smoke-classifier.ts`, someone would have built
a failure classification system that already exists. That is 2-3 days of work thrown away.

**Reason 3: The graph is the Phase 2 foundation.**
The `get_app_graph` MCP tool is LOW effort because the repository methods are already
written. If the graph system was not read thoroughly, this would have been treated as a
"build from scratch" item — significantly overestimating Phase 2 scope.

The gap analysis found that the most important Phase 2 infrastructure is already built.
The most important Phase 1 fix is 15 lines of MutationObserver code. The most dangerous
hidden risk is a silent Zod field-stripping behavior and a dual-definition drift problem.

None of these were visible without reading the code.

---

## 10. The 10 Gaps, Summarized in Plain Language

| # | What Is Missing | Why It Matters | Effort |
|---|---|---|---|
| 1 | ARIA-less autocomplete not detected by interceptor | Any plain `<input>` → dropdown flow fails on first run | Medium |
| 2 | No mutation correlation added to input events | LLM sees disconnected events, not a complete gesture | Medium |
| 2b | `InputEventSchema` has no `followupMutation` field | Zod will strip the new field silently if schema isn't updated | Low |
| 3 | No sequence analysis pass before code generation | LLM generates per-step without seeing cross-step patterns | High |
| 4 | Fragility warnings buried deep in nested objects | LLM must traverse 4 levels to find `warningCodes`, often misses them | Low |
| 5a-f | CI-to-healer pipeline is not wired | The failure classifier exists but has no trigger, no live snapshot, no commit | High |
| 6 | MCP pagination has no `totalSteps` or `hasMore` | LLM cannot know if it received all steps or was cut off | Low |
| 7 | Graph has no MCP tool or REST endpoint | LLM cannot query the application model for Phase 2 healing | Medium |
| 8 | `sample_size` and `observation_count` not in LLM context | LLM treats single-recorded steps as confidently as well-tested ones | Medium |
| 9 | Dual definition of `GenerationStepV1` | Schema drift is silent — LLM gets stale data with no error | Low |
| 10 | `edges` table has no `intent` column | Phase 2 healer must JOIN through events to get gesture labels for edges | Low |

---

## 11. The Honest Assessment

This is not a project that is in bad shape. The AIR codebase has:
- A sophisticated 12-class selector resolver (4,511 lines)
- A complete probabilistic graph of every recorded application
- A failure classifier with exactly the right categories for Phase 2
- A Zod-validated event contract with no implicit coercions
- A working multi-tab, multi-session recording pipeline
- A deterministic state hashing engine with Jaccard similarity

The gaps are real and specific. They are not architectural problems. They are:
- **One missing field** in the interceptor (the most impactful change)
- **One missing endpoint** exposing the graph (the most impactful Phase 2 enabler)
- **One schema synchronization** that needs a code comment replaced with an import
- **One CI wiring** to connect the failure classifier to the healing loop

The work ahead is surgical, not foundational. The foundation is there.

---

*Document prepared: 2026-08-15*
*Based on: Direct code inspection of 12 source files totalling ~19,000 lines,
real failure observation on AbhiBus booking flow, and architectural discussions
across the full conversation thread.*
