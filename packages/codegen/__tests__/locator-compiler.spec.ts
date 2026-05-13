import { describe, test, expect } from 'vitest';
import { compilePlaywrightLocator } from '../src/locator-compiler';
import { PlaywrightLocatorSpec } from '../src/types';

describe('Playwright Locator Compiler', () => {
  test('compiles a simple getByRole', () => {
    const spec: PlaywrightLocatorSpec = {
      engine: 'playwright-locator',
      selector: '',
      source: 'manual',
      proofLevel: 'recorded',
      chain: [
        {
          kind: 'getByRole',
          value: 'button',
          options: { name: 'Submit' },
        },
      ],
    };
    expect(compilePlaywrightLocator(spec)).toBe('getByRole("button", { name: "Submit" })');
  });

  test('compiles a chained locator', () => {
    const spec: PlaywrightLocatorSpec = {
      engine: 'playwright-locator',
      selector: '',
      source: 'manual',
      proofLevel: 'recorded',
      chain: [
        {
          kind: 'getByRole',
          value: 'dialog',
        },
        {
          kind: 'getByRole',
          value: 'button',
          options: { name: 'Close' },
        },
      ],
    };
    expect(compilePlaywrightLocator(spec)).toBe('getByRole("dialog").getByRole("button", { name: "Close" })');
  });

  test('escapes forward slashes in regex source', () => {
    const spec: PlaywrightLocatorSpec = {
      engine: 'playwright-locator',
      selector: '',
      source: 'manual',
      proofLevel: 'recorded',
      chain: [
        {
          kind: 'getByRole',
          value: 'button',
          options: { name: { source: 'User/Admin', flags: 'i' } },
        },
      ],
    };
    expect(compilePlaywrightLocator(spec)).toBe('getByRole("button", { name: /User\\/Admin/i })');
  });

  test('strips exact when name is a regex', () => {
    const spec: PlaywrightLocatorSpec = {
      engine: 'playwright-locator',
      selector: '',
      source: 'manual',
      proofLevel: 'recorded',
      chain: [
        {
          kind: 'getByRole',
          value: 'button',
          options: { name: { source: 'Submit', flags: 'i' }, exact: true },
        },
      ],
    };
    expect(compilePlaywrightLocator(spec)).toBe('getByRole("button", { name: /Submit/i })');
  });

  test('strips exact when hasText is a regex', () => {
    const spec: PlaywrightLocatorSpec = {
      engine: 'playwright-locator',
      selector: '',
      source: 'manual',
      proofLevel: 'recorded',
      chain: [
        {
          kind: 'locator',
          value: 'div',
          options: { hasText: { source: 'foo/bar', flags: 'g' }, exact: true },
        },
      ],
    };
    expect(compilePlaywrightLocator(spec)).toBe('locator("div", { hasText: /foo\\/bar/g })');
  });

  test('throws on invalid regex flags', () => {
    const spec: PlaywrightLocatorSpec = {
      engine: 'playwright-locator',
      selector: '',
      source: 'manual',
      proofLevel: 'recorded',
      chain: [
        {
          kind: 'getByText',
          value: 'foo',
          options: { name: { source: 'foo', flags: 'xyz' } },
        },
      ],
    };
    expect(() => compilePlaywrightLocator(spec)).toThrow('Invalid regex flags: xyz');
  });

  test('handles double quotes in values', () => {
    const spec: PlaywrightLocatorSpec = {
      engine: 'playwright-locator',
      selector: '',
      source: 'manual',
      proofLevel: 'recorded',
      chain: [
        {
          kind: 'getByLabel',
          value: 'User "Admin"',
        },
      ],
    };
    expect(compilePlaywrightLocator(spec)).toBe('getByLabel("User \\"Admin\\"")');
  });
});
