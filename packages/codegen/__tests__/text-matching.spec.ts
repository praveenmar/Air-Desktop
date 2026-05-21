import { describe, expect, it } from 'vitest';
import {
  cssEscape,
  extractAttributeValue,
  isTextSelector,
} from '../src/resolver/text-matching';

describe('text matching helpers', () => {
  it.each([
    ['data-testid', 'save-"draft"'],
    ['aria-label', 'Save "Draft"'],
    ['name', 'user[email]'],
    ['placeholder', `What's your name?`],
    ['data-testid', `author's-choice`],
    ['data-testid', 'path\\to\\field'],
    ['data-testid', 'line1\nline2'],
  ])('round-trips escaped %s values safely', (attribute, value) => {
    const selector = `[${attribute}="${cssEscape(value)}"]`;
    expect(extractAttributeValue(selector, attribute)).toBe(value);
  });

  it('treats :has-text selectors as text selectors', () => {
    expect(isTextSelector('button:has-text("Search")')).toBe(true);
    expect(isTextSelector(`a:has-text('Admin')`)).toBe(true);
  });

  it('does not throw on out-of-range CSS hex escapes', () => {
    const selector = '[data-testid="bad\\FFFFFF value"]';
    expect(() => extractAttributeValue(selector, 'data-testid')).not.toThrow();
    expect(extractAttributeValue(selector, 'data-testid')).toBe('bad\\FFFFFF value');
  });
});
