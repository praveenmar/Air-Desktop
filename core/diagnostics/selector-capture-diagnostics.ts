import * as fs from 'fs';
import * as path from 'path';
import type {
  AIREvent,
  AccessibilityEvidence,
  BoundedFieldContext,
  CapturedSelectorCandidate,
  ElementFingerprint,
  PageSnapshot,
  SelectorAmbiguityMetadata,
} from '../types';

const SELECTOR_DIAGNOSTICS_ENV_KEY = 'AIR_SELECTOR_DIAGNOSTICS';
const DEFAULT_OUTPUT_ROOT = process.cwd();
const MAX_SAFE_TEXT_LENGTH = 80;
const MAX_ROOT_ATTR_LENGTH = 160;
const MAX_CAPTURED_SELECTOR_CANDIDATES = 8;
const AIR_TARGET_NODE_ID_ATTR = 'data-air-node-id';

const DIAGNOSTIC_EVENT_TYPES = new Set<AIREvent['type']>([
  'click',
  'input',
  'submit',
  'custom-control-open',
  'custom-select',
  'custom-menu-select',
]);

type FrameContextKind = 'main' | 'iframe';
type FingerprintSource = 'fingerprint' | 'triggerFingerprint' | null;
type SnapshotSourceKind = 'pageSnapshot' | 'pageState' | 'interactionContext' | null;

export interface SelectorCaptureDiagnostic {
  schemaVersion: 1;
  kind: 'selector-capture-diagnostic';
  timestamp: number;
  sessionId: string;
  eventId: string;
  traceId: string | null;
  tabId: string | null;
  url: string | null;
  normalizedUrl: string | null;
  eventType: AIREvent['type'];
  trigger?: string | null;
  viewport?: { width: number; height: number } | null;
  frameContext: FrameContextKind;
  captureVersion?: string | null;
  target: {
    tagName: string | null;
    inputType: string | null;
    role: string | null;
    accessibleName: string | null;
    accessibleNameSource: string | null;
    textExcerpt?: string | null;
    targetNodeId: string | null;
    targetIdentityStatus: string | null;
    targetIdentitySource?: string | null;
  };
  primarySelector: {
    selector: string | null;
    priority: string | null;
    matchCount: number | null;
    visibleMatchCount: number | null;
    positionInMatches: number | null;
    positionInVisibleMatches: number | null;
    warningCodes: string[];
  };
  selectorCandidates: Array<{
    family: string;
    engine: string;
    selector: string;
    strength: string;
    source: string;
    isPrimary: boolean;
    matchCount: number | null;
    visibleMatchCount: number | null;
    positionInAllMatches: number | null;
    positionInVisibleMatches: number | null;
    usesDynamicClass: boolean;
    usesIndex: boolean;
    warningCodes: string[];
  }>;
  boundedFieldContext?: {
    fieldLabelText?: string | null;
    fieldRelation?: string | null;
    targetControlKind?: string | null;
    containerSelector?: string | null;
    visibleControlCountInContainer?: number | null;
    competingControlCount?: number | null;
    isValid?: boolean;
    blockedReason?: string | null;
  };
  accessibilityEvidence?: {
    role?: string | null;
    accessibleName?: string | null;
    accessibleNameSource?: string | null;
    labelText?: string | null;
    isNativeLabelAssociation?: boolean;
  };
  snapshot: {
    hasSnapshot: boolean;
    hasPageSnapshot: boolean;
    hasPageState: boolean;
    source: SnapshotSourceKind;
    snapshotStage?: string | null;
    htmlChars: number;
    htmlBytes?: number;
    containsTargetNodeId: boolean;
    rootTagName: string | null;
    rootId: string | null;
    rootClass: string | null;
  };
  payload: {
    approxBytes: number;
  };
  notes: string[];
}

export interface SelectorCaptureDiagnosticsFs {
  mkdirSync(path: string, options?: fs.MakeDirectoryOptions): void;
  appendFileSync(path: string, data: string, options?: fs.WriteFileOptions): void;
}

export interface SelectorCaptureDiagnosticsLogger {
  log(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
}

export interface SelectorCaptureDiagnosticsWriterLike {
  writeEventDiagnostic(event: AIREvent): boolean;
}

export interface SelectorCaptureDiagnosticsWriterOptions {
  enabled?: boolean;
  rootDir?: string;
  fsImpl?: SelectorCaptureDiagnosticsFs;
  logger?: SelectorCaptureDiagnosticsLogger;
  env?: NodeJS.ProcessEnv;
}

function normalizeText(value: unknown, maxLength = MAX_SAFE_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function looksSensitiveText(value: string | null): boolean {
  if (!value) return false;
  if (/[A-Za-z0-9+/=_-]{32,}/.test(value)) return true;
  if (/\b\d{12,}\b/.test(value)) return true;
  return false;
}

function safeTextExcerpt(
  fingerprint: ElementFingerprint | null,
  event: AIREvent,
  tagName: string | null,
  inputType: string | null,
): string | null {
  const excerpt = normalizeText(fingerprint?.textExcerpt ?? null);
  if (!excerpt) return null;
  if (event.type === 'input') return null;
  if (inputType === 'password') return null;
  if (tagName && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)) return null;
  if (looksSensitiveText(excerpt)) return null;
  return excerpt;
}

function safeDisplayText(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return looksSensitiveText(normalized) ? null : normalized;
}

function extractFingerprintSource(event: AIREvent): { fingerprint: ElementFingerprint | null; source: FingerprintSource } {
  const direct = (event as { fingerprint?: ElementFingerprint | null }).fingerprint;
  if (direct) {
    return { fingerprint: direct, source: 'fingerprint' };
  }

  const trigger = (event as { triggerFingerprint?: ElementFingerprint | null }).triggerFingerprint;
  if (trigger) {
    return { fingerprint: trigger, source: 'triggerFingerprint' };
  }

  return { fingerprint: null, source: null };
}

function deriveTrigger(event: AIREvent): string | null {
  if ('trigger' in event && typeof event.trigger === 'string') {
    return event.trigger;
  }
  if (event.type === 'click' || event.type === 'submit') {
    return event.type;
  }
  return null;
}

function deriveFrameContext(event: AIREvent): FrameContextKind {
  return event.nestedContext?.isIframe === true ? 'iframe' : 'main';
}

function deriveViewport(event: AIREvent): { width: number; height: number } | null {
  if ('viewport' in event && event.viewport) {
    return event.viewport;
  }
  return null;
}

function derivePrimaryWarningCodes(ambiguity?: SelectorAmbiguityMetadata): string[] {
  if (!ambiguity) return [];
  const warningCodes = new Set<string>();
  if (ambiguity.matchCount > 1) warningCodes.add('multiple-matches');
  if (ambiguity.visibleMatchCount > 1) warningCodes.add('multiple-visible-matches');
  if (ambiguity.positionInMatches == null && ambiguity.matchCount > 0) warningCodes.add('target-not-in-matches');
  if (!ambiguity.isUnique && !ambiguity.isAmbiguous && ambiguity.visibleMatchCount === 0 && ambiguity.matchCount === 1) {
    warningCodes.add('not-visible');
  }
  return Array.from(warningCodes);
}

function selectPrimaryCandidate(fingerprint: ElementFingerprint | null): CapturedSelectorCandidate | null {
  const selector = fingerprint?.selector ?? null;
  const candidates = fingerprint?.selectorCandidates ?? [];
  const explicitPrimary = candidates.find(candidate => candidate.isPrimary);
  if (explicitPrimary) return explicitPrimary;
  if (!selector) return null;
  return candidates.find(candidate => candidate.selector === selector) ?? null;
}

function normalizeCandidate(candidate: CapturedSelectorCandidate) {
  return {
    family: candidate.family,
    engine: candidate.engine,
    selector: candidate.selector,
    strength: candidate.strength,
    source: candidate.source,
    isPrimary: candidate.isPrimary === true,
    matchCount: candidate.matchCount ?? null,
    visibleMatchCount: candidate.visibleMatchCount ?? null,
    positionInAllMatches: candidate.positionInAllMatches ?? null,
    positionInVisibleMatches: candidate.positionInVisibleMatches ?? null,
    usesDynamicClass: candidate.usesDynamicClass === true,
    usesIndex: candidate.usesIndex === true,
    warningCodes: candidate.warningCodes ?? [],
  };
}

function normalizeBoundedFieldContext(context?: BoundedFieldContext | null) {
  if (!context) return undefined;
  return {
    fieldLabelText: safeDisplayText(context.fieldLabelText ?? null),
    fieldRelation: context.fieldRelation ?? null,
    targetControlKind: context.targetControlKind ?? null,
    containerSelector: context.containerSelector ?? null,
    visibleControlCountInContainer: context.visibleControlCountInContainer ?? null,
    competingControlCount: context.competingControlCount ?? null,
    isValid: context.isValid,
    blockedReason: context.blockedReason ?? null,
  };
}

function normalizeAccessibilityEvidence(evidence?: AccessibilityEvidence | null) {
  if (!evidence) return undefined;
  return {
    role: evidence.role ?? null,
    accessibleName: safeDisplayText(evidence.accessibleName ?? null),
    accessibleNameSource: evidence.accessibleNameSource ?? null,
    labelText: safeDisplayText(evidence.labelText ?? null),
    isNativeLabelAssociation: evidence.isNativeLabelAssociation === true,
  };
}

function extractSnapshotStage(snapshot: PageSnapshot | null, source: SnapshotSourceKind): string | null {
  if (!snapshot) return null;
  const metrics = snapshot.metrics ?? {};
  const stageMetric = typeof metrics.stage === 'string' ? metrics.stage : null;
  if (stageMetric) return stageMetric;
  if (source === 'interactionContext' && metrics.fullPage === true) return 'interaction-context-full-page';
  if (metrics.subtree === true) return 'subtree-snapshot';
  if (metrics.fullPage === true) return 'full-page-snapshot';
  return source;
}

function extractTagAttributes(attrsSource: string): { rootId: string | null; rootClass: string | null } {
  const idMatch = attrsSource.match(/\sid=(?:"([^"]*)"|'([^']*)')/i);
  const classMatch = attrsSource.match(/\sclass=(?:"([^"]*)"|'([^']*)')/i);
  const rootId = normalizeText(idMatch?.[1] ?? idMatch?.[2] ?? null, MAX_ROOT_ATTR_LENGTH);
  const rootClass = normalizeText(classMatch?.[1] ?? classMatch?.[2] ?? null, MAX_ROOT_ATTR_LENGTH);
  return { rootId, rootClass };
}

function extractSnapshotRootSummary(html: string): { rootTagName: string | null; rootId: string | null; rootClass: string | null } {
  const tagMatch = html.match(/<([a-z0-9:-]+)(\s[^>]*)?>/i);
  if (!tagMatch) {
    return { rootTagName: null, rootId: null, rootClass: null };
  }

  const rootTagName = normalizeText(tagMatch[1] ?? null, 40)?.toUpperCase() ?? null;
  const attrsSource = tagMatch[2] ?? '';
  const { rootId, rootClass } = extractTagAttributes(attrsSource);
  return { rootTagName, rootId, rootClass };
}

function containsTargetNodeId(html: string, targetNodeId: string | null): boolean {
  if (!targetNodeId) return false;
  return html.includes(`${AIR_TARGET_NODE_ID_ATTR}="${targetNodeId}"`)
    || html.includes(`${AIR_TARGET_NODE_ID_ATTR}='${targetNodeId}'`);
}

function selectPreferredSnapshot(
  event: AIREvent,
  fingerprint: ElementFingerprint | null,
): { source: SnapshotSourceKind; snapshot: PageSnapshot | null } {
  const candidateBySource: Record<Exclude<SnapshotSourceKind, null>, PageSnapshot | null> = {
    pageSnapshot: (event as { pageSnapshot?: PageSnapshot | null }).pageSnapshot ?? null,
    pageState: (event as { pageState?: PageSnapshot | null }).pageState ?? null,
    interactionContext: (event as { interactionContext?: PageSnapshot | null }).interactionContext ?? null,
  };

  const preferred = fingerprint?.targetIdentitySource;
  if (preferred && candidateBySource[preferred]?.html) {
    return { source: preferred, snapshot: candidateBySource[preferred] };
  }

  for (const source of ['pageSnapshot', 'pageState', 'interactionContext'] as const) {
    const snapshot = candidateBySource[source];
    if (snapshot?.html) {
      return { source, snapshot };
    }
  }

  return { source: null, snapshot: null };
}

function eventPayloadByteLength(event: AIREvent): number {
  try {
    return Buffer.byteLength(JSON.stringify(event), 'utf8');
  } catch {
    return 0;
  }
}

export function isSelectorDiagnosticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[SELECTOR_DIAGNOSTICS_ENV_KEY];
  return value === 'true' || value === '1' || value === 'yes';
}

export function shouldCaptureSelectorDiagnostic(event: AIREvent): boolean {
  if (!DIAGNOSTIC_EVENT_TYPES.has(event.type)) return false;
  return !(event.type === 'input' && event.trigger === 'input:progress');
}

export function resolveSelectorCaptureDiagnosticPath(sessionId: string, rootDir = DEFAULT_OUTPUT_ROOT): string {
  const safeSessionId = sessionId.replace(/[\\/:*?"<>|]/g, '_');
  return path.resolve(rootDir, '.air', 'diagnostics', 'selector-capture', `${safeSessionId}.jsonl`);
}

export function buildSelectorCaptureDiagnostic(event: AIREvent): SelectorCaptureDiagnostic | null {
  if (!shouldCaptureSelectorDiagnostic(event)) return null;

  const { fingerprint, source: fingerprintSource } = extractFingerprintSource(event);
  const tagName = normalizeText(fingerprint?.tagName ?? null, 40)?.toUpperCase() ?? null;
  const inputType = normalizeText(fingerprint?.attributes?.type ?? null, 40)?.toLowerCase() ?? null;
  const accessibilityEvidence = normalizeAccessibilityEvidence(fingerprint?.accessibilityEvidence);
  const accessibleRole = accessibilityEvidence?.role ?? normalizeText(fingerprint?.attributes?.role ?? null, 40);
  const targetNodeId = fingerprint?.targetNodeId ?? null;
  const primaryCandidate = selectPrimaryCandidate(fingerprint);

  const snapshotSelection = selectPreferredSnapshot(event, fingerprint);
  const snapshotHtml = snapshotSelection.snapshot?.html ?? '';
  const snapshotRoot = snapshotHtml ? extractSnapshotRootSummary(snapshotHtml) : {
    rootTagName: null,
    rootId: null,
    rootClass: null,
  };

  const notes: string[] = [];
  if (!fingerprint) notes.push('missing-fingerprint');
  if (fingerprintSource === 'triggerFingerprint') notes.push('used-trigger-fingerprint');
  if (!targetNodeId) notes.push('missing-target-node-id');
  if (!snapshotSelection.snapshot?.html) {
    notes.push('missing-snapshot');
  } else if (targetNodeId && !containsTargetNodeId(snapshotHtml, targetNodeId)) {
    notes.push('snapshot-missing-target-node-id');
  }
  if (!fingerprint?.selectorCandidates?.length) notes.push('missing-selector-candidates');

  return {
    schemaVersion: 1,
    kind: 'selector-capture-diagnostic',
    timestamp: event.timestamp,
    sessionId: event.sessionId,
    eventId: event.id,
    traceId: event.traceId ?? null,
    tabId: event.tabId ?? null,
    url: event.pageUrl ?? snapshotSelection.snapshot?.url ?? null,
    normalizedUrl: event.normalizedUrl ?? snapshotSelection.snapshot?.normalizedUrl ?? null,
    eventType: event.type,
    trigger: deriveTrigger(event),
    viewport: deriveViewport(event),
    frameContext: deriveFrameContext(event),
    captureVersion: event.schemaVersion ?? null,
    target: {
      tagName,
      inputType,
      role: accessibleRole ?? null,
      accessibleName: accessibilityEvidence?.accessibleName ?? null,
      accessibleNameSource: accessibilityEvidence?.accessibleNameSource ?? null,
      textExcerpt: safeTextExcerpt(fingerprint, event, tagName, inputType),
      targetNodeId,
      targetIdentityStatus: fingerprint?.targetIdentityStatus ?? null,
      targetIdentitySource: fingerprint?.targetIdentitySource ?? null,
    },
    primarySelector: {
      selector: fingerprint?.selector ?? null,
      priority: fingerprint?.selectorPriority ?? null,
      matchCount: fingerprint?.selectorAmbiguity?.matchCount ?? null,
      visibleMatchCount: fingerprint?.selectorAmbiguity?.visibleMatchCount ?? null,
      positionInMatches: fingerprint?.selectorAmbiguity?.positionInMatches ?? null,
      positionInVisibleMatches: primaryCandidate?.positionInVisibleMatches ?? null,
      warningCodes: Array.from(new Set([
        ...derivePrimaryWarningCodes(fingerprint?.selectorAmbiguity),
        ...(primaryCandidate?.warningCodes ?? []),
      ])),
    },
    selectorCandidates: (fingerprint?.selectorCandidates ?? [])
      .slice(0, MAX_CAPTURED_SELECTOR_CANDIDATES)
      .map(normalizeCandidate),
    boundedFieldContext: normalizeBoundedFieldContext(fingerprint?.boundedFieldContext),
    accessibilityEvidence,
    snapshot: {
      hasSnapshot: !!snapshotSelection.snapshot?.html,
      hasPageSnapshot: !!(event as { pageSnapshot?: unknown }).pageSnapshot,
      hasPageState: !!(event as { pageState?: unknown }).pageState,
      source: snapshotSelection.source,
      snapshotStage: extractSnapshotStage(snapshotSelection.snapshot, snapshotSelection.source),
      htmlChars: snapshotHtml.length,
      htmlBytes: snapshotHtml ? Buffer.byteLength(snapshotHtml, 'utf8') : undefined,
      containsTargetNodeId: containsTargetNodeId(snapshotHtml, targetNodeId),
      rootTagName: snapshotRoot.rootTagName,
      rootId: snapshotRoot.rootId,
      rootClass: snapshotRoot.rootClass,
    },
    payload: {
      approxBytes: eventPayloadByteLength(event),
    },
    notes,
  };
}

export class SelectorCaptureDiagnosticsWriter implements SelectorCaptureDiagnosticsWriterLike {
  private readonly enabled: boolean;
  private readonly rootDir: string;
  private readonly fsImpl: SelectorCaptureDiagnosticsFs;
  private readonly logger: SelectorCaptureDiagnosticsLogger;
  private readonly warnedSessions = new Set<string>();

  constructor(options: SelectorCaptureDiagnosticsWriterOptions = {}) {
    this.enabled = options.enabled ?? isSelectorDiagnosticsEnabled(options.env);
    this.rootDir = path.resolve(options.rootDir ?? DEFAULT_OUTPUT_ROOT);
    this.fsImpl = options.fsImpl ?? fs;
    this.logger = options.logger ?? console;
  }

  public writeEventDiagnostic(event: AIREvent): boolean {
    if (!this.enabled) return false;

    const diagnostic = buildSelectorCaptureDiagnostic(event);
    if (!diagnostic) return false;

    const outputPath = resolveSelectorCaptureDiagnosticPath(event.sessionId, this.rootDir);
    try {
      this.fsImpl.mkdirSync(path.dirname(outputPath), { recursive: true });
      this.fsImpl.appendFileSync(outputPath, `${JSON.stringify(diagnostic)}\n`, 'utf8');
      this.logger.log(
        `[AIR_SELECTOR_DIAGNOSTIC] wrote event=${diagnostic.eventId} candidates=${diagnostic.selectorCandidates.length} snapshot=${diagnostic.snapshot.htmlChars}`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.warnedSessions.has(diagnostic.sessionId)) {
        this.logger.warn(
          `[AIR_SELECTOR_DIAGNOSTIC] write failed for session ${diagnostic.sessionId} – further errors suppressed. First error: ${message}`,
        );
        this.warnedSessions.add(diagnostic.sessionId);
      }
      return false;
    }
  }
}
