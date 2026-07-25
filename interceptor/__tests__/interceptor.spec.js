import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  AIRInterceptor,
  escapeCssString,
  rankForPriority,
  SELECTOR_RANK_MAP,
} = require('../interceptor.js');

function makeElement(overrides = {}) {
  const attrs = new Map(Object.entries(overrides.attrs || {}));
  const classList = overrides.classList || [];

  return {
    tagName: (overrides.tagName || 'DIV').toUpperCase(),
    id: overrides.id || '',
    name: overrides.name || '',
    type: overrides.type,
    placeholder: overrides.placeholder,
    classList,
    textContent: overrides.textContent || '',
    parentElement: overrides.parentElement || null,
    hasAttribute(name) {
      return attrs.has(name);
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
  };
}

function buildCtx(overrides = {}) {
  return {
    config: { maxTextLength: 80 },
    extractText: AIRInterceptor.prototype.extractText,
    findStableClass: AIRInterceptor.prototype.findStableClass,
    generateXPath: () => '/mock/xpath',
    ...overrides,
  };
}

describe('AIRInterceptor - Selector Rank & Escaping', () => {
  let originalCss;

  beforeAll(() => {
    originalCss = globalThis.CSS;
    globalThis.CSS = {
      escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`),
    };
  });

  afterAll(() => {
    globalThis.CSS = originalCss;
  });

  it('exposes rank map utilities', () => {
    expect(SELECTOR_RANK_MAP['data-testid']).toBe(1);
    expect(rankForPriority('class')).toBe(7);
    expect(rankForPriority('unknown-priority')).toBe(10);
  });

  it('escapes css strings used in selector attributes', () => {
    const raw = 'line1\nline2\t"quoted"';
    const escaped = escapeCssString(raw);
    expect(escaped).toContain('\\A ');
    expect(escaped).toContain('\\9 ');
    expect(escaped).toContain('\\"');
  });

  it('returns rank 1 for data-testid with escaped value', () => {
    const ctx = buildCtx();
    const el = makeElement({ tagName: 'button', attrs: { 'data-testid': 'submit-"btn"' } });
    const result = AIRInterceptor.prototype.generateOptimalSelector.call(ctx, el);
    expect(result.priority).toBe('data-testid');
    expect(result.rank).toBe(1);
    expect(result.selector).toBe('[data-testid="submit-\\"btn\\""]');
  });

  it('returns rank 2 for stable id', () => {
    const ctx = buildCtx();
    const el = makeElement({ tagName: 'div', id: 'unique-id' });
    const result = AIRInterceptor.prototype.generateOptimalSelector.call(ctx, el);
    expect(result.priority).toBe('id');
    expect(result.rank).toBe(2);
    expect(result.selector).toBe('#unique-id');
  });

  it('returns rank 3 for attribute selectors', () => {
    const ctx = buildCtx();
    const el = makeElement({ tagName: 'input', name: 'user[name]' });
    const result = AIRInterceptor.prototype.generateOptimalSelector.call(ctx, el);
    expect(result.priority).toBe('attribute');
    expect(result.rank).toBe(3);
    expect(result.selector).toBe('input[name="user[name]"]');
  });

  it('returns rank 7 for stable class', () => {
    const ctx = buildCtx();
    const el = makeElement({ tagName: 'div', classList: ['btn-primary'] });
    const result = AIRInterceptor.prototype.generateOptimalSelector.call(ctx, el);
    expect(result.priority).toBe('class');
    expect(result.rank).toBe(7);
    expect(result.selector).toBe('.btn-primary');
  });

  it('returns rank 8 for text-based button selector', () => {
    const ctx = buildCtx();
    const el = makeElement({ tagName: 'button', textContent: 'Click "Me"' });
    const result = AIRInterceptor.prototype.generateOptimalSelector.call(ctx, el);
    expect(result.priority).toBe('text');
    expect(result.rank).toBe(8);
    expect(result.selector).toBe('button:has-text("Click \\"Me\\"")');
  });

  it('returns rank 10 path selector from parent context when needed', () => {
    const child = makeElement({ tagName: 'span' });
    const parent = { id: '', tagName: 'SECTION', children: [child] };
    child.parentElement = parent;
    const ctx = buildCtx();
    const result = AIRInterceptor.prototype.generateOptimalSelector.call(ctx, child);
    expect(result.priority).toBe('path');
    expect(result.rank).toBe(10);
    expect(result.selector).toBe('section > span:nth-of-type(1)');
  });

  it('falls back to xpath with rank 10 as last resort', () => {
    const ctx = buildCtx();
    const el = makeElement({ tagName: 'span' });
    const result = AIRInterceptor.prototype.generateOptimalSelector.call(ctx, el);
    expect(result.priority).toBe('xpath');
    expect(result.rank).toBe(10);
    expect(result.selector).toBe('/mock/xpath');
  });

  it('includes selectorRank in generated fingerprint', () => {
    const ctx = {
      config: { debugMode: false },
      generateOptimalSelector: () => ({ selector: '[data-testid="login"]', priority: 'data-testid', rank: 1 }),
      extractText: () => 'Login',
      extractContext: () => ({ parentTag: 'form', nearestContainerTag: 'main' }),
      extractAttributes: () => ({ testid: 'login' }),
      hashAttributes: () => 'abc123',
    };
    const fp = AIRInterceptor.prototype.generateFingerprint.call(ctx, {});
    expect(fp.selectorPriority).toBe('data-testid');
    expect(fp.selectorRank).toBe(1);
  });
});
