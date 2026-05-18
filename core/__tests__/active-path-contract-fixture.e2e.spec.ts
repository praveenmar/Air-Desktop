import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';
import { AIREventSchema } from '../types/events';
import { openAsyncDatabase, type AsyncSQLiteDatabase } from '../db/sqlite-adapter';
import { runMigrations } from '../db/migrations';
import { NodeRepository } from '../db/repositories/node.repository';
import { EdgeRepository } from '../db/repositories/edge.repository';
import { EventRepository } from '../db/repositories/event.repository';
import { SessionRepository } from '../db/repositories/session.repository';
import { OutcomeRepository } from '../db/repositories/outcome.repository';
import { PendingActionRepository } from '../db/repositories/pending-action.repository';
import { InteractionContextRepository } from '../db/repositories/interaction-context.repository';
import { DebugLogger } from '../logger/debug-logger';
import { GraphBuilder } from '../graph/graph-builder';
import { StateEngine } from '../graph/state-engine';
import { CodegenService } from '../../packages/codegen/src/codegen.service';
import type { AirMetadata } from '../../packages/codegen/src/sidecar.types';
import {
  ACTIVE_PATH_SESSION_ID,
  buildActivePathClickEvent,
  buildActivePathOutcomeEvent,
  buildRawActivePathSnapshot,
  buildSprint5ResolverMetadata,
} from './fixtures/active-path-contract.fixture';

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
  normalizeSnapshotFieldForTransport: (
    snapshotValue: unknown,
    fieldName: string,
    maxBytes: number,
    eventContext?: Record<string, unknown> | null,
    options?: Record<string, unknown>,
  ) => { value: unknown; meta: Record<string, unknown> | null };
  normalizeUrl: (url: string) => string;
  log: (...args: unknown[]) => void;
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
  interceptor.log = () => undefined;
  interceptor.normalizeUrl = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  };
  return interceptor;
}

function createTempDbPath(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'air-active-contract-'));
  return {
    dir,
    dbPath: path.join(dir, 'air.sqlite'),
  };
}

async function createRealGraphBuilder(db: AsyncSQLiteDatabase): Promise<GraphBuilder> {
  return new GraphBuilder(
    db,
    new NodeRepository(db),
    new EdgeRepository(db),
    new EventRepository(db),
    new SessionRepository(db),
    new OutcomeRepository(db),
    new PendingActionRepository(db),
    new InteractionContextRepository(db),
    StateEngine,
    new DebugLogger(db),
  );
}

describe('active-path end-to-end contract fixture', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves expected active-path truth across parse, normalization, DB, codegen, and sidecar boundaries', async () => {
    const rawSnapshot = buildRawActivePathSnapshot();
    const normalizedSnapshot = withBrowserGlobals(rawSnapshot.url, () => {
      const interceptor = makeNormalizationHarness();
      const normalized = interceptor.normalizeSnapshotFieldForTransport(
        rawSnapshot,
        'pageSnapshot',
        200_000,
        { eventId: 'fixture-click', type: 'click' },
      );
      return normalized.value as Record<string, unknown>;
    });

    expect(normalizedSnapshot.compositeAnchors).toHaveLength(1);
    expect((normalizedSnapshot.metrics as Record<string, unknown>).anchorScanTotalMs).toBe(18.4);
    expect(normalizedSnapshot.snapshotBuildId).toBe('snapshot-build-42');

    const parsedClick = AIREventSchema.parse(buildActivePathClickEvent(normalizedSnapshot));
    const parsedOutcome = AIREventSchema.parse(buildActivePathOutcomeEvent(normalizedSnapshot));

    expect(parsedClick.type).toBe('click');
    expect(parsedClick.pageSnapshot).toEqual(expect.objectContaining({
      html: expect.stringContaining('profile-form'),
      snapshotBuildId: 'snapshot-build-42',
    }));
    expect(parsedClick.nestedContext).toEqual(expect.objectContaining({
      isShadowDom: true,
      degradedReason: 'probable_closed_shadow_host',
      captureHint: 'shadow-fallback',
    }));
    expect(parsedClick.fingerprint?.attributes).toEqual(expect.objectContaining({
      href: 'https://app.test/profile/help',
      type: 'submit',
      title: 'Save Profile',
      alt: 'Save Icon',
      value: 'Save',
      class: 'btn btn-primary profile-save',
      classList: 'btn btn-primary profile-save',
      dataCy: 'save-profile',
      'data-cy': 'save-profile',
      dataQa: 'save-profile',
      'data-qa': 'save-profile',
      dataTestId: 'save-profile',
      'data-testid': 'save-profile',
      ariaLabel: 'Save Profile',
      'aria-label': 'Save Profile',
    }));
    expect(parsedClick.fingerprint?.selectorCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selector: '[data-testid="save-profile"]',
        engine: 'css',
        family: 'primary',
        positionInAllMatches: 0,
        positionInVisibleMatches: 0,
      }),
    ]));
    expect(parsedClick.fingerprint).toEqual(expect.objectContaining({
      targetNodeId: 'air-node-1',
      targetIdentitySource: 'pageSnapshot',
      targetIdentityStatus: 'emitted',
    }));

    expect(parsedOutcome.type).toBe('outcome');
    expect(parsedOutcome.interactionContext).toEqual(expect.objectContaining({
      snapshotBuildId: 'snapshot-build-42',
      compositeAnchors: expect.any(Array),
      metrics: expect.objectContaining({
        compositeScanMs: 8.9,
      }),
    }));

    const { dir, dbPath } = createTempDbPath();
    tempDirs.push(dir);
    const db = await openAsyncDatabase(dbPath);
    await runMigrations(db);
    const graphBuilder = await createRealGraphBuilder(db);

    await graphBuilder.processEvent(parsedClick);
    await graphBuilder.processEvent(parsedOutcome);

    const storedEvents = await db.prepare(`
      SELECT id, type, payload
      FROM events
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `).all<{ id: string; type: string; payload: string }>(ACTIVE_PATH_SESSION_ID);

    expect(storedEvents).toHaveLength(2);
    const storedClickPayload = JSON.parse(storedEvents[0].payload);
    const storedOutcomePayload = JSON.parse(storedEvents[1].payload);

    // Intentional graph policy: click snapshots are trimmed from events.payload after validation
    // so large node-resolution snapshots do not persist on non-event-local action types.
    expect(storedClickPayload.pageSnapshot).toBeUndefined();
    expect(storedClickPayload.pageState).toBeUndefined();
    expect(storedClickPayload.nestedContext).toEqual(expect.objectContaining({
      isShadowDom: true,
      degradedReason: 'probable_closed_shadow_host',
      captureHint: 'shadow-fallback',
    }));
    expect(storedClickPayload.fingerprint.attributes).toEqual(expect.objectContaining({
      class: 'btn btn-primary profile-save',
      classList: 'btn btn-primary profile-save',
      dataCy: 'save-profile',
      'data-qa': 'save-profile',
      href: 'https://app.test/profile/help',
      type: 'submit',
      title: 'Save Profile',
      alt: 'Save Icon',
      value: 'Save',
    }));
    expect(storedClickPayload.fingerprint.selectorCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selector: '[data-testid="save-profile"]',
        engine: 'css',
        family: 'primary',
        positionInAllMatches: 0,
        positionInVisibleMatches: 0,
      }),
    ]));
    expect(storedClickPayload.fingerprint).toEqual(expect.objectContaining({
      targetNodeId: 'air-node-1',
      targetIdentitySource: 'pageSnapshot',
      targetIdentityStatus: 'emitted',
    }));

    // Intentional graph policy: outcome pageSnapshot/pageState trim, but interactionContext is kept
    // because downstream D3.5/Sprint 5 diagnostics consume it.
    expect(storedOutcomePayload.pageSnapshot).toBeUndefined();
    expect(storedOutcomePayload.pageState).toBeUndefined();
    expect(storedOutcomePayload.interactionContext).toEqual(expect.objectContaining({
      snapshotBuildId: 'snapshot-build-42',
      compositeAnchors: expect.any(Array),
      metrics: expect.objectContaining({
        repeatedScanCount: 2,
        finalCompositeCount: 1,
        droppedCompositeCount: 0,
      }),
    }));

    const interactionContextRow = await db.prepare(`
      SELECT normalized_url AS normalizedUrl, control_signature AS controlSignature, snapshot_html AS snapshotHtml, anchors
      FROM interaction_contexts
      WHERE session_id = ?
      LIMIT 1
    `).get<{ normalizedUrl: string; controlSignature: string; snapshotHtml: string; anchors: string }>(ACTIVE_PATH_SESSION_ID);

    expect(interactionContextRow?.normalizedUrl).toBe('https://app.test/profile');
    expect(interactionContextRow?.controlSignature).toBe('sig-profile-save');
    expect(interactionContextRow?.snapshotHtml).toContain('profile-form');
    expect(interactionContextRow?.snapshotHtml).toContain('data-air-node-id="air-node-1"');
    // Intentional table shape: interaction_contexts stores flattened HTML + flat anchors only.
    expect(JSON.parse(interactionContextRow?.anchors || '[]')).toEqual(rawSnapshot.anchors);

    await db.close();

    const codegen = new CodegenService({
      dbPath,
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    });

    try {
      const session = codegen.buildSession(ACTIVE_PATH_SESSION_ID);
      expect(session.steps).toHaveLength(1);
      expect(session.steps[0].fingerprint?.attributes).toEqual(expect.objectContaining({
        class: 'btn btn-primary profile-save',
        classList: 'btn btn-primary profile-save',
        dataCy: 'save-profile',
        'data-cy': 'save-profile',
        dataQa: 'save-profile',
        'data-qa': 'save-profile',
        href: 'https://app.test/profile/help',
        type: 'submit',
        title: 'Save Profile',
        alt: 'Save Icon',
        value: 'Save',
      }));
      expect(session.steps[0].fingerprint?.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '[data-testid="save-profile"]',
          engine: 'css',
          family: 'primary',
          positionInAllMatches: 0,
          positionInVisibleMatches: 0,
        }),
      ]));
      expect(session.steps[0].fingerprint).toEqual(expect.objectContaining({
        targetNodeId: 'air-node-1',
        targetIdentitySource: 'pageSnapshot',
        targetIdentityStatus: 'emitted',
      }));
      expect(session.steps[0].targetNodeId).toBe('air-node-1');

      const resolverMetadata = buildSprint5ResolverMetadata();
      const sidecar: AirMetadata = {
        version: 1,
        session: ACTIVE_PATH_SESSION_ID,
        generatedAt: '2026-05-01T00:00:00.000Z',
        methods: {
          saveProfile: {
            step: session.steps[0].step,
            intent: session.steps[0].intent,
            checksum: 'checksum-save-profile',
            originalSelector: session.steps[0].selector,
            resolver: resolverMetadata,
            selectorUsed: session.steps[0].selector,
            selectorType: session.steps[0].selectorPriority,
            actionType: session.steps[0].action,
            locatorFlavor: 'css',
          },
        },
      };

      const serializedSidecar = JSON.parse(JSON.stringify(sidecar));
      const persistedResolver = serializedSidecar.methods.saveProfile.resolver;
      expect(persistedResolver.rejectReason).toBe('href_mismatch');
      expect(persistedResolver.rejectedCandidates).toEqual([
        { selector: 'a.help-link', reason: 'href_mismatch' },
      ]);
      expect(persistedResolver.snapshotTargetEvidence).toBe(true);
      expect(persistedResolver.semanticCompatibilityScore).toBe(0.41);
      expect(persistedResolver.idEntropyScore).toBe(0.18);
      expect(persistedResolver.classEntropyScore).toBe(0.36);
    } finally {
      codegen.close();
    }
  });
});
