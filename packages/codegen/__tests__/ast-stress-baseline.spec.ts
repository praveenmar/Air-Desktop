import { describe, expect, it, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';
import { compilePlaywrightLocator } from '../src/locator-compiler';
import { PlaywrightLocatorSpec } from '../src/types';
import fs from 'fs';
import path from 'path';

const requireInternal = createRequire(import.meta.url);
const interceptorPath = path.resolve(__dirname, '../../vscode-extension/interceptor.js');
const { AIRInterceptor } = requireInternal(interceptorPath);

describe('Baseline AST Stress Testing (T1 & T2 Only)', () => {
  let dom: JSDOM;
  let interceptor: any;

  beforeAll(() => {
    const htmlPath = path.resolve(__dirname, '../../../core/__tests__/fixtures/dom-stress-fixtures.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    dom = new (JSDOM as any)(html, { url: 'http://localhost' });
    
    // Mock browser globals for interceptor
    global.window = dom.window as any;
    global.document = dom.window.document as any;
    global.Node = (dom.window as any).Node;
    global.Element = (dom.window as any).Element;
    global.HTMLElement = (dom.window as any).HTMLElement;
    global.CSS = { escape: (s: string) => s } as any;
    (global.window as any).fetch = () => Promise.resolve();

    // Minimal harness to avoid constructor network side effects
    interceptor = Object.create(AIRInterceptor.prototype);
    interceptor.config = { debugMode: false, maxTextLength: 200 };
    
    // Bind all methods from prototype to our harness
    const proto = AIRInterceptor.prototype;
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (typeof (proto as any)[key] === 'function') {
        interceptor[key] = (proto as any)[key].bind(interceptor);
      }
    }
  });

  describe('Suite 1: Interceptor Extraction (Ticket 1)', () => {
    it('#login-submit must return role: "button" (inferred from tag)', () => {
      const element = dom.window.document.querySelector('[data-testid="login-submit"]');
      const evidence = interceptor._collectAccessibilityEvidence(element);
      expect(evidence.role).toBe('button');
    });

    it('#username-input must return accessibleNameSource: "label-for" and accessibleName: "Username"', () => {
      const element = dom.window.document.querySelector('#username-input');
      const evidence = interceptor._collectAccessibilityEvidence(element);
      expect(evidence.accessibleNameSource).toBe('label-for');
      expect(evidence.accessibleName).toBe('Username');
    });

    it('#btn-cart must return accessibleName: "Checkout (4 items) - $142.99"', () => {
      const element = dom.window.document.querySelector('#btn-cart');
      const evidence = interceptor._collectAccessibilityEvidence(element);
      expect(evidence.accessibleName).toBe('Checkout (4 items) - $142.99');
    });

    it('#btn-complex-aria must return accessibleName: "Delete John Doe" (aria-labelledby)', () => {
      const element = dom.window.document.querySelector('#btn-complex-aria');
      const evidence = interceptor._collectAccessibilityEvidence(element);
      expect(evidence.accessibleName).toBe('Delete John Doe');
    });

    it('#garbage-div must return empty or no evidence', () => {
      const element = dom.window.document.querySelector('#garbage-div');
      const evidence = interceptor._collectAccessibilityEvidence(element);
      expect(evidence.accessibleName).toBeNull();
      expect(evidence.role).toBeNull();
    });
  });

  describe('Suite 2: Compiler Resiliency (Ticket 2)', () => {
    it('handles complex quoting and exact matching', () => {
      const spec: PlaywrightLocatorSpec = {
        engine: 'playwright-locator',
        selector: '',
        source: 'manual',
        proofLevel: 'recorded',
        chain: [{
          kind: 'getByRole',
          value: 'button',
          options: { name: "O'Connor's", exact: true }
        }]
      };
      expect(compilePlaywrightLocator(spec)).toBe('getByRole("button", { name: "O\'Connor\'s", exact: true })');
    });

    it('handles regex literals with forward slashes and strips exact', () => {
      const spec: PlaywrightLocatorSpec = {
        engine: 'playwright-locator',
        selector: '',
        source: 'manual',
        proofLevel: 'recorded',
        chain: [{
          kind: 'getByRole',
          value: 'button',
          options: { name: { source: 'User/Admin', flags: 'i' }, exact: true }
        }]
      };
      expect(compilePlaywrightLocator(spec)).toBe('getByRole("button", { name: /User\\/Admin/i })');
    });

    it('handles chained locators', () => {
      const spec: PlaywrightLocatorSpec = {
        engine: 'playwright-locator',
        selector: '',
        source: 'manual',
        proofLevel: 'recorded',
        chain: [
          { kind: 'locator', value: '.card' },
          { kind: 'getByTestId', value: 'submit' }
        ]
      };
      expect(compilePlaywrightLocator(spec)).toBe('locator(".card").getByTestId("submit")');
    });
  });
});
