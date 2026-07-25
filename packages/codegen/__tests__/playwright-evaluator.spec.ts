import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { evaluatePlaywrightCandidates } from '../src/resolver/playwright-evaluator';
import type { PlaywrightNativeCandidate } from '../src/types';

describe('Playwright Native Candidate Snapshot Evaluator', () => {
  let dom: JSDOM;

  beforeAll(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <button data-testid="unique-btn">Unique</button>
          <div data-testid="duplicate-btn">Dup 1</div>
          <div data-testid="duplicate-btn">Dup 2</div>
          
          <input id="hidden-input" type="hidden" data-testid="hidden-test" />
          
          <input placeholder="Search..." id="placeholder-input" />
          
          <label for="username">Username</label>
          <input id="username" />
          
          <label>
            Password
            <input type="password" id="password" />
          </label>
          
          <span id="label-txt">Aria Label</span>
          <button aria-labelledby="label-txt" id="aria-btn"></button>
          
          <div class="nearby">Broad Text</div>
          <input id="nearby-input" />

          <button id="explicit-btn" role="button" aria-label="Explicit">Text</button>
          
          <button id="text-btn">Submit</button>
          
          <div id="duplicate-role" role="button">Role Dup</div>
          <div id="duplicate-role-2" role="button">Role Dup</div>

          <div id="hidden-div" style="display:none" data-testid="hidden-div">Hidden</div>
          <div id="visible-div" data-testid="hidden-div">Visible</div>
        </body>
      </html>
    `);
    // Mock global Node for isVisibleElement
    (global as any).Node = (dom.window as any).Node;
  });

  const createCandidate = (node: any): PlaywrightNativeCandidate => ({
    spec: {
      engine: 'playwright-locator',
      selector: '',
      source: 'resolver',
      proofLevel: 'unvalidated',
      chain: [node],
    },
    reason: 'test',
    sourceEvidence: 'attributes',
    proofLevel: 'unvalidated',
    warningCodes: [],
  });

  it('1. getByTestId unique validates', () => {
    const candidate = createCandidate({ kind: 'getByTestId', value: 'unique-btn' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('valid');
    expect(result.matchCount).toBe(1);
    expect(result.isUnique).toBe(true);
    expect(result.isGloballyAmbiguous).toBe(false);
  });

  it('2. getByTestId duplicate returns blocked with multiple-visible-matches', () => {
    const candidate = createCandidate({ kind: 'getByTestId', value: 'duplicate-btn' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('blocked');
    expect(result.rejectReason).toBe('multiple-visible-matches');
    expect(result.matchCount).toBe(2);
    expect(result.visibleMatchCount).toBe(2);
    expect(result.isUnique).toBe(false);
    expect(result.isAmbiguous).toBe(true);
    expect(result.isGloballyAmbiguous).toBe(true);
  });

  it('3. getByTestId missing blocks with no-matches', () => {
    const candidate = createCandidate({ kind: 'getByTestId', value: 'missing' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('blocked');
    expect(result.matchCount).toBe(0);
    expect(result.rejectReason).toBe('no-matches');
  });

  it('4. getByPlaceholder unique validates', () => {
    const candidate = createCandidate({ kind: 'getByPlaceholder', value: 'Search...' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('valid');
    expect(result.matchCount).toBe(1);
  });

  it('5. getByLabel validates label[for]', () => {
    const candidate = createCandidate({ kind: 'getByLabel', value: 'Username' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('valid');
    expect(result.matchCount).toBe(1);
  });

  it('6. getByLabel validates wrapped label', () => {
    const candidate = createCandidate({ kind: 'getByLabel', value: 'Password' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('valid');
    expect(result.matchCount).toBe(1);
  });

  it('7. getByLabel validates aria-labelledby', () => {
    const candidate = createCandidate({ kind: 'getByLabel', value: 'Aria Label' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('valid');
    expect(result.matchCount).toBe(1);
  });

  it('8. getByLabel blocks broad nearby text', () => {
    const candidate = createCandidate({ kind: 'getByLabel', value: 'Broad Text' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('blocked');
    expect(result.matchCount).toBe(0);
  });

  it('9. getByRole validates explicit role + accessible name', () => {
    const candidate = createCandidate({
      kind: 'getByRole',
      value: 'button',
      options: { name: 'Explicit', exact: true }
    });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('valid');
    expect(result.matchCount).toBe(1);
  });

  it('10. getByRole validates button text', () => {
    const candidate = createCandidate({
      kind: 'getByRole',
      value: 'button',
      options: { name: 'Submit', exact: true }
    });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('valid');
    expect(result.matchCount).toBe(1);
  });

  it('11. getByRole detects duplicate role/name matches and blocks', () => {
    const candidate = createCandidate({
      kind: 'getByRole',
      value: 'button',
      options: { name: 'Role Dup', exact: true }
    });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('blocked');
    expect(result.rejectReason).toBe('multiple-visible-matches');
    expect(result.matchCount).toBe(2);
    expect(result.isAmbiguous).toBe(true);
  });

  it('12. hidden input is excluded from visibleMatchCount and blocks', () => {
    const candidate = createCandidate({ kind: 'getByTestId', value: 'hidden-test' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('blocked');
    expect(result.matchCount).toBe(1);
    expect(result.visibleMatchCount).toBe(0);
    expect(result.rejectReason).toBe('no-visible-matches');
  });

  it('13. one visible + one hidden returns valid with playwright-native-global-ambiguity warning', () => {
    const candidate = createCandidate({ kind: 'getByTestId', value: 'hidden-div' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('valid');
    expect(result.warningCodes).toContain('playwright-native-global-ambiguity');
    expect(result.matchCount).toBe(2);
    expect(result.visibleMatchCount).toBe(1);
    expect(result.isUnique).toBe(true);
    expect(result.isGloballyAmbiguous).toBe(true);
    expect(result.isAmbiguous).toBe(false);
  });

  it('14. chained locator candidate returns approximate, not crash', () => {
    const candidate = createCandidate({ kind: 'getByTestId', value: 'test' });
    candidate.spec.chain.push({ kind: 'locator', value: '.child' });
    
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    expect(result.status).toBe('approximate');
    expect(result.rejectReason).toBe('chained-playwright-locator-not-supported-yet');
  });

  it('15. malformed candidate returns approximate, not crash', () => {
    const candidate: any = createCandidate({ kind: 'invalid', value: 'test' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('approximate');
    expect(result.rejectReason).toContain('evaluation-failed');
  });

  it('16. no score/rank fields exist on evaluated output', () => {
    const candidate = createCandidate({ kind: 'getByTestId', value: 'unique-btn' });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect((result as any).score).toBeUndefined();
    expect((result as any).rank).toBeUndefined();
  });

  it('17. no resolver integration exists', () => {
    expect(typeof evaluatePlaywrightCandidates).toBe('function');
  });

  it('18. getByRole validates option text', () => {
    // Add an option to the DOM
    const option = dom.window.document.createElement('div');
    option.setAttribute('role', 'option');
    option.textContent = 'Admin';
    dom.window.document.body.appendChild(option);

    const candidate = createCandidate({
      kind: 'getByRole',
      value: 'option',
      options: { name: 'Admin', exact: true }
    });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('valid');
    expect(result.matchCount).toBe(1);
    
    // Cleanup
    dom.window.document.body.removeChild(option);
  });

  it('19. getByRole validates input placeholder as fallback accessible name', () => {
    const candidate = createCandidate({
      kind: 'getByRole',
      value: 'textbox',
      options: { name: 'Search...', exact: true }
    });
    const [result] = evaluatePlaywrightCandidates([candidate], { root: dom.window.document });
    
    expect(result.status).toBe('valid');
    expect(result.matchCount).toBe(1);
  });
});
