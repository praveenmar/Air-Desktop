# Architecture: Open AI Semantic Memory Layer for Playwright Test Automation

## Overview

This document outlines an open-source semantic memory architecture that sits between deterministic test automation and AI-assisted browser interaction.

The goal is **not to replace Playwright, build another autonomous testing platform, or make an LLM execute every test action**.

The goal is to create an open semantic layer that allows Playwright automation to remember what UI elements and actions mean, execute known interactions deterministically, and use AI only when the application's current state no longer matches the system's accumulated knowledge.

The core philosophy is:

> **Do not make AI rediscover what the automation system already knows.**

A web application constantly evolves. UI text changes, DOM structures change, selectors change, components are redesigned, and workflows are modified. Therefore, semantic memory must not be treated as permanent truth.

Instead:

> **Memory is learned knowledge backed by evidence, history, context, and confidence.**

When the memory becomes stale or uncertain, the system can use Playwright MCP / AI agents to investigate the current application, verify the intended action, and update the memory.

---

# The Core Architecture

```text
                    Test Intent
                        │
                        ▼
              ┌─────────────────────┐
              │   Semantic Memory   │
              │                     │
              │ Intent              │
              │ UI Context          │
              │ Representations     │
              │ History             │
              │ Evidence            │
              │ Confidence          │
              └──────────┬──────────┘
                         │
                         ▼
                Resolution / Validation
                         │
             ┌───────────┴───────────┐
             │                       │
        Memory Valid            Memory Suspect
             │                       │
             ▼                       ▼
        Playwright            Recovery Pipeline
        Fast Path                    │
                                     ▼
                           Candidate Resolution
                                     │
                                     ▼
                         Playwright MCP / AI Agent
                                     │
                                     ▼
                              Intent Verification
                                     │
                                     ▼
                              Memory Update
                                     │
                                     ▼
                                Playwright
```

The system therefore has two fundamentally different execution modes:

### Fast Path

Use existing semantic memory and execute through Playwright without involving an LLM.

### Recovery Path

When memory becomes invalid, stale, ambiguous, or insufficient, use Playwright MCP / AI to investigate the current UI and update the semantic memory.

The AI becomes a **recovery and learning mechanism**, rather than the default execution engine.

---

# The Three Core Layers

## 1. The Intent Layer

The test describes **what should happen**, rather than encoding how the browser should physically locate the element.

Example:

```javascript
await semantic.click(page, "Submit the checkout");
```

The important information is:

```text
Intent:
    Submit the checkout
```

The intent can come from:

- Playwright test code
- Plain text
- Cucumber/Gherkin
- AI-generated tests
- Recorded workflows
- Other automation systems

The semantic memory layer should not require a particular test-authoring style.

Its responsibility is to understand and preserve the meaning of the action.

---

# 2. The Semantic Memory Layer

This is the core of the system.

The memory does **not** simply store:

```text
"Submit checkout" → "#submit"
```

Instead, it stores a semantic representation of the target and the evidence supporting that representation.

A memory entry can contain:

```text
Intent
    ↓
UI Context
    ↓
Target Identity
    ↓
Possible Representations
    ↓
Historical Evidence
    ↓
Confidence
    ↓
Lifecycle / Health
```

For example:

```json
{
  "intent": "submit_checkout",

  "context": {
    "page": "/checkout",
    "applicationState": "authenticated"
  },

  "target": {
    "role": "button",
    "name": "Place order"
  },

  "representations": [
    {
      "type": "playwright",
      "value": "getByRole('button', { name: 'Place order' })"
    },
    {
      "type": "testId",
      "value": "place-order"
    }
  ],

  "evidence": {
    "successfulExecutions": 4821,
    "failedExecutions": 3,
    "lastVerified": "2026-08-29"
  },

  "confidence": 0.97,

  "status": "healthy"
}
```

The selector is therefore only **one representation of an intended UI target**.

It is not the actual source of truth.

---

# 3. The Execution / Intelligence Layer

Playwright remains the execution engine.

The semantic layer ultimately resolves an intent into an executable interaction that Playwright can perform.

```text
Semantic Intent
      ↓
Semantic Memory
      ↓
Resolved Target
      ↓
Playwright
      ↓
Browser
```

When the memory cannot confidently resolve the intent, the system can use Playwright MCP / AI agents as an investigation mechanism.

```text
Memory
   ↓
Uncertain
   ↓
Playwright MCP
   ↓
Current UI investigation
   ↓
Candidate discovery
   ↓
Intent verification
   ↓
Updated memory
   ↓
Playwright execution
```

---

# Memory Is Not a Cache

The system should not be designed around the assumption that:

> selector exists = memory is valid.

A selector may still resolve while pointing to the wrong element.

Example:

Previous application:

```text
button: "Submit Order"
```

New application:

```text
button: "Submit Order"
button: "Submit Refund"
```

A simplistic locator cache may still return a valid element.

The semantic memory layer must instead determine whether the **meaning and context of the target remain consistent**.

Therefore:

> **The system stores semantic knowledge and evidence, not just selectors.**

---

# Memory Lifecycle

Because applications constantly evolve, memory requires a lifecycle.

```text
NEW
 ↓
VERIFIED
 ↓
HEALTHY
 ↓
SUSPECT
 ↓
STALE
 ↓
REVALIDATED
 ↓
HEALTHY
```

Possible states:

```text
NEW
    Newly discovered memory.

VERIFIED
    Successfully confirmed against the application.

HEALTHY
    Repeated successful use with strong supporting evidence.

SUSPECT
    Some evidence suggests the UI or application context has changed.

STALE
    The existing representation is no longer considered trustworthy.

INVALID
    The memory representation is known to be incorrect.

REVALIDATED
    A previous memory entry has been investigated and confirmed again.
```

This allows the system to distinguish:

```text
"I haven't seen this before."

from

"I know this, but my knowledge may no longer be valid."
```

---

# Detecting Stale Memory

The system should continuously collect signals that indicate whether a memory entry is still trustworthy.

Possible signals include:

```text
Locator success/failure
Accessible name changes
Role changes
DOM structure changes
Parent/ancestor changes
Page/state changes
Element relationships
Historical selector success
Target position/context
Application version/build
Visual or structural similarity
Action outcome
```

For example:

```text
Intent:
    Submit checkout

Known target:
    button "Place order"

Previous success:
    4,821 executions

Current observation:
    button text changed to "Complete purchase"

Memory confidence:
    0.61

Status:
    SUSPECT
```

The system should not immediately discard the old memory.

Instead, it should attempt to determine whether the **same semantic target has changed representation**.

---

# Versioned Memory

Memory should also retain historical representations rather than blindly overwriting them.

Instead of:

```text
old selector
    ↓
new selector
    ↓
delete old
```

The system should maintain:

```text
Semantic Identity
       │
       ├── Representation v1
       ├── Representation v2
       ├── Representation v3
       └── Current preferred representation
```

Example:

```text
Intent:
    submit_checkout

History:

v1
    #submit

v2
    [data-testid="checkout-submit"]

v3
    getByRole("button", { name: "Complete purchase" })
```

The memory can then retain:

```text
when the representation was successful
how often it succeeded
what application state it belonged to
why it was replaced
what replaced it
```

This makes the memory evolutionary rather than disposable.

---

# The Fast Path

The normal execution path should be extremely cheap.

```text
Test Intent
    ↓
Memory Lookup
    ↓
Context Match
    ↓
Representation Validation
    ↓
Playwright
```

Example:

```javascript
await semantic.click(page, "Submit the checkout");
```

Memory:

```text
Intent:
    Submit checkout

Known context:
    /checkout

Known representation:
    role=button
    name="Place order"

Confidence:
    0.98

Status:
    HEALTHY
```

The system can directly use the known Playwright representation.

No LLM call is necessary.

This preserves the speed and determinism expected from conventional Playwright automation.

---

# The Recovery Path

When the fast path fails or memory becomes suspicious:

```text
Intent
  ↓
Memory
  ↓
Current representation fails / becomes uncertain
  ↓
Collect current browser context
  ↓
Generate candidate targets
  ↓
Semantic verification
  ↓
If still uncertain → Playwright MCP / AI
  ↓
AI investigates current UI
  ↓
Verify intended target
  ↓
Create/update memory
  ↓
Execute through Playwright
```

The key principle is:

> **AI should investigate the unknown, not repeatedly solve the known.**

---

# Playwright MCP / AI Integration

Modern browser agents can already interact with web applications through Playwright-based MCP interfaces.

The semantic memory layer should not try to replace this capability.

Instead, it should provide the AI agent with **relevant historical knowledge before the agent begins investigating**.

Without memory:

```text
LLM
 ↓
Current UI
 ↓
Figure everything out
```

With semantic memory:

```text
LLM
 ↓
Intent
 +
Relevant memory
 +
Historical representations
 +
Current context
 +
Known failure reason
 ↓
Investigate only what changed
```

Example AI context:

```text
Intent:
    Submit checkout

Application:
    Checkout page

Previous target:
    button "Place order"

Previous Playwright representation:
    getByRole("button", { name: "Place order" })

Memory health:
    SUSPECT

Reason:
    Previous accessible name no longer exists.

Historical alternatives:
    "Complete purchase"
    "Place order"

Current candidate elements:
    1. button "Complete purchase"
    2. button "Continue"
    3. button "Save"

Recommended verification:
    Confirm the candidate belongs to the checkout
    submission flow.
```

The AI does not need to reconstruct the entire application's meaning from scratch.

---

# Semantic Context as an AI Input Contract

One of the main responsibilities of this layer is to provide a compact and useful context package to AI agents.

The output should be something like:

```text
Semantic Context
───────────────────────────

Intent:
    Submit checkout

Current page:
    /checkout

Known semantic target:
    Checkout submission button

Previous representation:
    role=button[name="Place order"]

Memory status:
    SUSPECT

Why:
    Accessible name changed.

Historical successful variants:
    "Place order"
    "Complete purchase"

Candidate targets:
    Candidate A → 0.94
    Candidate B → 0.42
    Candidate C → 0.17

Required verification:
    Same checkout submission intent
```

This context is more useful than simply sending raw DOM and asking the LLM:

> “Figure this out.”

---

# Token and AI Cost Optimization

The semantic memory layer should also minimize unnecessary model usage.

The architecture should follow a progressive resolution strategy:

```text
Intent
   ↓
Memory lookup
   ↓
Known valid representation?
   │
   ├── YES
   │     ↓
   │  Playwright
   │
   └── NO
         ↓
    Cheap deterministic checks
         ↓
    Semantic candidate scoring
         ↓
    Local / cheaper intelligence
         ↓
    Playwright MCP / larger LLM
```

The objective is not to use AI as much as possible.

The objective is to use **the minimum intelligence required to safely resolve the action**.

Potential benefits include:

```text
Lower token usage
Fewer model calls
Lower latency
Lower inference cost
Less repeated reasoning
More deterministic CI execution
```

These should eventually be validated through real benchmarks rather than assumed as marketing claims.

---

# Candidate Resolution

When memory becomes stale, the system should first generate possible candidates using information available in the current page.

Candidates can be ranked using signals such as:

```text
Accessible role
Accessible name
Text similarity
DOM structure
Parent/ancestor relationship
Nearby elements
Historical representation
Page/state context
Element attributes
Position
Visibility
Enabled state
Historical success
```

Example:

```text
Intent:
    Submit checkout

Candidate A
    button "Complete purchase"
    score: 0.95

Candidate B
    button "Continue"
    score: 0.44

Candidate C
    button "Save"
    score: 0.18
```

The system can use AI only when deterministic or local semantic reasoning cannot provide sufficient confidence.

---

# Verification Before Healing

A critical rule of the system is:

> **Finding an element is not the same as proving that the element represents the intended action.**

The system should therefore separate:

```text
Candidate Generation
```

from:

```text
Candidate Verification
```

For example:

```text
Candidate:
    button "Complete purchase"

Verification:

Role matches
        ✓

Semantic intent matches
        ✓

Checkout context matches
        ✓

Historical relationship matches
        ✓

Expected action outcome matches
        ✓

Final confidence:
    0.96
```

Only after sufficient verification should the system automatically update memory.

---

# The System Must Be Able to Say "I Don't Know"

One of the core principles of the project is:

> **Never convert uncertainty into a false test pass.**

Example:

```text
Intent:
    Delete account

Candidates:

A. Delete account
B. Delete workspace

AI confidence:
    0.61

Result:
    Automatic healing rejected.
```

Instead:

```text
TEST FAILED

Reason:
    Existing semantic memory is stale and
    multiple candidates cannot be confidently
    distinguished.

Evidence:
    ...
```

This preserves the purpose of testing.

A self-healing system that silently performs the wrong action is worse than a broken test.

---

# Learning From Successful Recovery

When AI successfully resolves a stale memory:

```text
Old memory
    ↓
Current UI investigation
    ↓
Verified replacement
    ↓
New memory representation
```

The system stores:

```text
What changed
Why the previous representation failed
What the new representation is
Why it is considered equivalent
What evidence supports the change
When the change occurred
How future executions should resolve it
```

This means each recovery can make future runs cheaper and more deterministic.

---

# The Learning Loop

```text
              ┌──────────────────────┐
              │      Test Intent     │
              └──────────┬───────────┘
                         ↓
                Semantic Memory
                         ↓
                  Execute Fast
                         ↓
                     Success
                         │
                         └───────────┐
                                     │
                                     ▼
                              Memory Evidence
                                     │
                                     │
                  UI evolves        │
                       ↓             │
                 Memory becomes      │
                   suspicious        │
                       ↓             │
                 AI / MCP recovery   │
                       ↓             │
                 Verify intent       │
                       ↓             │
                  Update memory ─────┘
```

The system therefore continuously evolves alongside the application.

---

# Open Architecture Philosophy

The project should remain an infrastructure layer rather than becoming an all-in-one testing platform.

## Playwright First

The initial implementation should focus on Playwright.

```text
Semantic Memory Core
        +
Playwright Adapter
```

The core semantic model should remain independent from Playwright wherever possible.

This allows future adapters without changing the underlying memory model.

Potential future integrations:

```text
Playwright
Selenium
Appium
Cucumber
Browser agents
IDE tooling
CI systems
```

These are future possibilities and should not complicate the first implementation.

---

# Model Provider Independence

The semantic memory layer should not depend on a single AI vendor.

Possible intelligence providers:

```text
OpenAI
Anthropic
Gemini
Local models
Ollama
Enterprise models
Custom AI infrastructure
```

The layer should provide a standard interface for AI-assisted recovery while allowing users to choose their own model/provider.

The core project should remain useful even without a hosted AI service.

---

# Local-First Memory

Where possible, memory should be usable locally.

Example:

```text
Project
 └── semantic-memory/
       ├── intents/
       ├── representations/
       ├── history/
       └── evidence/
```

The goal is to avoid forcing application-specific knowledge into a third-party cloud.

This is especially important for enterprise applications containing sensitive internal information.

---

# Open Memory Format

The memory representation itself should ideally be open and portable.

For example:

```json
{
  "intent": "submit_checkout",

  "context": {
    "page": "/checkout"
  },

  "target": {
    "role": "button",
    "name": "Place order"
  },

  "representations": [],

  "evidence": [],

  "history": [],

  "confidence": 0.97,

  "status": "healthy"
}
```

The objective is that the learned knowledge belongs to the automation project rather than becoming locked inside a proprietary platform.

---

# Core Design Principles

### 1. Deterministic First

Known actions should execute through Playwright without unnecessary AI involvement.

### 2. AI on Demand

AI should be used when the system encounters uncertainty, change, or ambiguity.

### 3. Memory Is Not Truth

Every memory entry can become stale.

### 4. Evidence Matters

The system should know why it trusts a memory.

### 5. Verification Before Healing

Finding a plausible replacement is not enough.

### 6. History Over Overwrite

Previous representations should be retained rather than blindly deleted.

### 7. Context Over Selectors

The selector is a representation of the target, not its identity.

### 8. Model Agnostic

The semantic layer should not depend on one LLM vendor.

### 9. Local and Portable

Application knowledge should remain accessible and portable.

### 10. Failure Is Better Than False Success

The system must be allowed to refuse automatic recovery when confidence is insufficient.

---

# Minimal Initial Scope

The first implementation should remain deliberately small.

### Initial focus

```text
Playwright
+
Semantic Intent
+
Persistent Semantic Memory
+
Deterministic Resolution
+
Stale Memory Detection
+
Candidate Generation
+
Verification
+
Playwright MCP / AI Recovery
+
Memory Update
```

Initial actions:

```text
click
fill
select
```

Example:

```javascript
await semantic.click(page, "Submit the checkout");

await semantic.fill(
  page,
  "Customer email",
  "customer@example.com"
);
```

The objective of the first implementation is not to automate everything.

The objective is to prove one core hypothesis:

> **Can a persistent semantic memory layer allow Playwright tests to survive normal UI evolution while reducing unnecessary AI reasoning and locator maintenance?**

---

# Long-Term Vision

The long-term goal is not another proprietary AI testing platform.

The goal is to provide an **open semantic infrastructure layer for test automation**.

```text
                   Test Automation
                         │
           ┌─────────────┴─────────────┐
           │                           │
     Human-authored                 AI-authored
         tests                         tests
           │                           │
           └─────────────┬─────────────┘
                         ↓
              Open Semantic Memory
                         ↓
          ┌──────────────┼──────────────┐
          │              │              │
       Intent         Context        Evidence
          │              │              │
          └──────────────┼──────────────┘
                         ↓
                Resolution Runtime
                         ↓
               ┌─────────┴─────────┐
               │                   │
        Deterministic          AI Recovery
          execution             / MCP
               │                   │
               └─────────┬─────────┘
                         ↓
                    Playwright
                         ↓
                    Application
```

The fundamental idea is simple:

> **Tests should remember what they mean, not just how the UI looked when the test was written.**

And when the application changes:

> **AI should help the memory adapt, rather than forcing the AI to rediscover the application from scratch on every execution.**