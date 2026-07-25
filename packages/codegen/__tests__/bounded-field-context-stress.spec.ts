import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { generatePlaywrightCandidates } from '../src/resolver/playwright-candidates';
import { evaluatePlaywrightCandidates } from '../src/resolver/playwright-evaluator';
import { buildPlaywrightCandidateReport } from '../src/resolver/playwright-candidate-report';
import type { FingerprintData } from '../src/types';

describe('Bounded Field Context Stress Coverage', () => {
  let dom: JSDOM;
  let document: Document;

  beforeAll(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <!-- Case 1: Generic trigger with visual label but no structural association -->
          <div class="form-row">
            <div class="label-col">User Role</div>
            <div class="input-col">
              <div class="custom-select-trigger" id="role-trigger">Select role...</div>
            </div>
          </div>

          <!-- Case 2: Volatile label in bounded context -->
          <div class="bounded-box">
             <span class="box-header">Admin (Last modified 2 mins ago)</span>
             <button id="edit-btn">Edit</button>
          </div>

          <!-- Case 3: Nested generic trigger -->
          <div class="oxd-input-group">
            <div class="oxd-input-group__prepend">
              <span class="oxd-label">Username</span>
            </div>
            <div class="oxd-input-group__append">
              <input class="oxd-input" id="username-generic" />
            </div>
          </div>
        </body>
      </html>
    `);
    document = dom.window.document;
    
    // Mock global Node/Element for evaluator's visibility checks
    (global as any).Node = (dom.window as any).Node;
    (global as any).Element = (dom.window as any).Element;
    (global as any).HTMLElement = (dom.window as any).HTMLElement;
    (global as any).window = dom.window;
  });

  function runBoundedPipeline(selector: string, fieldLabelText: string | null, isValid: boolean = true) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);

    const fingerprint: FingerprintData = {
      tagName: el.tagName,
      attributes: {},
      boundedFieldContext: {
        isValid,
        fieldLabelText,
      },
      accessibilityEvidence: {
        role: null,
        accessibleName: null,
        accessibleNameSource: 'none'
      }
    };

    const candidates = generatePlaywrightCandidates(fingerprint);
    const evaluated = evaluatePlaywrightCandidates(candidates, { root: document });
    const report = buildPlaywrightCandidateReport(evaluated);
    return { fingerprint, candidates, evaluated, report };
  }

  it('1. generates warning-bearing getByLabel for generic trigger with bounded label', () => {
    const { candidates, report } = runBoundedPipeline('#role-trigger', 'User Role');
    
    const labelCandidate = candidates.find(c => c.spec.chain[0].kind === 'getByLabel');
    expect(labelCandidate).toBeDefined();
    expect(labelCandidate?.warningCodes).toContain('playwright-native-label-from-bounded-field-not-native');
    
    const reportEntry = report.find(r => r.locator.includes('getByLabel("User Role"'));
    expect(reportEntry).toBeDefined();
    // POLICY: It should be blocked in evaluation because getByLabel approximation requires structural label association.
    // This correctly documents that AIR is "guessing" a label that Playwright won't find natively.
    expect(reportEntry?.status).toBe('blocked');
    expect(reportEntry?.rejectReason).toBe('no-matches');
  });

  it('2. handles volatile label in bounded context', () => {
    // Note: Bounded field labels are currently treated as exact: true by generatePlaywrightCandidates 
    // unless we apply isVolatileText to them. ThisDocuments current baseline.
    const volatileLabel = 'Admin (Last modified 2 mins ago)';
    const { candidates } = runBoundedPipeline('#edit-btn', volatileLabel);
    
    const labelCandidate = candidates.find(c => c.spec.chain[0].kind === 'getByLabel');
    expect(labelCandidate?.spec.chain[0].options?.exact).toBe(true);
  });

  it('3. suppresses hypothesis if structural label already exists', () => {
    const fingerprint: FingerprintData = {
      tagName: 'INPUT',
      attributes: { id: 'username-generic' },
      boundedFieldContext: {
        isValid: true,
        fieldLabelText: 'Username',
      },
      accessibilityEvidence: {
        role: 'textbox',
        accessibleName: 'Username',
        accessibleNameSource: 'label-for'
      }
    };

    const candidates = generatePlaywrightCandidates(fingerprint);
    const getByLabelCandidates = candidates.filter(c => c.spec.chain[0].kind === 'getByLabel');
    
    // Should only have 1 (the native one), not the hypothesis one
    expect(getByLabelCandidates).toHaveLength(1);
    expect(getByLabelCandidates[0].warningCodes).not.toContain('playwright-native-label-from-bounded-field-not-native');
  });

  it('4. ignores invalid bounded field context', () => {
    const { candidates } = runBoundedPipeline('#role-trigger', 'User Role', false);
    const labelCandidate = candidates.find(c => c.spec.chain[0].kind === 'getByLabel');
    expect(labelCandidate).toBeUndefined();
  });
});
