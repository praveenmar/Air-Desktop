import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const { AIRInterceptor } = require('../../vscode-extension/interceptor.js') as {
  AIRInterceptor: {
    prototype: Record<string, unknown>;
  };
};

type RuntimeGlobals = {
  window?: Window & typeof globalThis;
  document?: Document;
  Element?: typeof Element;
  HTMLElement?: typeof HTMLElement;
  HTMLButtonElement?: typeof HTMLButtonElement;
  HTMLFormElement?: typeof HTMLFormElement;
  HTMLInputElement?: typeof HTMLInputElement;
  Node?: typeof Node;
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
};

type InterceptorHarness = {
  disabled: boolean;
  config: {
    sessionId: string;
    tabId: string;
    capturePageSnapshot: boolean;
    snapshotDepth: number;
  };
  eventQueue: Array<Record<string, unknown>>;
  recentEventKeys: Set<string>;
  maxRecentKeys: number;
  pendingTraceId: string | null;
  lastActionTraceId: string | null;
  lastActionTraceAt: number;
  _recentSubmitClick: { form: Element; traceId: string; createdAt: number } | null;
  generateUUID: () => string;
  _resolveNestedContext: (event: unknown, target: Element | null) => { target: Element | null; nestedContext: undefined };
  _getComposedEventTarget: (event: { target?: EventTarget | null }) => Element | null;
  _detectCustomDropdownOption: () => null;
  _resolveCustomDropdownTrigger: () => null;
  _findSyntheticHoverCandidate: () => null;
  _emitSyntheticHover: () => false;
  generateFingerprint: (element: Element | null) => Record<string, unknown>;
  detectSeekStrategy: () => null;
  normalizeUrl: (url: string) => string;
  queueEvent: (event: Record<string, unknown>) => void;
  flushQueue: () => void;
  waitForUrlChange: () => Promise<boolean>;
  _waitForSettleAndReady: () => Promise<{ settleResult: { stable: boolean; reason: string; waitedMs: number } }>;
  _captureFullPageForIC: () => Promise<null>;
  computeControlSignature: () => string;
  getPrimaryHeading: () => null;
  _normalizeSnapshotForTransport: <T>(value: T) => T;
  _buildOutcomeCaptureMeta: () => { forcedCapture: boolean; busyAtCapture: boolean; busyReasons: string[] };
  log: () => void;
  handleClick: (event: Event | { target?: EventTarget | null; composedPath?: () => EventTarget[] }) => Promise<void>;
  handleSubmit: (event: Event | { target?: EventTarget | null; composedPath?: () => EventTarget[] }) => void;
};

function withBrowserGlobals<T>(html: string, fn: (document: Document) => Promise<T> | T): Promise<T> | T {
  const dom = new JSDOM(html);
  const noopFetch = (() => Promise.resolve(new Response())) as typeof fetch;
  const windowLike = dom.window as Window & typeof globalThis & {
    __air_rawFetch?: typeof fetch;
    __air_gmSend?: undefined;
    fetch?: typeof fetch;
  };
  windowLike.fetch = noopFetch;
  windowLike.__air_rawFetch = noopFetch;

  const runtime = globalThis as unknown as RuntimeGlobals;
  const previous = {
    window: runtime.window,
    document: runtime.document,
    Element: runtime.Element,
    HTMLElement: runtime.HTMLElement,
    HTMLButtonElement: runtime.HTMLButtonElement,
    HTMLFormElement: runtime.HTMLFormElement,
    HTMLInputElement: runtime.HTMLInputElement,
    Node: runtime.Node,
    requestAnimationFrame: runtime.requestAnimationFrame,
    cancelAnimationFrame: runtime.cancelAnimationFrame,
  };

  runtime.window = windowLike;
  runtime.document = dom.window.document;
  runtime.Element = windowLike.Element;
  runtime.HTMLElement = windowLike.HTMLElement;
  runtime.HTMLButtonElement = windowLike.HTMLButtonElement;
  runtime.HTMLFormElement = windowLike.HTMLFormElement;
  runtime.HTMLInputElement = windowLike.HTMLInputElement;
  runtime.Node = windowLike.Node;
  runtime.requestAnimationFrame = windowLike.requestAnimationFrame
    ? windowLike.requestAnimationFrame.bind(windowLike)
    : ((callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number);
  runtime.cancelAnimationFrame = windowLike.cancelAnimationFrame
    ? windowLike.cancelAnimationFrame.bind(windowLike)
    : ((handle: number) => clearTimeout(handle));

  const finalize = () => {
    runtime.window = previous.window;
    runtime.document = previous.document;
    runtime.Element = previous.Element;
    runtime.HTMLElement = previous.HTMLElement;
    runtime.HTMLButtonElement = previous.HTMLButtonElement;
    runtime.HTMLFormElement = previous.HTMLFormElement;
    runtime.HTMLInputElement = previous.HTMLInputElement;
    runtime.Node = previous.Node;
    runtime.requestAnimationFrame = previous.requestAnimationFrame;
    runtime.cancelAnimationFrame = previous.cancelAnimationFrame;
    (dom.window as Window & { close?: () => void }).close?.();
  };

  try {
    const result = fn(dom.window.document);
    if (result && typeof (result as Promise<T>).then === 'function') {
      return (result as Promise<T>).finally(finalize);
    }
    finalize();
    return result;
  } catch (error) {
    finalize();
    throw error;
  }
}

function makeInterceptorHarness(): InterceptorHarness {
  const interceptor = Object.create(AIRInterceptor.prototype) as InterceptorHarness;
  let uuidCounter = 0;

  interceptor.disabled = false;
  interceptor.config = {
    sessionId: 'session-test',
    tabId: 'tab-a',
    capturePageSnapshot: false,
    snapshotDepth: 10,
  };
  interceptor.eventQueue = [];
  interceptor.recentEventKeys = new Set();
  interceptor.maxRecentKeys = 50;
  interceptor.pendingTraceId = null;
  interceptor.lastActionTraceId = null;
  interceptor.lastActionTraceAt = 0;
  interceptor._recentSubmitClick = null;
  interceptor.generateUUID = () => `uuid-${++uuidCounter}`;
  interceptor._resolveNestedContext = (_event, target) => ({ target, nestedContext: undefined });
  interceptor._getComposedEventTarget = (event) => (event?.target as Element | null) || null;
  interceptor._detectCustomDropdownOption = () => null;
  interceptor._resolveCustomDropdownTrigger = () => null;
  interceptor._findSyntheticHoverCandidate = () => null;
  interceptor._emitSyntheticHover = () => false;
  interceptor.generateFingerprint = (element) => ({
    selector: element?.tagName?.toLowerCase() || 'unknown',
  });
  interceptor.detectSeekStrategy = () => null;
  interceptor.normalizeUrl = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  };
  interceptor.queueEvent = (event) => {
    interceptor.eventQueue.push(event);
  };
  interceptor.flushQueue = () => undefined;
  interceptor.waitForUrlChange = async () => true;
  interceptor._waitForSettleAndReady = async () => ({
    settleResult: {
      stable: true,
      reason: 'navigation',
      waitedMs: 1,
    },
  });
  interceptor._captureFullPageForIC = async () => null;
  interceptor.computeControlSignature = () => 'sig-submit';
  interceptor.getPrimaryHeading = () => null;
  interceptor._normalizeSnapshotForTransport = (value) => value;
  interceptor._buildOutcomeCaptureMeta = () => ({
    forcedCapture: false,
    busyAtCapture: false,
    busyReasons: [],
  });
  interceptor.log = () => undefined;

  return interceptor;
}

describe('submit trace unification', () => {
  it('reuses the click trace for a submit event on the same form', async () => {
    await withBrowserGlobals(
      `
        <html><body>
          <form id="login-form">
            <input name="email" />
            <button type="submit">Sign in</button>
          </form>
        </body></html>
      `,
      async (document) => {
        const interceptor = makeInterceptorHarness();
        const button = document.querySelector('button[type="submit"]') as HTMLButtonElement;
        const form = document.querySelector('form') as HTMLFormElement;

        await interceptor.handleClick({
          target: button,
          composedPath: () => [button],
        });
        interceptor.handleSubmit({
          target: form,
          composedPath: () => [form],
        });

        const clickEvent = interceptor.eventQueue.find((event) => event.type === 'click');
        const submitEvent = interceptor.eventQueue.find((event) => event.type === 'submit');

        expect(clickEvent?.traceId).toBeTruthy();
        expect(submitEvent?.traceId).toBe(clickEvent?.traceId);
      },
    );
  });

  it('keeps click and submit action events on a single trace chain', async () => {
    await withBrowserGlobals(
      `
        <html><body>
          <form id="profile-form">
            <button type="submit">Save</button>
          </form>
        </body></html>
      `,
      async (document) => {
        const interceptor = makeInterceptorHarness();
        const button = document.querySelector('button[type="submit"]') as HTMLButtonElement;
        const form = document.querySelector('form') as HTMLFormElement;

        await interceptor.handleClick({
          target: button,
          composedPath: () => [button],
        });
        interceptor.handleSubmit({
          target: form,
          composedPath: () => [form],
        });

        const clickEvent = interceptor.eventQueue.find((event) => event.type === 'click');
        const submitEvent = interceptor.eventQueue.find((event) => event.type === 'submit');
        expect(clickEvent?.traceId).toBeTruthy();
        expect(submitEvent?.traceId).toBe(clickEvent?.traceId);
        const actionTraceIds = interceptor.eventQueue
          .filter((event) => event.type === 'click' || event.type === 'submit')
          .map((event) => event.traceId);

        expect(new Set(actionTraceIds)).toEqual(new Set([clickEvent?.traceId]));
      },
    );
  });
});
