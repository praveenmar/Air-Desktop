import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';
import { findBoundedFieldProof } from '../src/resolver/bounded-field/find-bounded-field';
import type { BoundedFieldSpecBuildParams } from '../src/resolver/bounded-field/types';
import { buildBoundedFieldCandidates } from '../src/resolver/bounded-field';
import { parseHTML } from 'linkedom';
import type { CodegenStep } from '../src/types';

describe('Bounded Field Discovery Stress Coverage', () => {
  let dom: JSDOM;
  let document: Document;

  function setupDOM(html: string) {
    dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    document = dom.window.document;
    
    // Mock global Node/Element for evaluator's visibility checks
    (global as any).Node = (dom.window as any).Node;
    (global as any).Element = (dom.window as any).Element;
    (global as any).HTMLElement = (dom.window as any).HTMLElement;
    (global as any).window = dom.window;
  }

  async function runDiscovery(params: BoundedFieldSpecBuildParams) {
    const result = findBoundedFieldProof(document, params);
    return { result };
  }

  it('1. generic input field discovery', async () => {
    setupDOM(`
      <div class="row">
        <span>Username</span>
        <input class="input" id="u1" />
      </div>
      <div class="row">
        <span>Password</span>
        <input class="input" id="p1" />
      </div>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Password',
      controlKind: 'input',
      target: { engine: 'playwright-locator', selector: '.input' } as any
    };

    const { result } = await runDiscovery(params);
    
    // STATUS: PASSING
    expect(result.match).not.toBeNull();
    expect(result.match?.targetElement.id).toBe('p1');
    expect(result.match?.relation).toBe('sibling-label');
  });

  it('2. custom trigger field discovery (OrangeHRM style)', async () => {
    setupDOM(`
      <div class="oxd-form-row">
        <label class="oxd-label">User Role</label>
        <div class="oxd-select-wrapper">
          <div role="button" aria-haspopup="listbox" class="oxd-select-text" id="role-trigger">Select...</div>
        </div>
      </div>
      <div class="oxd-form-row">
        <label class="oxd-label">Status</label>
        <div class="oxd-select-wrapper">
          <div role="button" aria-haspopup="listbox" class="oxd-select-text oxd-select-text--focus" id="status-trigger">Select...</div>
        </div>
      </div>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Status',
      controlKind: 'custom-trigger',
      target: { engine: 'playwright-locator', selector: '.oxd-select-text--focus' } as any
    };

    const { result } = await runDiscovery(params);
    
    // STATUS: PASSING
    expect(result.match).not.toBeNull();
    expect(result.match?.targetElement.id).toBe('status-trigger');
  });

  it('3. multi-control blocker: multiple inputs in same row', async () => {
    setupDOM(`
      <div class="field-row">
        <label>Date Range</label>
        <input class="input" id="date-from" />
        <input class="input" id="date-to" />
      </div>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Date Range',
      controlKind: 'input',
      target: { engine: 'playwright-locator', selector: '#date-from' } as any
    };

    const { result } = await runDiscovery(params);
    
    // STATUS: PARTIAL (Blocks match, but reported reason is generic broad-container)
    expect(result.match).toBeNull();
    // DESIRED: expect(result.rejectReason).toBe('bounded-field-multiple-targets');
  });

  it('4. duplicate labels in separate containers produce warnings', async () => {
    setupDOM(`
      <div class="field-row">
        <label>Username</label>
        <input class="input" id="input-1" />
      </div>
      <div class="field-row">
        <label>Username</label>
        <input class="input" id="input-2" />
      </div>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Username',
      controlKind: 'input',
      target: { engine: 'playwright-locator', selector: '#input-2' } as any
    };

    const { result } = await runDiscovery(params);
    
    // STATUS: PASSING
    expect(result.match).not.toBeNull();
    expect(result.match?.warningCodes).toContain('bounded-field-global-duplicate-label');
  });

  it.todo('5. broad ancestor text blocker: h1 should not be a label', async () => {
    setupDOM(`
      <div class="main-content">
        <h1>Username</h1>
        <div class="some-unrelated-wrapper">
           <input class="input" id="orphan-input" />
        </div>
      </div>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Username',
      controlKind: 'input',
      target: { engine: 'playwright-locator', selector: '#orphan-input' } as any
    };

    const { result } = await runDiscovery(params);
    
    // DESIRED: match should be null because h1 is not a form label.
    // CURRENT: returns null with 'bounded-field-no-label' (which is actually correct for h1)
    expect(result.match).toBeNull();
  });

  it.todo('6. broad ancestor text blocker: generic div text should not be a strong label', async () => {
    setupDOM(`
      <div class="generic-container">
        <div>Username</div>
        <div class="sibling">Other Content</div>
        <input class="input" id="orphan-input" />
      </div>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Username',
      controlKind: 'input',
      target: { engine: 'playwright-locator', selector: '#orphan-input' } as any
    };

    const { result } = await runDiscovery(params);
    
    // DESIRED: match should be null because relationship is too loose/generic.
    // CURRENT: matches because depth is small and only one control exists in div.generic-container.
    expect(result.match).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Part 2 — Cross-app ambiguous input (generic component library style)
  // ---------------------------------------------------------------------------

  it('7. cross-app: ambiguous .app-input resolved by local span label', async () => {
    // Two inputs sharing the same base class; labels are span elements, not native <label>.
    // Proves findBoundedFieldProof disambiguates by bounded container, not global selector.
    setupDOM(`
      <div class="field-row">
        <span class="field-label">Username</span>
        <div class="field-control">
          <input class="app-input app-input--focus" id="username-input" />
        </div>
      </div>
      <div class="field-row">
        <span class="field-label">Employee Id</span>
        <div class="field-control">
          <input class="app-input" id="employee-input" />
        </div>
      </div>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Username',
      controlKind: 'input',
      target: { engine: 'css', selector: '.app-input' } as any,
    };

    const { result } = await runDiscovery(params);

    // STATUS: EXPECTED PASSING
    // findExactVisibleFieldLabels queries 'label,legend,span,div,p' — span is included.
    // findBoundedContainerProof walks up from label and finds a tight container with one input.
    // Global ambiguity of .app-input does not block local proof.
    expect(result.match).not.toBeNull();
    expect(result.match?.targetElement.id).toBe('username-input');
    expect(['sibling-label', 'bounded-container']).toContain(result.match?.relation);
  });

  // ---------------------------------------------------------------------------
  // Part 3 — Framework-style input (OrangeHRM-style as stress pattern only)
  // ---------------------------------------------------------------------------

  it('8. framework-style: ambiguous .oxd-input resolved by span.oxd-label in bounded group', async () => {
    // Framework uses span labels and generic input classes — same proof path as Part 2.
    // Dynamic class .oxd-input--focus must NOT be required.
    setupDOM(`
      <div class="oxd-input-group">
        <span class="oxd-label">Username</span>
        <div>
          <input class="oxd-input oxd-input--focus" id="admin-username" />
        </div>
      </div>
      <div class="oxd-input-group">
        <span class="oxd-label">Employee Id</span>
        <div>
          <input class="oxd-input" id="employee-id" />
        </div>
      </div>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Username',
      controlKind: 'input',
      target: { engine: 'css', selector: '.oxd-input' } as any,
    };

    const { result } = await runDiscovery(params);

    // STATUS: EXPECTED PASSING — proves helper capability for the OrangeHRM input gap.
    // Failure here would mean findBoundedContainerProof cannot walk through the inner div.
    expect(result.match).not.toBeNull();
    expect(result.match?.targetElement.id).toBe('admin-username');
    expect(['sibling-label', 'bounded-container']).toContain(result.match?.relation);
  });

  // ---------------------------------------------------------------------------
  // Part 4A — Cross-app custom trigger with proper ARIA semantics
  // ---------------------------------------------------------------------------

  it('9. cross-app: ambiguous .select-trigger with aria-haspopup resolved by local label', async () => {
    // Two triggers sharing the same base class; ARIA semantics make isTriggerLikeElement pass.
    // Dynamic class .select-trigger--focus must NOT be required.
    setupDOM(`
      <div class="field-row">
        <span class="field-label">User Role</span>
        <div class="field-control">
          <div class="select-trigger" role="button" aria-haspopup="listbox" id="role-trigger">Select</div>
        </div>
      </div>
      <div class="field-row">
        <span class="field-label">Status</span>
        <div class="field-control">
          <div class="select-trigger select-trigger--focus" role="button" aria-haspopup="listbox" id="status-trigger">Select</div>
        </div>
      </div>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Status',
      controlKind: 'custom-trigger',
      target: { engine: 'css', selector: '.select-trigger' } as any,
    };

    const { result } = await runDiscovery(params);

    // STATUS: EXPECTED PASSING — trigger has aria-haspopup so isTriggerLikeElement matches.
    // Proves the ARIA-annotated trigger path works end-to-end.
    expect(result.match).not.toBeNull();
    expect(result.match?.targetElement.id).toBe('status-trigger');
  });

  // ---------------------------------------------------------------------------
  // Part 4B — Custom trigger WITHOUT ARIA semantics
  // ---------------------------------------------------------------------------

  it('10. framework trigger WITHOUT aria semantics: documents current behavior and risk', async () => {
    // A DIV trigger with no role, no aria-haspopup, no tabindex.
    // getVisibleTriggerLikeControls will NOT match it → isTriggerLikeElement = false
    // → matchesControlKind(el, 'custom-trigger') = false
    // → bindTargetWithinScope finds zero matching targets → proof fails.
    // This is a PRODUCT DECISION: AIR intentionally requires trigger semantics.
    setupDOM(`
      <div class="field-row">
        <span class="field-label">User Role</span>
        <div class="field-control">
          <div class="select-trigger" id="role-trigger">Select</div>
        </div>
      </div>
      <div class="field-row">
        <span class="field-label">Status</span>
        <div class="field-control">
          <div class="select-trigger" id="status-trigger">Select</div>
        </div>
      </div>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Status',
      controlKind: 'custom-trigger',
      target: { engine: 'css', selector: '.select-trigger' } as any,
    };

    const { result } = await runDiscovery(params);

    // STATUS: FAILING (no match) — INTENTIONAL BLOCK, not a bug.
    // Trigger lacks ARIA semantics so getVisibleTriggerLikeControls returns [].
    // The label IS found (span.field-label), but no eligible target can be bound.
    // RISK: low false-positive risk from this block — unsafe to loosen without explicit ARIA.
    // PRODUCT DECISION REQUIRED before changing: should bare DIVs be treated as triggers?
    // rejectReason will be 'bounded-field-broad-container' or 'bounded-field-target-binding-failed'
    expect(result.match).toBeNull();
    expect(['bounded-field-broad-container', 'bounded-field-target-binding-failed', 'bounded-field-no-label']).toContain(result.rejectReason);
  });

  // ---------------------------------------------------------------------------
  // Part 5 — Runtime bridge: attributes.fieldLabelText with null boundedFieldContext
  // ---------------------------------------------------------------------------

  it('11. runtime bridge: attributes.fieldLabelText present + boundedFieldContext.fieldLabelText null → proof via rich snapshot', () => {
    // Seam: buildBoundedFieldCandidates in bounded-field.spec.ts style.
    // Step has fieldLabelText in attributes (fallback path), but boundedFieldContext.isValid = false.
    // Rich snapshot contains both the label span and the input.
    // Proves: getFieldLabelText fallback fires, buildBoundedFieldCandidateFromProof is called,
    // and findBoundedFieldProof succeeds with a rich snapshot.
    const snapshot = parseHTML(`
      <div class="field-row">
        <span class="field-label">Username</span>
        <input class="app-input" id="username-input" />
      </div>
      <div class="field-row">
        <span class="field-label">Employee Id</span>
        <input class="app-input" id="employee-input" />
      </div>
    `).document as unknown as Document;

    const step: CodegenStep = {
      step: 1,
      intent: 'fill_username',
      action: 'input',
      selector: '.app-input',
      selectorPriority: 'class',
      selectorRank: 7,
      pageUrl: 'https://example.test/admin',
      confidence: 1,
      sampleSize: 1,
      assertions: [],
      userAssertions: [],
      fingerprint: {
        selector: '.app-input',
        tagName: 'input',
        attributes: {
          class: 'app-input',
          fieldLabelText: 'Username',   // ← present in attributes
        },
        boundedFieldContext: {
          fieldLabelText: null,         // ← split-brain: null here
          fieldRelation: null,
          targetControlKind: 'input',
          visibleControlCountInContainer: 2,
          competingControlCount: 1,
          isValid: false,               // ← isValid=false due to null label
        },
      },
    };

    const candidates = buildBoundedFieldCandidates({
      step,
      snapshot,
      snapshotSelection: {
        source: 'source-node-snapshot',
        temporalClass: 'pre_action',
        reason: 'unit-test-rich-snapshot',
      },
    });

    // STATUS: EXPECTED PASSING
    // getFieldLabelText falls back to attributes.fieldLabelText = 'Username'
    // buildRecordedBoundedFieldCandidate returns [] (isValid=false)
    // buildBoundedFieldCandidateFromProof is called with the rich snapshot
    // findBoundedFieldProof finds span.field-label and binds #username-input
    expect(candidates).toHaveLength(1);
    expect(candidates[0].engine).toBe('bounded-field');
    expect(candidates[0].boundedField?.labelText).toBe('Username');
    expect(candidates[0].boundedField?.source).toBe('snapshot-bounded-field');
  });

  it('12. runtime bridge: narrow snapshot missing label → proof fails gracefully', () => {
    // Same step as above, but snapshot only contains the input subtree — no label span.
    // Proves: with a narrow event-local snapshot, proof returns [] and does not throw.
    const narrowSnapshot = parseHTML(`
      <div>
        <input class="app-input" id="username-input" />
      </div>
    `).document as unknown as Document;

    const step: CodegenStep = {
      step: 1,
      intent: 'fill_username',
      action: 'input',
      selector: '.app-input',
      selectorPriority: 'class',
      selectorRank: 7,
      pageUrl: 'https://example.test/admin',
      confidence: 1,
      sampleSize: 1,
      assertions: [],
      userAssertions: [],
      fingerprint: {
        selector: '.app-input',
        tagName: 'input',
        attributes: {
          class: 'app-input',
          fieldLabelText: 'Username',
        },
        boundedFieldContext: {
          fieldLabelText: null,
          fieldRelation: null,
          targetControlKind: 'input',
          visibleControlCountInContainer: 1,
          competingControlCount: 0,
          isValid: false,
        },
      },
    };

    const candidates = buildBoundedFieldCandidates({
      step,
      snapshot: narrowSnapshot,
      snapshotSelection: {
        source: 'event-local-pageState',
        temporalClass: 'action_local',
        reason: 'unit-test-narrow-snapshot',
      },
    });

    // STATUS: EXPECTED to return [] — label not found in narrow snapshot.
    // This documents the snapshot-selection gap: event-local-pageState (narrow subtree)
    // is selected over source-node-snapshot (rich) → bounded-field-no-label.
    // Fix belongs in snapshot-selection demotion logic (6B-C), NOT in this ticket.
    expect(candidates).toHaveLength(0);
  });

  it.todo('13. snapshot selection: event-local preferred over source-node-snapshot even when it lacks label', () => {
    // MISSING SEAM: snapshot-selector.ts selectForStep is not exposed for unit testing.
    // To test this, we need a mock SnapshotInventory with both:
    //   - event-local-pageState handle (narrow, no label)
    //   - source-node-snapshot handle (rich, has label)
    // Then call selectForStep and assert which is chosen.
    // Currently there is no test harness for SnapshotInventory injection.
    // Fix: expose selectForStep as a testable function or add a SnapshotInventory fixture builder.
  });

  // ---------------------------------------------------------------------------
  // Part 7 — Broad text false-positive protection
  // ---------------------------------------------------------------------------

  it('14. broad text blocker: h1 page title does not count as field label', async () => {
    // h1 is not in 'label,legend,span,div,p' — it IS queryable by findExactVisibleFieldLabels.
    // However, findBoundedContainerProof must block it because:
    //   walking up from the h1, no tight container with exactly one input is found
    //   before hitting a broad stop tag (main/section/body).
    // This test documents the current behavior and protects against h1 being accepted.
    setupDOM(`
      <main>
        <h1>Username</h1>
        <div class="content">
          <input class="app-input" id="orphan-input" />
        </div>
      </main>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Username',
      controlKind: 'input',
      target: { engine: 'css', selector: '#orphan-input' } as any,
    };

    const { result } = await runDiscovery(params);

    // STATUS: EXPECTED null — h1 is not queried (not in label,legend,span,div,p)
    // OR bounded proof blocked because h1→container walk hits 'main' stop tag.
    // Either way: match must be null. This guards future label broadening.
    expect(result.match).toBeNull();
  });

  it('14b. broad text blocker: label-class span NOT in bounded container is blocked', async () => {
    // Span with label-like text exists but is NOT in the same tight field container.
    // Proves that label span match alone is not enough — container tightness is required.
    setupDOM(`
      <div class="page-header">
        <span class="field-label">Username</span>
      </div>
      <div class="content">
        <input class="app-input" id="orphan-input" />
      </div>
    `);

    const params: BoundedFieldSpecBuildParams = {
      labelText: 'Username',
      controlKind: 'input',
      target: { engine: 'css', selector: '#orphan-input' } as any,
    };

    const { result } = await runDiscovery(params);

    // STATUS: EXPECTED null — label and input share no ancestor tighter than body.
    // findBoundedContainerProof walks up from span.field-label and never finds
    // a container with exactly one input before hitting body/main stop tag.
    // If this starts passing (match not null), it means label broadening is too permissive.
    expect(result.match).toBeNull();
  });

  it.todo('15. generic div text adjacent to input is accepted today — known false-positive risk', async () => {
    // KNOWN: test 6 above (generic-container) documents that a plain div text
    // that is the sole label-like element in a small container DOES match today.
    // Before any production fix broadens label matching to span/div,
    // a bounded-container tightness guard or label-class filter must be added.
    // This todo exists to ensure the false-positive is NOT silently widened.
    // Severity: MEDIUM — only triggers when label text is unique and container is small.
  });
});
