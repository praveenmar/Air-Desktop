import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';
import { AIREventSchema, PageSnapshotSchema } from '../types/events';
import { CapturedSelectorCandidateSchema } from '../types/fingerprint';

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

  it('preserves selector ambiguity and bounded field context on fingerprints through event validation', () => {
    const parsed = AIREventSchema.parse({
      id: '55555555-5555-4555-8555-555555555555',
      type: 'input',
      timestamp: 1_700_000_000_030,
      sessionId: 'session-55555555-5555-4555-8555-555555555555',
      trigger: 'change',
      fingerprint: {
        selector: '.generic-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        textExcerpt: null,
        context: {
          parentTag: 'div',
          nearestContainerTag: 'div',
        },
        attributes: {
          fieldLabelText: 'Username',
          class: 'generic-input',
        },
        selectorAmbiguity: {
          originalSelector: '.generic-input',
          originalPriority: 'class',
          matchCount: 2,
          visibleMatchCount: 2,
          positionInMatches: 1,
          isUnique: false,
          isAmbiguous: true,
        },
        boundedFieldContext: {
          fieldLabelText: 'Username',
          fieldRelation: 'sibling-label',
          targetControlKind: 'input',
          visibleControlCountInContainer: 1,
          targetIndexWithinContainer: 0,
          boundedContainerSummary: 'div.field-row',
          boundedContainerSelectorCandidates: [
            { selector: '[data-testid="username-field"]', kind: 'data-testid', isClean: true },
          ],
          cleanParentSelector: '[data-testid="username-field"]',
          cleanChildSelector: 'input',
          containerSelector: '[data-testid="username-field"]',
          competingControlCount: 0,
          duplicateLabelCount: 1,
          isValid: true,
          blockedReason: null,
        },
        attributesHash: 'hash-bounded-field',
      },
    });

    expect(parsed.type).toBe('input');
    expect((parsed.fingerprint as Record<string, unknown>)?.selectorAmbiguity).toEqual(
      expect.objectContaining({
        originalSelector: '.generic-input',
        visibleMatchCount: 2,
        isAmbiguous: true,
      }),
    );
    expect((parsed.fingerprint as Record<string, unknown>)?.boundedFieldContext).toEqual(
      expect.objectContaining({
        fieldLabelText: 'Username',
        cleanParentSelector: '[data-testid="username-field"]',
        isValid: true,
      }),
    );
  });

  it('accepts role-text accessibility evidence on fingerprints', () => {
    const parsed = AIREventSchema.parse({
      id: '66666666-6666-4666-8666-666666666666',
      type: 'click',
      timestamp: 1_700_000_000_040,
      sessionId: 'session-66666666-6666-4666-8666-666666666666',
      fingerprint: {
        selector: '[role="option"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'div',
        textExcerpt: 'Admin',
        context: {
          parentTag: 'div',
          nearestContainerTag: 'div',
        },
        attributes: {
          role: 'option',
        },
        accessibilityEvidence: {
          role: 'option',
          accessibleName: 'Admin',
          accessibleNameSource: 'role-text',
        },
        attributesHash: 'hash-role-text',
      },
    });

    expect((parsed.fingerprint as Record<string, unknown>)?.accessibilityEvidence).toEqual(
      expect.objectContaining({
        accessibleName: 'Admin',
        accessibleNameSource: 'role-text',
      }),
    );
  });

  it('accepts valid fingerprint.selectorCandidates and preserves explicit raw/visible index fields', () => {
    const parsed = AIREventSchema.parse({
      id: '67676767-6767-4676-8676-676767676767',
      type: 'click',
      timestamp: 1_700_000_000_045,
      sessionId: 'session-67676767-6767-4676-8676-676767676767',
      fingerprint: {
        selector: '[data-testid="save-profile"]',
        selectorPriority: 'data-testid',
        selectorRank: 1,
        tagName: 'button',
        textExcerpt: 'Save Profile',
        context: {
          parentTag: 'form',
          nearestContainerTag: 'main',
        },
        attributes: {
          'data-testid': 'save-profile',
        },
        selectorCandidates: [
          {
            selector: '[data-testid="save-profile"]',
            engine: 'css',
            family: 'primary',
            strength: 'strong',
            source: 'capture',
            isPrimary: true,
            matchCount: 1,
            visibleMatchCount: 1,
            positionInAllMatches: 0,
            positionInVisibleMatches: 0,
            warningCodes: ['captured-primary'],
          },
        ],
        attributesHash: 'hash-selector-candidates',
      },
    });

    expect((parsed.fingerprint as Record<string, unknown>)?.selectorCandidates).toEqual([
      expect.objectContaining({
        selector: '[data-testid="save-profile"]',
        engine: 'css',
        family: 'primary',
        strength: 'strong',
        source: 'capture',
        isPrimary: true,
        matchCount: 1,
        visibleMatchCount: 1,
        positionInAllMatches: 0,
        positionInVisibleMatches: 0,
        warningCodes: ['captured-primary'],
      }),
    ]);
  });

  it('accepts snapshot-backed fingerprint target identity fields', () => {
    const parsed = AIREventSchema.parse({
      id: '67676767-6767-4676-8676-676767676768',
      type: 'click',
      timestamp: 1_700_000_000_045,
      sessionId: 'session-67676767-6767-4676-8676-676767676768',
      fingerprint: {
        selector: '[data-testid="save-profile"]',
        selectorPriority: 'data-testid',
        selectorRank: 1,
        tagName: 'button',
        textExcerpt: 'Save Profile',
        context: {
          parentTag: 'form',
          nearestContainerTag: 'main',
        },
        attributes: {
          'data-testid': 'save-profile',
        },
        targetNodeId: 'air-node-1',
        targetIdentitySource: 'pageSnapshot',
        targetIdentityStatus: 'emitted',
        attributesHash: 'hash-target-identity',
      },
    });

    expect((parsed.fingerprint as Record<string, unknown>)?.targetNodeId).toBe('air-node-1');
    expect((parsed.fingerprint as Record<string, unknown>)?.targetIdentitySource).toBe('pageSnapshot');
    expect((parsed.fingerprint as Record<string, unknown>)?.targetIdentityStatus).toBe('emitted');
  });

  it('rejects invalid fingerprint target identity enums at the schema boundary', () => {
    const result = AIREventSchema.safeParse({
      id: '67676767-6767-4676-8676-676767676769',
      type: 'click',
      timestamp: 1_700_000_000_045,
      sessionId: 'session-67676767-6767-4676-8676-676767676769',
      fingerprint: {
        selector: '[data-testid="save-profile"]',
        selectorPriority: 'data-testid',
        selectorRank: 1,
        tagName: 'button',
        textExcerpt: 'Save Profile',
        context: {
          parentTag: 'form',
          nearestContainerTag: 'main',
        },
        attributes: {
          'data-testid': 'save-profile',
        },
        targetNodeId: 'air-node-1',
        targetIdentitySource: 'snapshot',
        targetIdentityStatus: 'missing',
        attributesHash: 'hash-invalid-target-identity',
      },
    });

    expect(result.success).toBe(false);
  });

  it('treats invalid selectorCandidates as candidate-local failures without rejecting the full event', () => {
    const invalidCandidate = {
      selector: '.candidate',
      engine: 'playwright',
      family: 'primary',
      strength: 'strong',
      source: 'capture',
    };
    const validCandidate = {
      selector: '[name="username"]',
      engine: 'css',
      family: 'name',
      strength: 'strong',
      source: 'capture',
      warningCodes: ['recorded-name'],
    };

    expect(CapturedSelectorCandidateSchema.safeParse(invalidCandidate).success).toBe(false);

    const parsed = AIREventSchema.parse({
      id: '68686868-6868-4686-8686-686868686868',
      type: 'input',
      timestamp: 1_700_000_000_046,
      sessionId: 'session-68686868-6868-4686-8686-686868686868',
      trigger: 'change',
      fingerprint: {
        selector: '[name="username"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'input',
        textExcerpt: null,
        context: {
          parentTag: 'form',
          nearestContainerTag: 'form',
        },
        attributes: {
          name: 'username',
        },
        selectorCandidates: [validCandidate, invalidCandidate],
        attributesHash: 'hash-selector-candidate-filter',
      },
    });

    expect(parsed.type).toBe('input');
    expect((parsed.fingerprint as Record<string, unknown>)?.selectorCandidates).toEqual([
      expect.objectContaining(validCandidate),
    ]);
  });

  it('keeps legacy events without accessibilityEvidence schema-compatible', () => {
    const parsed = AIREventSchema.parse({
      id: '77777777-7777-4777-8777-777777777777',
      type: 'click',
      timestamp: 1_700_000_000_050,
      sessionId: 'session-77777777-7777-4777-8777-777777777777',
      fingerprint: {
        selector: 'button[type="submit"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'button',
        textExcerpt: 'Submit',
        context: {
          parentTag: 'form',
          nearestContainerTag: 'form',
        },
        attributes: {
          type: 'submit',
        },
        attributesHash: 'hash-no-a11y',
      },
    });

    expect(parsed.type).toBe('click');
    expect((parsed.fingerprint as Record<string, unknown>)?.accessibilityEvidence).toBeUndefined();
  });

  it('keeps legacy events without selectorCandidates schema-compatible', () => {
    const parsed = AIREventSchema.parse({
      id: '78787878-7878-4787-8787-787878787878',
      type: 'click',
      timestamp: 1_700_000_000_055,
      sessionId: 'session-78787878-7878-4787-8787-787878787878',
      fingerprint: {
        selector: 'button[type="submit"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'button',
        textExcerpt: 'Submit',
        context: {
          parentTag: 'form',
          nearestContainerTag: 'form',
        },
        attributes: {
          type: 'submit',
        },
        attributesHash: 'hash-no-selector-candidates',
      },
    });

    expect(parsed.type).toBe('click');
    expect((parsed.fingerprint as Record<string, unknown>)?.selectorCandidates).toBeUndefined();
  });

  it('rejects bare UUID session IDs while accepting session-prefixed IDs', () => {
    const event = {
      id: '88888888-8888-4888-8888-888888888888',
      type: 'click' as const,
      timestamp: 1_700_000_000_060,
      pageUrl: 'https://app.test/dashboard',
    };

    const bareResult = AIREventSchema.safeParse({
      ...event,
      sessionId: '88888888-8888-4888-8888-888888888888',
    });
    const prefixedResult = AIREventSchema.safeParse({
      ...event,
      sessionId: 'session-88888888-8888-4888-8888-888888888888',
    });

    expect(bareResult.success).toBe(false);
    expect(prefixedResult.success).toBe(true);
    if (prefixedResult.success) {
      expect(prefixedResult.data.sessionId).toBe('session-88888888-8888-4888-8888-888888888888');
    }
  });

  it('rejects events missing id at the schema boundary', () => {
    const result = AIREventSchema.safeParse({
      type: 'click',
      timestamp: 1_700_000_000_065,
      sessionId: 'session-89898989-8989-4898-8989-898989898989',
      pageUrl: 'https://app.test/dashboard',
    });

    expect(result.success).toBe(false);
  });

  it('rejects events with non-UUID ids at the schema boundary', () => {
    const result = AIREventSchema.safeParse({
      id: 'evt-1',
      type: 'click',
      timestamp: 1_700_000_000_066,
      sessionId: 'session-90909090-9090-4909-9090-909090909090',
      pageUrl: 'https://app.test/dashboard',
    });

    expect(result.success).toBe(false);
  });

  it('accepts custom-select selection payloads with label, value, and index', () => {
    const parsed = AIREventSchema.parse({
      id: '99999999-9999-4999-8999-999999999999',
      type: 'custom-select',
      timestamp: 1_700_000_000_070,
      sessionId: 'session-99999999-9999-4999-8999-999999999999',
      selection: {
        label: 'Admin',
        value: 'Admin',
        index: 1,
      },
      fingerprint: {
        selector: '[role="option"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'div',
        textExcerpt: 'Admin',
        context: {
          parentTag: 'div',
          nearestContainerTag: 'div',
        },
        attributes: {
          role: 'option',
        },
        attributesHash: 'hash-custom-select',
      },
    });

    expect((parsed as Record<string, unknown>).selection).toEqual({
      label: 'Admin',
      value: 'Admin',
      index: 1,
    });
  });
});
