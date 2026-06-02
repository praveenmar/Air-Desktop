import { describe, it, expect } from 'vitest';
// @ts-ignore: This is a pure JS module without types, so TS will complain without this
import { buildSelectorDecision } from './decision-normalization.js';

describe('Selector Decision Normalization', () => {
  const defaultPayload = {
    primarySelector: null,
    selectorCandidates: [],
    currentSummary: [],
    shadowSummary: [],
    selectorPreferenceShadow: {},
    boundedFieldSelectorProposals: [],
    tableRowSelectorProposals: [],
    optionPanelSelectorProposals: [],
    genericContainerProposals: []
  };

  it('1. Username input: shadow and legacy aligned, selected = input[name="username"]', () => {
    const primarySelector = 'input[name="username"]';
    const candidate = {
      selector: primarySelector,
      matchCount: 1,
      visibleMatchCount: 1,
      warningCodes: []
    };
    
    const decision = buildSelectorDecision({
      ...defaultPayload,
      primarySelector,
      currentSummary: [candidate],
      selectorPreferenceShadow: { bestSelector: candidate }
    });

    expect(decision.schemaVersion).toBe('air:selector-decision:v1');
    expect(decision.status).toBe('resolved');
    expect(decision.selected.selector).toBe(primarySelector);
    expect(decision.selected.source).toBe('shadow-preference');
    expect(decision.diagnosticsSummary.shadowBestPresent).toBe(true);
  });

  it('2. Password input: selected uses shadow best selector if safer than legacy', () => {
    const primarySelector = 'div > input'; // Unsafe legacy
    const legacyCandidate = {
      selector: primarySelector,
      matchCount: 2, // unsafe
      visibleMatchCount: 2,
      warningCodes: ['multiple-matches']
    };
    
    const bestSelector = {
      selector: 'input[type="password"]',
      matchCount: 1,
      visibleMatchCount: 1,
      warningCodes: []
    };

    const decision = buildSelectorDecision({
      ...defaultPayload,
      primarySelector,
      currentSummary: [legacyCandidate],
      selectorPreferenceShadow: { bestSelector }
    });

    expect(decision.status).toBe('resolved');
    expect(decision.selected.selector).toBe('input[type="password"]');
    expect(decision.selected.source).toBe('shadow-preference');
    // Legacy should NOT be in alternatives because it's unsafe
    expect(decision.alternatives.length).toBe(0);
  });

  it('3. Login button: selected chooses safe shadow text selector over brittle structural legacy selector', () => {
    const primarySelector = 'div.flex > button:nth-child(2)';
    const legacyCandidate = {
      selector: primarySelector,
      matchCount: 1,
      visibleMatchCount: 1,
      warningCodes: []
    };
    
    const bestSelector = {
      selector: 'button:has-text("Login")',
      matchCount: 1,
      visibleMatchCount: 1,
      warningCodes: []
    };

    const decision = buildSelectorDecision({
      ...defaultPayload,
      primarySelector,
      currentSummary: [legacyCandidate],
      selectorPreferenceShadow: { bestSelector }
    });

    expect(decision.selected.selector).toBe('button:has-text("Login")');
    expect(decision.selected.source).toBe('shadow-preference');
    
    // The safe legacy selector should appear in alternatives since it differs
    expect(decision.alternatives).toHaveLength(1);
    expect(decision.alternatives[0].selector).toBe(primarySelector);
    expect(decision.alternatives[0].source).toBe('legacy-primary');
  });

  it('4. Table-row checkbox: selected uses table-row best selector only if promoted by preference engine', () => {
    const tableRowSelector = '//tr[.//td[text()="Row 1"]]//input';
    const bestSelector = {
      selector: tableRowSelector,
      matchCount: 1,
      visibleMatchCount: 1,
      warningCodes: []
    };

    const decision = buildSelectorDecision({
      ...defaultPayload,
      selectorPreferenceShadow: { bestSelector },
      tableRowSelectorProposals: [bestSelector]
    });

    expect(decision.selected.selector).toBe(tableRowSelector);
    expect(decision.selected.source).toBe('shadow-preference');
  });

  it('5. Generic container: appears only in alternatives, diagnosticOnly, never selected', () => {
    const genericProposal = {
      selector: '//article//button',
      matchCount: 1,
      visibleMatchCount: 1,
      warningCodes: []
    };

    const decision = buildSelectorDecision({
      ...defaultPayload,
      genericContainerProposals: [genericProposal]
    });

    // Should remain unresolved since no bestSelector or primarySelector is provided
    expect(decision.status).toBe('unresolved');
    expect(decision.selected).toBeNull();
    expect(decision.alternatives).toHaveLength(1);
    expect(decision.alternatives[0].selector).toBe('//article//button');
    expect(decision.alternatives[0].diagnosticOnly).toBe(true);
    expect(decision.diagnosticsSummary.genericContainerAlternativeCount).toBe(1);
  });

  it('6. Unresolved: returns unresolved when no unique visible selector exists', () => {
    const unsafeSelector = {
      selector: 'button',
      matchCount: 5,
      visibleMatchCount: 5,
      warningCodes: ['multiple-matches']
    };

    const decision = buildSelectorDecision({
      ...defaultPayload,
      primarySelector: 'button',
      currentSummary: [unsafeSelector],
      selectorPreferenceShadow: { bestSelector: unsafeSelector }
    });

    expect(decision.status).toBe('unresolved');
    expect(decision.selected).toBeNull();
    expect(decision.blockedReason).toBe('no-replay-safe-selector');
    expect(decision.alternatives).toHaveLength(0);
  });

  it('7. Legacy fallback: falls back to primary selector when shadow is missing or unsafe', () => {
    const primarySelector = 'input[name="fallback"]';
    const legacyCandidate = {
      selector: primarySelector,
      matchCount: 1,
      visibleMatchCount: 1,
      warningCodes: []
    };

    const decision = buildSelectorDecision({
      ...defaultPayload,
      primarySelector,
      currentSummary: [legacyCandidate]
      // No bestSelector provided
    });

    expect(decision.status).toBe('resolved');
    expect(decision.selected.selector).toBe(primarySelector);
    expect(decision.selected.source).toBe('legacy-primary');
  });

  it('8. Dangerous warnings: rejects selectors with specific dangerous warnings', () => {
    const warningsToTest = [
      'target-not-in-matches',
      'multiple-matches',
      'blocked-text-evaluation'
    ];

    warningsToTest.forEach(warning => {
      const bestSelector = {
        selector: 'button',
        matchCount: 1, // pretending it's 1 but has warning
        visibleMatchCount: 1,
        warningCodes: [warning]
      };

      const decision = buildSelectorDecision({
        ...defaultPayload,
        selectorPreferenceShadow: { bestSelector }
      });

      expect(decision.status).toBe('unresolved');
      expect(decision.selected).toBeNull();
    });
  });

  it('9. Alternatives max length: alternatives never exceed 3', () => {
    const bestSelector = { selector: 'button', matchCount: 1, visibleMatchCount: 1, warningCodes: [] };
    
    // Provide 5 proof proposals
    const proposals = Array.from({ length: 5 }).map((_, i) => ({
      selector: `proposal-${i}`,
      matchCount: 1,
      visibleMatchCount: 1,
      warningCodes: []
    }));

    const decision = buildSelectorDecision({
      ...defaultPayload,
      selectorPreferenceShadow: { bestSelector },
      boundedFieldSelectorProposals: proposals
    });

    expect(decision.alternatives.length).toBe(3);
    // The selected selector is NOT in alternatives
    expect(decision.alternatives[0].selector).toBe('proposal-0');
    expect(decision.alternatives[1].selector).toBe('proposal-1');
    expect(decision.alternatives[2].selector).toBe('proposal-2');
  });

  it('10. Non-regression: output shape perfectly matches contract', () => {
    const decision = buildSelectorDecision(defaultPayload);
    
    expect(decision).toHaveProperty('schemaVersion', 'air:selector-decision:v1');
    expect(decision).toHaveProperty('status');
    expect(decision).toHaveProperty('selected');
    expect(decision).toHaveProperty('alternatives');
    expect(decision).toHaveProperty('blockedReason');
    expect(decision.diagnosticsSummary).toHaveProperty('legacyPrimaryPresent');
    expect(decision.diagnosticsSummary).toHaveProperty('shadowBestPresent');
    expect(decision.diagnosticsSummary).toHaveProperty('selectedFrom');
    expect(decision.diagnosticsSummary).toHaveProperty('alternativesCount');
    expect(decision.diagnosticsSummary).toHaveProperty('genericContainerAlternativeCount');
  });
});
