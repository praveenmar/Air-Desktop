import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { AIREventSchema, type AIREvent } from '../types/events';
import {
  buildSelectorCaptureDiagnostic,
  resolveSelectorCaptureDiagnosticPath,
  SelectorCaptureDiagnosticsWriter,
} from '../diagnostics/selector-capture-diagnostics';

function buildBaseFingerprint(overrides: Record<string, unknown> = {}) {
  return {
    selector: '.oxd-input',
    selectorPriority: 'class',
    selectorRank: 7,
    tagName: 'input',
    parentSelector: '.field-row',
    textExcerpt: null,
    context: {
      parentTag: 'div',
      nearestContainerTag: 'form',
    },
    attributes: {
      type: 'text',
      role: 'textbox',
      name: 'username',
      placeholder: 'Username',
      value: 'super-secret-value',
    },
    attributesHash: 'hash-123',
    selectorAmbiguity: {
      originalSelector: '.oxd-input',
      originalPriority: 'class',
      matchCount: 2,
      visibleMatchCount: 2,
      positionInMatches: 1,
      isUnique: false,
      isAmbiguous: true,
    },
    selectorCandidates: [
      {
        selector: '.oxd-input',
        engine: 'css',
        family: 'primary',
        strength: 'weak',
        source: 'capture',
        isPrimary: true,
        matchCount: 2,
        visibleMatchCount: 2,
        positionInAllMatches: 1,
        positionInVisibleMatches: 1,
        warningCodes: ['multiple-visible-matches'],
      },
      {
        selector: 'input[name="username"]',
        engine: 'css',
        family: 'name',
        strength: 'strong',
        source: 'capture',
        matchCount: 1,
        visibleMatchCount: 1,
        positionInAllMatches: 0,
        positionInVisibleMatches: 0,
      },
    ],
    boundedFieldContext: {
      fieldLabelText: 'Username',
      fieldRelation: 'sibling-label',
      targetControlKind: 'input',
      containerSelector: '.oxd-input-group',
      visibleControlCountInContainer: 1,
      competingControlCount: 0,
      isValid: true,
    },
    accessibilityEvidence: {
      role: 'textbox',
      accessibleName: 'Username',
      accessibleNameSource: 'placeholder',
    },
    targetNodeId: 'air-node-1',
    targetIdentityStatus: 'emitted',
    targetIdentitySource: 'pageSnapshot',
    ...overrides,
  };
}

function buildSnapshot(html: string, metrics: Record<string, unknown> = {}) {
  return {
    html,
    url: 'https://example.com/login',
    normalizedUrl: 'https://example.com/login',
    timestamp: 1730000000000,
    viewport: { width: 1920, height: 1080 },
    metrics,
  };
}

function buildClickEvent(overrides: Record<string, unknown> = {}): AIREvent {
  return AIREventSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    type: 'click',
    timestamp: 1730000000000,
    traceId: '22222222-2222-4222-8222-222222222222',
    sessionId: 'session-33333333-3333-4333-8333-333333333333',
    tabId: 'tab-1',
    pageUrl: 'https://example.com/login',
    normalizedUrl: 'https://example.com/login',
    pageTitle: 'Login',
    viewport: { width: 1920, height: 1080 },
    nestedContext: { isIframe: false },
    schemaVersion: 'air:v2',
    meta: { stateCapture: true },
    fingerprint: buildBaseFingerprint(),
    pageSnapshot: buildSnapshot(
      '<div class="oxd-input-group"><input data-air-node-id="air-node-1" name="username" type="text" value="secret" /></div>',
      { subtree: true },
    ),
    pageState: buildSnapshot(
      '<div class="oxd-input-group"><input data-air-node-id="air-node-1" name="username" type="text" value="secret" /></div>',
      { subtree: true },
    ),
    ...overrides,
  });
}

function buildPasswordInputEvent(overrides: Record<string, unknown> = {}): AIREvent {
  return AIREventSchema.parse({
    id: '44444444-4444-4444-8444-444444444444',
    type: 'input',
    trigger: 'change',
    timestamp: 1730000001000,
    traceId: '55555555-5555-4555-8555-555555555555',
    sessionId: 'session-66666666-6666-4666-8666-666666666666',
    tabId: 'tab-2',
    pageUrl: 'https://example.com/login',
    normalizedUrl: 'https://example.com/login',
    pageTitle: 'Login',
    viewport: { width: 1440, height: 900 },
    nestedContext: { isIframe: true, iframeSameOrigin: true },
    schemaVersion: 'air:v2',
    inputValueMasked: '[REDACTED]',
    inputLength: 12,
    fingerprint: buildBaseFingerprint({
      tagName: 'input',
      textExcerpt: 'secret-password-value',
      attributes: {
        type: 'password',
        role: 'textbox',
        name: 'password',
        placeholder: 'Password',
        value: 'hunter2',
      },
      accessibilityEvidence: {
        role: 'textbox',
        accessibleName: 'Password',
        accessibleNameSource: 'placeholder',
      },
    }),
    pageSnapshot: buildSnapshot(
      '<div class="login-password"><input data-air-node-id="air-node-1" type="password" value="hunter2" /></div>',
      { subtree: true },
    ),
    pageState: buildSnapshot(
      '<div class="login-password"><input data-air-node-id="air-node-1" type="password" value="hunter2" /></div>',
      { subtree: true },
    ),
    ...overrides,
  });
}

describe('selector capture diagnostics', () => {
  it('builds a compact diagnostic summary from existing event payload data', () => {
    const diagnostic = buildSelectorCaptureDiagnostic(buildClickEvent());

    expect(diagnostic).toEqual(expect.objectContaining({
      kind: 'selector-capture-diagnostic',
      schemaVersion: 1,
      sessionId: 'session-33333333-3333-4333-8333-333333333333',
      eventId: '11111111-1111-4111-8111-111111111111',
      eventType: 'click',
      frameContext: 'main',
      captureVersion: 'air:v2',
      target: expect.objectContaining({
        tagName: 'INPUT',
        inputType: 'text',
        role: 'textbox',
        accessibleName: 'Username',
        accessibleNameSource: 'placeholder',
        targetNodeId: 'air-node-1',
        targetIdentityStatus: 'emitted',
      }),
      primarySelector: expect.objectContaining({
        selector: '.oxd-input',
        priority: 'class',
        matchCount: 2,
        visibleMatchCount: 2,
        positionInMatches: 1,
        positionInVisibleMatches: 1,
        warningCodes: expect.arrayContaining(['multiple-visible-matches']),
      }),
      snapshot: expect.objectContaining({
        hasSnapshot: true,
        source: 'pageSnapshot',
        snapshotStage: 'subtree-snapshot',
        htmlChars: expect.any(Number),
        containsTargetNodeId: true,
        rootTagName: 'DIV',
        rootClass: 'oxd-input-group',
      }),
    }));
    expect(diagnostic?.selectorCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        family: 'name',
        selector: 'input[name="username"]',
        strength: 'strong',
      }),
    ]));
    expect((diagnostic as any)?.snapshot?.html).toBeUndefined();
  });

  it('omits sensitive text and full snapshot html from diagnostics', () => {
    const diagnostic = buildSelectorCaptureDiagnostic(buildPasswordInputEvent());

    expect(diagnostic?.frameContext).toBe('iframe');
    expect(diagnostic?.target.textExcerpt).toBeNull();
    expect(diagnostic?.target.accessibleName).toBe('Password');
    expect(JSON.stringify(diagnostic)).not.toContain('hunter2');
    expect(JSON.stringify(diagnostic)).not.toContain('secret-password-value');
    expect((diagnostic as any)?.snapshot?.html).toBeUndefined();
  });

  it('skips non-committed input heartbeats', () => {
    const diagnostic = buildSelectorCaptureDiagnostic(buildPasswordInputEvent({
      trigger: 'input:progress',
    }));

    expect(diagnostic).toBeNull();
  });

  it('writes one JSONL line per event when enabled', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'air-selector-diagnostics-'));
    try {
      const writer = new SelectorCaptureDiagnosticsWriter({
        enabled: true,
        rootDir,
        logger: { log: vi.fn(), warn: vi.fn() },
      });

      expect(writer.writeEventDiagnostic(buildClickEvent())).toBe(true);
      expect(writer.writeEventDiagnostic(buildClickEvent({
        id: '77777777-7777-4777-8777-777777777777',
        timestamp: 1730000002000,
      }))).toBe(true);

      const outputPath = resolveSelectorCaptureDiagnosticPath(
        'session-33333333-3333-4333-8333-333333333333',
        rootDir,
      );
      expect(outputPath).toContain(path.join('.air', 'diagnostics', 'selector-capture'));
      expect(outputPath).toContain('session-33333333-3333-4333-8333-333333333333.jsonl');
      expect(fs.existsSync(outputPath)).toBe(true);

      const lines = fs.readFileSync(outputPath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(() => JSON.parse(lines[0]!)).not.toThrow();
      expect(() => JSON.parse(lines[1]!)).not.toThrow();

      const firstEntry = JSON.parse(lines[0]!) as Record<string, any>;
      expect(firstEntry.target.targetNodeId).toBe('air-node-1');
      expect(firstEntry.target.targetIdentityStatus).toBe('emitted');
      expect(firstEntry.selectorCandidates).toHaveLength(2);
      expect(firstEntry.snapshot.htmlChars).toBeGreaterThan(0);
      expect(firstEntry.snapshot.containsTargetNodeId).toBe(true);
      expect(firstEntry.snapshot.html).toBeUndefined();
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('does nothing when diagnostics are disabled', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'air-selector-diagnostics-disabled-'));
    const mkdirSync = vi.fn<typeof fs.mkdirSync>();
    const appendFileSync = vi.fn<typeof fs.appendFileSync>();

    try {
      const writer = new SelectorCaptureDiagnosticsWriter({
        enabled: false,
        rootDir,
        fsImpl: {
          mkdirSync,
          appendFileSync,
        },
        logger: { log: vi.fn(), warn: vi.fn() },
      });

      expect(writer.writeEventDiagnostic(buildClickEvent())).toBe(false);
      expect(mkdirSync).not.toHaveBeenCalled();
      expect(appendFileSync).not.toHaveBeenCalled();
      expect(fs.existsSync(resolveSelectorCaptureDiagnosticPath(
        'session-33333333-3333-4333-8333-333333333333',
        rootDir,
      ))).toBe(false);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('swallows writer failures without throwing into event processing flow', () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const writer = new SelectorCaptureDiagnosticsWriter({
      enabled: true,
      rootDir: path.join(os.tmpdir(), 'air-selector-diagnostics-fail'),
      fsImpl: {
        mkdirSync: vi.fn(),
        appendFileSync: vi.fn(() => {
          throw new Error('disk full');
        }),
      },
      logger,
    });

    expect(() => writer.writeEventDiagnostic(buildClickEvent())).not.toThrow();
    expect(writer.writeEventDiagnostic(buildClickEvent())).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});
