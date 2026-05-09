import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';
import { AIREventSchema, PageSnapshotSchema } from '../types/events';

const require = createRequire(import.meta.url);
const { AIRInterceptor } = require('../../packages/vscode-extension/interceptor.js') as {
  AIRInterceptor: {
    prototype: Record<string, unknown>;
  };
};

type RuntimeGlobals = {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
};

type InterceptorNormalizationHarness = {
  _isPlainObject: (value: unknown) => boolean;
  _buildSnapshotTransportObject: (snapshotValue: unknown) => Record<string, unknown> | null;
  _buildSchemaCompatibleSnapshot: (snapshotObject: Record<string, unknown>, sanitizedHtml: string) => Record<string, unknown>;
  normalizeSnapshotFieldForTransport: (
    snapshotValue: unknown,
    fieldName: string,
    maxBytes: number,
    eventContext?: Record<string, unknown> | null,
    options?: Record<string, unknown>,
  ) => { value: unknown; meta: Record<string, unknown> | null };
  sanitizeSnapshotHtmlForTransport: (html: string) => {
    html: string;
    scriptsRemoved: number;
    stylesRemoved: number;
    noscriptRemoved: number;
    base64Collapsed: number;
    svgCollapsed: number;
  };
  _getPayloadBytes: (payloadValue: unknown) => number;
  _logTransportFieldMeta: (fieldName: string, eventContext: Record<string, unknown> | null, fieldMeta: Record<string, unknown> | null) => void;
  _logSnapshotSubfieldDrop: (
    fieldName: string,
    eventContext: Record<string, unknown> | null,
    reason: string,
    subfields: string[],
    extra?: Record<string, unknown>,
  ) => void;
  normalizeUrl: (url: string) => string;
  log: ReturnType<typeof vi.fn>;
};

function withBrowserGlobals<T>(url: string, fn: () => T): T {
  const dom = new JSDOM('<html><body></body></html>', { url });
  const runtime = globalThis as unknown as RuntimeGlobals;
  const previous = {
    window: runtime.window,
    document: runtime.document,
    Node: runtime.Node,
  };

  runtime.window = dom.window as Window & typeof globalThis;
  runtime.document = dom.window.document;
  runtime.Node = dom.window.Node;

  try {
    return fn();
  } finally {
    runtime.window = previous.window;
    runtime.document = previous.document;
    runtime.Node = previous.Node;
    (dom.window as Window & { close?: () => void }).close?.();
  }
}

function makeNormalizationHarness(): InterceptorNormalizationHarness {
  const interceptor = Object.create(AIRInterceptor.prototype) as InterceptorNormalizationHarness;
  interceptor.log = vi.fn();
  interceptor.normalizeUrl = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  };
  return interceptor;
}

describe('active-path schema survival', () => {
  it('preserves click.pageSnapshot through event validation', () => {
    const parsed = AIREventSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      type: 'click',
      timestamp: 1_700_000_000_000,
      sessionId: 'session-11111111-1111-4111-8111-111111111111',
      pageUrl: 'https://app.test/dashboard',
      pageSnapshot: {
        html: '<main><button>Save</button></main>',
        normalizedUrl: 'https://app.test/dashboard',
      },
      pageState: {
        html: '<main><button>Save</button></main>',
      },
    });

    expect(parsed.type).toBe('click');
    expect(parsed.pageSnapshot?.html).toContain('<button>Save</button>');
    expect(parsed.pageSnapshot?.normalizedUrl).toBe('https://app.test/dashboard');
  });

  it('preserves compositeAnchors and metrics through active-path snapshot normalization and parse', () => {
    withBrowserGlobals('https://app.test/profile?tab=advanced', () => {
      const interceptor = makeNormalizationHarness();
      const captureSnapshot = {
        html: '<main><form><input name="email" /><button>Save</button></form></main>',
        anchors: ['form:profile'],
        compositeAnchors: [
          {
            kind: 'form_cluster',
            scopeTag: 'form',
            scopeRole: null,
            scopeId: 'profile-form',
            scopeName: null,
            scopeLabel: 'Profile',
            tokens: ['profile', 'save'],
            descriptor: 'profile save form',
            confidence: 0.91,
          },
        ],
        controlSignature: 'sig-profile',
        normalizedUrl: 'https://app.test/profile',
        isStable: true,
        viewport: { width: 1440, height: 900 },
        url: 'https://app.test/profile?tab=advanced',
        timestamp: 1_700_000_000_123,
        snapshotBuildId: 'snap-42',
        metrics: {
          anchorScanTotalMs: 17.25,
          flatScanMs: 5.2,
          compositeScanMs: 8.7,
          repeatedScanCount: 2,
          finalCompositeCount: 1,
          droppedCompositeCount: 0,
          snapshotBuildId: 'snap-42',
        },
      };

      const normalized = interceptor.normalizeSnapshotFieldForTransport(
        captureSnapshot,
        'pageSnapshot',
        200_000,
        { eventId: 'ev-1', type: 'click' },
      );

      const parsed = PageSnapshotSchema.parse(normalized.value);
      expect(parsed.compositeAnchors).toHaveLength(1);
      expect(parsed.compositeAnchors?.[0].descriptor).toBe('profile save form');
      expect(parsed.metrics).toEqual(expect.objectContaining({
        anchorScanTotalMs: 17.25,
        flatScanMs: 5.2,
        compositeScanMs: 8.7,
        repeatedScanCount: 2,
        finalCompositeCount: 1,
        droppedCompositeCount: 0,
        snapshotBuildId: 'snap-42',
      }));
      expect((parsed as Record<string, unknown>).snapshotBuildId).toBe('snap-42');
    });
  });

  it('preserves nestedContext while keeping unknown top-level event fields stripped', () => {
    const parsed = AIREventSchema.parse({
      id: '22222222-2222-4222-8222-222222222222',
      type: 'click',
      timestamp: 1_700_000_000_010,
      sessionId: 'session-22222222-2222-4222-8222-222222222222',
      nestedContext: {
        isShadowDom: true,
        shadowHostTag: 'air-card',
        degraded: true,
        degradedReason: 'probable_closed_shadow_host',
        captureHint: 'shadow-fallback',
      },
      pageSnapshot: {
        html: '<div>shadow content</div>',
        snapshotBuildId: 'snap-shadow-1',
      },
      dangerousTopLevel: {
        shouldNotSurvive: true,
      },
    });

    expect(parsed.nestedContext).toEqual(expect.objectContaining({
      isShadowDom: true,
      shadowHostTag: 'air-card',
      degraded: true,
      degradedReason: 'probable_closed_shadow_host',
    }));
    expect((parsed.nestedContext as Record<string, unknown>).captureHint).toBe('shadow-fallback');
    expect((parsed.pageSnapshot as Record<string, unknown>)?.snapshotBuildId).toBe('snap-shadow-1');
    expect(parsed).not.toHaveProperty('dangerousTopLevel');
  });

  it('parses semantic custom-control events without stripping control relationship fields', () => {
    const openParsed = AIREventSchema.parse({
      id: '33333333-3333-4333-8333-333333333333',
      type: 'custom-control-open',
      timestamp: 1_700_000_000_020,
      sessionId: 'session-33333333-3333-4333-8333-333333333333',
      controlFamily: 'menu',
      triggerText: 'Paul Collings',
      triggerRole: 'button',
      fingerprint: {
        selector: '.oxd-userdropdown-name',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'span',
        textExcerpt: 'Paul Collings',
        context: {
          parentTag: 'div',
          nearestContainerTag: 'div',
        },
        attributes: {
          role: 'button',
        },
        attributesHash: 'hash-open',
      },
    });

    const menuParsed = AIREventSchema.parse({
      id: '44444444-4444-4444-8444-444444444444',
      type: 'custom-menu-select',
      timestamp: 1_700_000_000_021,
      sessionId: 'session-44444444-4444-4444-8444-444444444444',
      controlFamily: 'menu',
      optionRole: 'menuitem',
      selection: {
        label: 'Logout',
        value: 'logout',
        index: 0,
      },
      fingerprint: {
        selector: '[role="menuitem"]:has-text("Logout")',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'li',
        textExcerpt: 'Logout',
        context: {
          parentTag: 'ul',
          nearestContainerTag: 'nav',
        },
        attributes: {
          role: 'menuitem',
        },
        attributesHash: 'hash-menu',
      },
    });

    expect(openParsed.type).toBe('custom-control-open');
    expect((openParsed as Record<string, unknown>).controlFamily).toBe('menu');
    expect(menuParsed.type).toBe('custom-menu-select');
    expect((menuParsed as Record<string, unknown>).optionRole).toBe('menuitem');
  });
});
