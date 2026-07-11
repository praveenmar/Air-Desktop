import type {
  CodegenStep,
  ResolverSnapshotSource,
  SnapshotCandidateTraceEntry,
  SnapshotSelectionProvenance,
  TemporalClass,
} from './types';
import { isVisibleElement as isSnapshotDomVisibleElement } from './resolver/visibility';

export type SnapshotSelectionMode = 'action' | 'outcome';

export const SNAPSHOT_SELECTION_REASONS = {
  SELECTED_EVENT_LOCAL_PAGE_STATE_BY_EVENT_ID: 'selected_event_local_pageState_by_eventId',
  SELECTED_EVENT_LOCAL_PAGE_SNAPSHOT_BY_EVENT_ID: 'selected_event_local_pageSnapshot_by_eventId',
  SELECTED_SOURCE_NODE_SNAPSHOT_AFTER_EVENT_LOCAL_MISSING: 'selected_source_node_snapshot_after_event_local_missing',
  SELECTED_IC_EXACT_FOR_ACTION_FALLBACK: 'selected_ic_exact_for_action_fallback',
  SELECTED_IC_STABLE_BY_URL_FOR_ACTION_FALLBACK: 'selected_ic_stable_by_url_for_action_fallback',
  SELECTED_URL_EVENT_FALLBACK_LAST_RESORT: 'selected_url_event_fallback_last_resort',
  SELECTED_IC_EXACT_STABLE_FOR_OUTCOME_STATE: 'selected_ic_exact_stable_for_outcome_state',
  SELECTED_IC_EXACT_FOR_OUTCOME_STATE: 'selected_ic_exact_for_outcome_state',
  SELECTED_OUTCOME_EVENT_SNAPSHOT: 'selected_outcome_event_snapshot',
  SELECTED_DESTINATION_NODE_SNAPSHOT_AFTER_OUTCOME_MISSING: 'selected_destination_node_snapshot_after_outcome_missing',
  SELECTED_UNAVAILABLE_NO_SNAPSHOT_FOUND: 'selected_unavailable_no_snapshot_found',
} as const;

export const SNAPSHOT_SKIP_REASONS = {
  EVENT_LOCAL_UNAVAILABLE_MISSING_EVENT_ID: 'event_local_unavailable_missing_eventId',
  EVENT_LOCAL_PAGE_STATE_MISSING: 'event_local_pageState_missing_for_eventId',
  EVENT_LOCAL_PAGE_SNAPSHOT_MISSING: 'event_local_pageSnapshot_missing_for_eventId',
  SOURCE_NODE_SNAPSHOT_MISSING: 'source_node_snapshot_missing',
  INTERACTION_CONTEXT_EXACT_MISSING: 'interaction_context_exact_missing',
  INTERACTION_CONTEXT_STABLE_BY_URL_MISSING: 'interaction_context_stable_by_url_missing',
  INTERACTION_CONTEXT_ANY_BY_URL_MISSING: 'interaction_context_any_by_url_missing',
  URL_EVENT_FALLBACK_MISSING: 'url_event_fallback_missing',
  OUTCOME_EVENT_SNAPSHOT_MISSING: 'outcome_event_snapshot_missing',
  DESTINATION_NODE_SNAPSHOT_MISSING: 'destination_node_snapshot_missing',
  NORMALIZED_URL_MISSING: 'normalized_url_missing',
  CONTROL_SIGNATURE_MISSING: 'control_signature_missing',
  EXACT_IC_SKIPPED_MISSING_CONTROL_SIGNATURE: 'exact_ic_skipped_missing_control_signature',
  IC_STALE: 'ic_stale',
  SNAPSHOT_PARSE_FAILED: 'snapshot_parse_failed',
  POST_ACTION_NOT_ALLOWED_FOR_ACTION_RESOLUTION: 'post_action_not_allowed_for_action_resolution',
  TARGET_MISSING_IN_SNAPSHOT: 'target_missing_in_snapshot',
  STATE_BOUNDARY_CROSSED: 'state_boundary_crossed',
  TAB_MISMATCH: 'tab_mismatch',
  INCOMPATIBLE_STATE: 'incompatible_state',
  IC_TAB_UNKNOWN: 'ic_tab_unknown',
  SHADOW_DOM_NOT_SERIALIZED: 'shadow_dom_not_serialized',
  CLOSED_SHADOW_DOM_UNOBSERVABLE: 'closed_shadow_dom_unobservable',
  HIGHER_PRIORITY_CANDIDATE_ALREADY_SELECTED: 'higher_priority_candidate_already_selected',
} as const;

export type HardBoundaryKind =
  | 'navigation'
  | 'url_change'
  | 'spa_route_change'
  | 'tab_change'
  | 'cross_tab_handoff';

export interface StateBoundary {
  timestamp: number;
  kind: HardBoundaryKind;
  eventId?: string;
  traceId?: string | null;
  tabId?: string | null;
  fromTabId?: string | null;
  toTabId?: string | null;
  fromNormalizedUrl?: string | null;
  toNormalizedUrl?: string | null;
}

export interface SnapshotHandle {
  source: ResolverSnapshotSource;
  temporalClass: TemporalClass;
  eventId?: string;
  sourceNodeId?: string;
  timestamp?: number;
  tabId?: string | null;
  normalizedUrl?: string;
  controlSignature?: string;
  confidenceScore?: number;
  load(): Document | null;
}

export interface EventLocalSnapshotHandles {
  pageState?: SnapshotHandle;
  pageSnapshot?: SnapshotHandle;
}

export interface SnapshotInventory {
  snapshotEngineAvailable?: boolean;
  hardBoundaries: StateBoundary[];
  icBoundaryToleranceMs?: number;
  eventLocalByEventId: Map<string, EventLocalSnapshotHandles>;
  interactionContextExactStable: Map<string, SnapshotHandle>;
  interactionContextExactAny: Map<string, SnapshotHandle>;
  interactionContextStableByUrl: Map<string, SnapshotHandle>;
  interactionContextAnyByUrl: Map<string, SnapshotHandle>;
  outcomeEventByTraceId: Map<string, SnapshotHandle>;
  sourceNodeById: Map<string, SnapshotHandle>;
  destinationNodeById: Map<string, SnapshotHandle>;
  urlEventFallbackByNormalizedUrl: Map<string, SnapshotHandle>;
}

interface SnapshotCandidateOption {
  source: ResolverSnapshotSource;
  temporalClass: TemporalClass;
  reasonIfSelected: string;
  skipReasonIfMissing: string;
  handle?: SnapshotHandle;
  eventId?: string;
  sourceNodeId?: string;
  timestamp?: number;
  confidenceScore?: number;
}

export interface SnapshotSelectionResult {
  snapshot: Document | null;
  provenance: SnapshotSelectionProvenance;
  evaluatedCandidates: SnapshotCandidateTraceEntry[];
}

interface LabelStructureEvidence {
  active: boolean;
  evidence: boolean;
  score: number;
  reason: string | null;
  blockedReason: string | null;
}

function buildIcKey(normalizedUrl: string, controlSignature?: string | null): string {
  return `${normalizedUrl}|${controlSignature ?? ''}`;
}

function isInteractionContextSource(source: ResolverSnapshotSource): boolean {
  return source === 'interaction-context-exact'
    || source === 'interaction-context-stable-by-url'
    || source === 'interaction-context-any-by-url';
}

function isStepNavigationLike(step: CodegenStep): boolean {
  return step.outcomeType === 'navigation';
}

function findNextHardBoundaryForAction(
  step: CodegenStep,
  inventory: SnapshotInventory
): StateBoundary | null {
  if (typeof step.timestamp !== 'number') return null;

  for (const boundary of inventory.hardBoundaries) {
    if (boundary.timestamp < step.timestamp) continue;

    if (boundary.kind === 'tab_change') {
      if (!step.tabId) return boundary;
      if (boundary.fromTabId === step.tabId || boundary.tabId === step.tabId) {
        return boundary;
      }
      continue;
    }

    if (step.tabId && boundary.tabId && boundary.tabId !== step.tabId) {
      continue;
    }

    return boundary;
  }

  return null;
}

function evaluateInteractionContextState(
  step: CodegenStep,
  candidate: SnapshotCandidateOption,
  inventory: SnapshotInventory,
  mode: SnapshotSelectionMode
): { skipReason?: string; confidenceScore?: number; annotationReason?: string } {
  const handle = candidate.handle;
  if (!handle || !isInteractionContextSource(candidate.source)) {
    return {};
  }

  const toleranceMs = inventory.icBoundaryToleranceMs ?? 75;
  const baseConfidence = deriveBaseConfidence(candidate, mode);

  const maybeStaleForSameState = (): { confidenceScore?: number; annotationReason?: string } => {
    if (
      typeof step.timestamp === 'number' &&
      typeof handle.timestamp === 'number' &&
      handle.timestamp + toleranceMs < step.timestamp
    ) {
      return {
        confidenceScore: Math.min(baseConfidence, mode === 'action' ? 0.35 : 0.7),
        annotationReason: SNAPSHOT_SKIP_REASONS.IC_STALE,
      };
    }
    return {};
  };

  if (step.tabId && handle.tabId && handle.tabId !== step.tabId) {
    return { skipReason: SNAPSHOT_SKIP_REASONS.TAB_MISMATCH, confidenceScore: 0 };
  }

  if (mode === 'action') {
    if (step.tabId && !handle.tabId) {
      return { confidenceScore: Math.min(baseConfidence, 0.5) };
    }

    if (
      step.controlSignature &&
      handle.controlSignature &&
      handle.controlSignature !== step.controlSignature
    ) {
      return { skipReason: SNAPSHOT_SKIP_REASONS.INCOMPATIBLE_STATE, confidenceScore: 0 };
    }

    const nextBoundary = findNextHardBoundaryForAction(step, inventory);
    if (
      nextBoundary &&
      typeof handle.timestamp === 'number' &&
      handle.timestamp > nextBoundary.timestamp + toleranceMs
    ) {
      return { skipReason: SNAPSHOT_SKIP_REASONS.STATE_BOUNDARY_CROSSED, confidenceScore: 0 };
    }

    const staleEvaluation = maybeStaleForSameState();
    if (!step.controlSignature && candidate.source === 'interaction-context-stable-by-url') {
      return {
        confidenceScore: Math.min(staleEvaluation.confidenceScore ?? baseConfidence, 0.3),
        annotationReason: staleEvaluation.annotationReason,
      };
    }

    return staleEvaluation;
  }

  if (step.tabId && !handle.tabId) {
    return { confidenceScore: Math.min(baseConfidence, 0.7) };
  }

  if (
    typeof step.timestamp === 'number' &&
    typeof handle.timestamp === 'number' &&
    handle.timestamp + toleranceMs < step.timestamp
  ) {
    return {
      confidenceScore: Math.min(baseConfidence, 0.7),
      annotationReason: SNAPSHOT_SKIP_REASONS.IC_STALE,
    };
  }

  if (
    !isStepNavigationLike(step) &&
    step.controlSignature &&
    handle.controlSignature &&
    handle.controlSignature !== step.controlSignature
  ) {
    return { skipReason: SNAPSHOT_SKIP_REASONS.INCOMPATIBLE_STATE, confidenceScore: 0 };
  }

  return {};
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function getFieldLabelText(step: CodegenStep): string | null {
  const value = step.fingerprint?.attributes?.fieldLabelText;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasStrongDirectSelectorEvidence(step: CodegenStep): boolean {
  const priority = step.selectorPriority;
  if (
    priority === 'data-testid'
    || priority === 'id'
    || priority === 'attribute'
    || priority === 'text'
  ) {
    return true;
  }

  const attrs = step.fingerprint?.attributes ?? {};
  return !!(
    attrs.dataTestId
    || attrs['data-testid']
    || attrs.dataCy
    || attrs['data-cy']
    || attrs.dataQa
    || attrs['data-qa']
    || attrs.id
    || attrs.name
    || attrs.placeholder
    || attrs.ariaLabel
    || attrs['aria-label']
    || attrs.href
  );
}

function isWeakLabelContextFallbackCandidate(step: CodegenStep): boolean {
  if (step.action !== 'input') return false;
  if (hasStrongDirectSelectorEvidence(step)) return false;
  const fieldLabelText = getFieldLabelText(step);
  if (!fieldLabelText) return false;
  const priority = step.selectorPriority ?? 'unknown';
  return priority === 'class' || priority === 'path' || priority === 'unknown' || priority === 'other';
}

function isLikelyCssSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('text=')) return false;
  if (trimmed.startsWith('//')) return false;
  if (trimmed.startsWith('xpath=')) return false;
  if (/^id\(".*"\)$/i.test(trimmed)) return false;
  return true;
}

function getVisibleInputLikeControls(root: ParentNode): Element[] {
  try {
    return Array.from(
      root.querySelectorAll(
        'input,textarea,select,[role="textbox"],[role="combobox"],[role="searchbox"],[role="spinbutton"],[contenteditable="true"],[aria-haspopup="listbox"],[aria-haspopup="combobox"]',
      ),
    ).filter(isSnapshotDomVisibleElement);
  } catch {
    return [];
  }
}

function findTightFieldContainer(label: Element, target: Element): { container: Element | null; blockedReason?: string } {
  let current: Element | null = label;
  let depth = 0;
  while (current && depth < 5) {
    const tagName = current.tagName?.toLowerCase() || '';
    if (['body', 'html', 'main', 'section', 'article', 'table', 'tbody', 'thead', 'form'].includes(tagName)) {
      break;
    }

    const controls = getVisibleInputLikeControls(current);
    if (controls.length === 1 && controls[0] === target) {
      return { container: current };
    }

    if (controls.length > 1 && controls.includes(target)) {
      return { container: null, blockedReason: 'multiple_input_like_targets' };
    }

    current = current.parentElement;
    depth += 1;
  }
  return { container: null, blockedReason: 'no_bounded_label_container' };
}

function findVisibleTargetForOriginalSelector(
  step: CodegenStep,
  snapshot: Document,
): { target: Element | null; blockedReason?: string } {
  const selector = step.selector?.trim();
  if (!selector || !isLikelyCssSelector(selector)) {
    return { target: null, blockedReason: 'label_structure_missing' };
  }

  try {
    const allMatches = Array.from(snapshot.querySelectorAll(selector));
    const matches = allMatches.filter(isSnapshotDomVisibleElement);
    if (matches.length === 1) return { target: matches[0] ?? null };
    if (matches.length > 1) return { target: null, blockedReason: 'target_selector_ambiguous' };
    if (allMatches.length > 0) {
      return { target: null, blockedReason: 'target_visibility_mismatch' };
    }
    return { target: null, blockedReason: 'target_missing' };
  } catch {
    return { target: null, blockedReason: 'target_selector_ambiguous' };
  }
}

function findLabelStructureEvidence(step: CodegenStep, snapshot: Document): LabelStructureEvidence {
  if (!isWeakLabelContextFallbackCandidate(step)) {
    return {
      active: false,
      evidence: false,
      score: 0,
      reason: null,
      blockedReason: null,
    };
  }

  const fieldLabelText = getFieldLabelText(step);
  if (!fieldLabelText) {
    return {
      active: true,
      evidence: false,
      score: 0,
      reason: null,
      blockedReason: 'field_label_missing',
    };
  }

  const targetResolution = findVisibleTargetForOriginalSelector(step, snapshot);
  const target = targetResolution.target;
  if (!target) {
    return {
      active: true,
      evidence: false,
      score: 0,
      reason: null,
      blockedReason: targetResolution.blockedReason ?? 'target_missing',
    };
  }

  let labels: Element[] = [];
  try {
    labels = Array.from(snapshot.querySelectorAll('label'));
  } catch {
    labels = [];
  }

  const normalizedFieldLabel = normalizeText(fieldLabelText);
  const matchingLabels = labels.filter(label => normalizeText(label.textContent || '') === normalizedFieldLabel);
  if (matchingLabels.length === 0) {
    return {
      active: true,
      evidence: false,
      score: 0,
      reason: null,
      blockedReason: 'label_missing',
    };
  }
  if (matchingLabels.length > 1) {
    return {
      active: true,
      evidence: false,
      score: 1,
      reason: 'label_text_match',
      blockedReason: 'duplicate_labels',
    };
  }

  const label = matchingLabels[0];
  let associationScore = 1;
  const targetId = target.getAttribute('id');
  const labelFor = label.getAttribute('for');
  if (targetId && labelFor === targetId) {
    associationScore = 3;
  } else if (label.contains(target)) {
    associationScore = 3;
  } else {
    const labelledBy = target.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/).filter(Boolean);
      const labelId = label.getAttribute('id');
      if (labelId && ids.includes(labelId)) {
        associationScore = 3;
      }
    }
  }

  const boundedContainer = findTightFieldContainer(label, target);
  if (!boundedContainer.container) {
    return {
      active: true,
      evidence: false,
      score: associationScore,
      reason: 'label_text_match',
      blockedReason: boundedContainer.blockedReason ?? 'no_bounded_label_container',
    };
  }

  const controls = getVisibleInputLikeControls(boundedContainer.container);
  if (controls.length !== 1 || controls[0] !== target) {
    return {
      active: true,
      evidence: false,
      score: associationScore + 1,
      reason: 'bounded_container_match',
      blockedReason: controls.length > 1 ? 'multiple_input_like_targets' : 'target_not_bound_to_label_container',
    };
  }

  return {
    active: true,
    evidence: true,
    score: associationScore + 3,
    reason: associationScore >= 3 ? 'exact_label_association' : 'bounded_label_structure',
    blockedReason: null,
  };
}

function labelEvidenceReason(evidence: LabelStructureEvidence): string | null {
  if (evidence.evidence) return evidence.reason;
  return evidence.blockedReason;
}

function isDestructiveAction(step: CodegenStep): boolean {
  const fingerprintText = step.fingerprint?.textExcerpt ?? '';
  const selector = step.selector ?? '';
  const combined = normalizeText([step.intent, fingerprintText, selector].filter(Boolean).join(' '));
  return /(delete|remove|close|dismiss|clear|archive)/.test(combined);
}

function shouldRunExpensivePresenceValidation(
  step: CodegenStep,
  candidate: SnapshotCandidateOption,
  mode: SnapshotSelectionMode
): boolean {
  if (mode === 'outcome') return true;
  if (isDestructiveAction(step)) return true;
  return candidate.temporalClass === 'post_action' || candidate.temporalClass === 'outcome_state';
}

function trySelectorPresence(step: CodegenStep, snapshot: Document): boolean | null {
  const selector = step.selector?.trim();
  if (!selector || !isLikelyCssSelector(selector)) return null;
  try {
    return !!snapshot.querySelector(selector);
  } catch {
    return null;
  }
}

function tryFingerprintPresence(step: CodegenStep, snapshot: Document): boolean {
  return !!findTargetEvidence(step, snapshot);
}

function cssEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '\\D ')
    .replace(/\t/g, '\\9 ');
}

function inferStepControlFamily(step: CodegenStep): string {
  const attrs = step.fingerprint?.attributes ?? {};
  const role = (attrs.role || '').toLowerCase();
  const type = (attrs.type || '').toLowerCase();
  const tagName = (step.fingerprint?.tagName || '').toLowerCase();
  const text = normalizeText(step.fingerprint?.textExcerpt || '');
  const selector = (step.selector || '').toLowerCase();

  if (role === 'menuitem') return 'menuitem';
  if (role === 'combobox') return 'combobox';
  if (type === 'password') return 'password-input';
  if (type === 'submit' || step.action === 'submit') return 'submit-button';
  if (attrs.href || tagName === 'a' || selector.startsWith('a') || selector.includes('[href=')) return 'nav-link';
  if (role === 'button' || tagName === 'button') return 'button';
  if (tagName === 'select') return 'combobox';
  if (role === 'textbox' || role === 'searchbox' || tagName === 'input' || tagName === 'textarea') {
    return type === 'password' ? 'password-input' : 'text-input';
  }
  if (
    step.action === 'custom-control-open' ||
    step.action === 'custom-select' ||
    step.action === 'custom-menu-select' ||
    text === '-- select --' ||
    selector.includes('select') ||
    role === 'listbox'
  ) {
    return 'select-trigger';
  }
  return 'generic-container';
}

function inferElementControlFamily(element: Element): string {
  const tagName = (((element as HTMLElement).tagName) || '').toLowerCase();
  const role = (element.getAttribute('role') || '').toLowerCase();
  const type = (element.getAttribute('type') || '').toLowerCase();
  const placeholder = normalizeText(element.getAttribute('placeholder') || '');

  if (role === 'menuitem') return 'menuitem';
  if (role === 'combobox' || role === 'listbox' || tagName === 'select') return 'combobox';
  if (type === 'password') return 'password-input';
  if (type === 'submit') return 'submit-button';
  if (tagName === 'a' || !!element.getAttribute('href')) return 'nav-link';
  if (tagName === 'button' || role === 'button') return 'button';
  if (tagName === 'input' || tagName === 'textarea' || role === 'textbox' || role === 'searchbox') {
    if (placeholder.includes('search') || type === 'search') return 'text-input';
    return 'text-input';
  }
  if (placeholder === '-- select --') return 'select-trigger';
  return 'generic-container';
}

function textSignalsFromElement(element: Element): string[] {
  const signals = [
    element.textContent || '',
    element.getAttribute('aria-label') || '',
    element.getAttribute('placeholder') || '',
    element.getAttribute('value') || '',
  ];
  return signals.map(normalizeText).filter(Boolean);
}

function findTargetEvidence(step: CodegenStep, snapshot: Document): string | null {
  const selector = step.selector?.trim();
  if (selector && isLikelyCssSelector(selector)) {
    try {
      const match = snapshot.querySelector(selector);
      if (match) return 'selector_match';
    } catch {
      // Ignore invalid selector fragments and continue.
    }
  }

  const fingerprint = step.fingerprint;
  if (!fingerprint) return null;
  const attrs = fingerprint.attributes ?? {};

  const attrChecks: Array<[string, string | undefined, (value: string) => string]> = [
    ['id', attrs.id, (value) => `#${cssEscape(value)}`],
    ['name', attrs.name, (value) => `[name="${cssEscape(value)}"]`],
    ['placeholder', attrs.placeholder, (value) => `[placeholder="${cssEscape(value)}"]`],
    ['role', attrs.role, (value) => `[role="${cssEscape(value)}"]`],
    ['href', attrs.href, (value) => `[href="${cssEscape(value)}"]`],
    ['data-testid', attrs.dataTestId ?? attrs['data-testid'], (value) => `[data-testid="${cssEscape(value)}"]`],
    ['data-cy', attrs.dataCy ?? attrs['data-cy'], (value) => `[data-cy="${cssEscape(value)}"]`],
    ['data-qa', attrs.dataQa ?? attrs['data-qa'], (value) => `[data-qa="${cssEscape(value)}"]`],
  ];

  for (const [label, value, selectorFactory] of attrChecks) {
    if (!value) continue;
    try {
      if (snapshot.querySelector(selectorFactory(value))) return `fingerprint_attribute:${label}`;
    } catch {
      // Ignore invalid selector fragments and continue.
    }
  }

  const targetText = normalizeText(fingerprint.textExcerpt || '');
  if (targetText) {
    try {
      const tagName = fingerprint.tagName?.toLowerCase() || '*';
      const candidates = Array.from(snapshot.querySelectorAll(tagName));
      const textMatch = candidates.some(candidate => {
        if (!isSnapshotDomVisibleElement(candidate)) return false;
        return textSignalsFromElement(candidate).some(signal => signal.includes(targetText));
      });
      if (textMatch) return 'fingerprint_text';
    } catch {
      // Ignore selector errors and continue.
    }
  }

  if (fingerprint.parentSelector && isLikelyCssSelector(fingerprint.parentSelector)) {
    try {
      if (snapshot.querySelector(fingerprint.parentSelector)) return 'parent_context';
    } catch {
      // Ignore selector errors and continue.
    }
  }

  const stepFamily = inferStepControlFamily(step);
  if (stepFamily !== 'generic-container') {
    try {
      const all = Array.from(snapshot.querySelectorAll('*'));
      const familyMatch = all.some(element => inferElementControlFamily(element) === stepFamily);
      if (familyMatch) return 'control_family';
    } catch {
      // Ignore selector errors and continue.
    }
  }

  return null;
}

function deriveBaseConfidence(candidate: SnapshotCandidateOption, mode: SnapshotSelectionMode): number {
  if (typeof candidate.confidenceScore === 'number') return candidate.confidenceScore;
  switch (candidate.source) {
    case 'event-local-pageState':
      return mode === 'action' ? 1.0 : 0.55;
    case 'event-local-pageSnapshot':
      return mode === 'action' ? 0.98 : 0.52;
    case 'source-node-snapshot':
      return 0.92;
    case 'interaction-context-exact':
      return mode === 'outcome' ? 0.95 : 0.55;
    case 'interaction-context-stable-by-url':
      return mode === 'outcome' ? 0.9 : 0.45;
    case 'interaction-context-any-by-url':
      return mode === 'outcome' ? 0.85 : 0.4;
    case 'outcome-event-snapshot':
      return 0.82;
    case 'destination-node-snapshot':
      return 0.78;
    case 'url-event-fallback':
      return 0.25;
    default:
      return 0.1;
  }
}

function createTraceEntry(
  candidate: SnapshotCandidateOption,
  overrides: Partial<SnapshotCandidateTraceEntry> = {}
): SnapshotCandidateTraceEntry {
  return {
    source: candidate.source,
    temporalClass: candidate.temporalClass,
    selected: false,
    eventId: candidate.eventId ?? candidate.handle?.eventId,
    sourceNodeId: candidate.sourceNodeId ?? candidate.handle?.sourceNodeId,
    timestamp: candidate.timestamp ?? candidate.handle?.timestamp,
    confidenceScore: candidate.confidenceScore ?? candidate.handle?.confidenceScore,
    ...overrides,
  };
}

function createUnavailableResult(
  evaluatedCandidates: SnapshotCandidateTraceEntry[]
): SnapshotSelectionResult {
  return {
    snapshot: null,
    provenance: {
      source: 'unavailable',
      temporalClass: 'unknown',
      reason: SNAPSHOT_SELECTION_REASONS.SELECTED_UNAVAILABLE_NO_SNAPSHOT_FOUND,
      confidenceScore: 0,
    },
    evaluatedCandidates,
  };
}

function buildActionCandidates(step: CodegenStep, inventory: SnapshotInventory): SnapshotCandidateOption[] {
  const candidates: SnapshotCandidateOption[] = [];

  if (!step.eventId) {
    console.error('event_local_unavailable_missing_eventId', {
      step: step.step,
      traceId: step.traceId ?? null,
      sourceNodeId: step.sourceNodeId ?? null,
    });
    candidates.push({
      source: 'event-local-pageState',
      temporalClass: 'action_local',
      reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_EVENT_LOCAL_PAGE_STATE_BY_EVENT_ID,
      skipReasonIfMissing: SNAPSHOT_SKIP_REASONS.EVENT_LOCAL_UNAVAILABLE_MISSING_EVENT_ID,
      confidenceScore: 0,
    });
    candidates.push({
      source: 'event-local-pageSnapshot',
      temporalClass: 'action_local',
      reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_EVENT_LOCAL_PAGE_SNAPSHOT_BY_EVENT_ID,
      skipReasonIfMissing: SNAPSHOT_SKIP_REASONS.EVENT_LOCAL_UNAVAILABLE_MISSING_EVENT_ID,
      confidenceScore: 0,
    });
  } else {
    const handles = inventory.eventLocalByEventId.get(step.eventId);
    candidates.push({
      source: 'event-local-pageState',
      temporalClass: 'action_local',
      reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_EVENT_LOCAL_PAGE_STATE_BY_EVENT_ID,
      skipReasonIfMissing: SNAPSHOT_SKIP_REASONS.EVENT_LOCAL_PAGE_STATE_MISSING,
      handle: handles?.pageState,
      eventId: step.eventId,
    });
    candidates.push({
      source: 'event-local-pageSnapshot',
      temporalClass: 'action_local',
      reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_EVENT_LOCAL_PAGE_SNAPSHOT_BY_EVENT_ID,
      skipReasonIfMissing: SNAPSHOT_SKIP_REASONS.EVENT_LOCAL_PAGE_SNAPSHOT_MISSING,
      handle: handles?.pageSnapshot,
      eventId: step.eventId,
    });
  }

  candidates.push({
    source: 'source-node-snapshot',
    temporalClass: 'pre_action',
    reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_SOURCE_NODE_SNAPSHOT_AFTER_EVENT_LOCAL_MISSING,
    skipReasonIfMissing: SNAPSHOT_SKIP_REASONS.SOURCE_NODE_SNAPSHOT_MISSING,
    handle: step.sourceNodeId ? inventory.sourceNodeById.get(step.sourceNodeId) : undefined,
    sourceNodeId: step.sourceNodeId,
  });

  if (!step.normalizedUrl) {
    candidates.push({
      source: 'interaction-context-exact',
      temporalClass: 'post_action',
      reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_IC_EXACT_FOR_ACTION_FALLBACK,
      skipReasonIfMissing: SNAPSHOT_SKIP_REASONS.NORMALIZED_URL_MISSING,
    });
  } else if (!step.controlSignature) {
    candidates.push({
      source: 'interaction-context-exact',
      temporalClass: 'post_action',
      reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_IC_EXACT_FOR_ACTION_FALLBACK,
      skipReasonIfMissing: SNAPSHOT_SKIP_REASONS.EXACT_IC_SKIPPED_MISSING_CONTROL_SIGNATURE,
    });
  } else {
    const exactKey = buildIcKey(step.normalizedUrl, step.controlSignature);
    candidates.push({
      source: 'interaction-context-exact',
      temporalClass: 'post_action',
      reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_IC_EXACT_FOR_ACTION_FALLBACK,
      skipReasonIfMissing: SNAPSHOT_SKIP_REASONS.INTERACTION_CONTEXT_EXACT_MISSING,
      handle: inventory.interactionContextExactAny.get(exactKey),
    });
  }

  candidates.push({
    source: 'interaction-context-stable-by-url',
    temporalClass: 'post_action',
    reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_IC_STABLE_BY_URL_FOR_ACTION_FALLBACK,
    skipReasonIfMissing: step.normalizedUrl
      ? SNAPSHOT_SKIP_REASONS.INTERACTION_CONTEXT_STABLE_BY_URL_MISSING
      : SNAPSHOT_SKIP_REASONS.NORMALIZED_URL_MISSING,
    handle: step.normalizedUrl ? inventory.interactionContextStableByUrl.get(step.normalizedUrl) : undefined,
  });

  candidates.push({
    source: 'url-event-fallback',
    temporalClass: 'unknown',
    reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_URL_EVENT_FALLBACK_LAST_RESORT,
    skipReasonIfMissing: step.normalizedUrl
      ? SNAPSHOT_SKIP_REASONS.URL_EVENT_FALLBACK_MISSING
      : SNAPSHOT_SKIP_REASONS.NORMALIZED_URL_MISSING,
    handle: step.normalizedUrl ? inventory.urlEventFallbackByNormalizedUrl.get(step.normalizedUrl) : undefined,
  });

  return candidates;
}

function buildOutcomeCandidates(step: CodegenStep, inventory: SnapshotInventory): SnapshotCandidateOption[] {
  const candidates: SnapshotCandidateOption[] = [];

  if (step.normalizedUrl && step.controlSignature) {
    const exactKey = buildIcKey(step.normalizedUrl, step.controlSignature);
    candidates.push({
      source: 'interaction-context-exact',
      temporalClass: 'outcome_state',
      reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_IC_EXACT_STABLE_FOR_OUTCOME_STATE,
      skipReasonIfMissing: SNAPSHOT_SKIP_REASONS.INTERACTION_CONTEXT_EXACT_MISSING,
      handle: inventory.interactionContextExactStable.get(exactKey),
    });
    candidates.push({
      source: 'interaction-context-exact',
      temporalClass: 'outcome_state',
      reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_IC_EXACT_FOR_OUTCOME_STATE,
      skipReasonIfMissing: SNAPSHOT_SKIP_REASONS.INTERACTION_CONTEXT_EXACT_MISSING,
      handle: inventory.interactionContextExactAny.get(exactKey),
    });
  } else {
    candidates.push({
      source: 'interaction-context-exact',
      temporalClass: 'outcome_state',
      reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_IC_EXACT_STABLE_FOR_OUTCOME_STATE,
      skipReasonIfMissing: !step.normalizedUrl
        ? SNAPSHOT_SKIP_REASONS.NORMALIZED_URL_MISSING
        : SNAPSHOT_SKIP_REASONS.EXACT_IC_SKIPPED_MISSING_CONTROL_SIGNATURE,
    });
    candidates.push({
      source: 'interaction-context-exact',
      temporalClass: 'outcome_state',
      reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_IC_EXACT_FOR_OUTCOME_STATE,
      skipReasonIfMissing: !step.normalizedUrl
        ? SNAPSHOT_SKIP_REASONS.NORMALIZED_URL_MISSING
        : SNAPSHOT_SKIP_REASONS.EXACT_IC_SKIPPED_MISSING_CONTROL_SIGNATURE,
    });
  }

  candidates.push({
    source: 'outcome-event-snapshot',
    temporalClass: 'outcome_state',
    reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_OUTCOME_EVENT_SNAPSHOT,
    skipReasonIfMissing: step.traceId
      ? SNAPSHOT_SKIP_REASONS.OUTCOME_EVENT_SNAPSHOT_MISSING
      : SNAPSHOT_SKIP_REASONS.EVENT_LOCAL_UNAVAILABLE_MISSING_EVENT_ID,
    handle: step.traceId ? inventory.outcomeEventByTraceId.get(step.traceId) : undefined,
    eventId: step.eventId,
  });

  candidates.push({
    source: 'destination-node-snapshot',
    temporalClass: 'outcome_state',
    reasonIfSelected: SNAPSHOT_SELECTION_REASONS.SELECTED_DESTINATION_NODE_SNAPSHOT_AFTER_OUTCOME_MISSING,
    skipReasonIfMissing: SNAPSHOT_SKIP_REASONS.DESTINATION_NODE_SNAPSHOT_MISSING,
    handle: step.destinationNodeId ? inventory.destinationNodeById.get(step.destinationNodeId) : undefined,
    sourceNodeId: step.destinationNodeId,
  });

  return candidates;
}

function evaluateTargetPresence(
  step: CodegenStep,
  candidate: SnapshotCandidateOption,
  snapshot: Document,
  mode: SnapshotSelectionMode
) : { targetPresent?: boolean; skipReason?: string; confidenceScore?: number; shadowDegraded?: boolean; evidenceReason?: string | null } {
  const destructive = isDestructiveAction(step);
  const cheapPresence = trySelectorPresence(step, snapshot);
  if (cheapPresence === true) {
    return { targetPresent: true, evidenceReason: 'selector_match' };
  }

  const runExpensive = shouldRunExpensivePresenceValidation(step, candidate, mode);
  const evidenceReason = runExpensive ? findTargetEvidence(step, snapshot) : null;
  const expensivePresence = !!evidenceReason;
  const targetPresent = cheapPresence === false ? expensivePresence : cheapPresence ?? expensivePresence;

  const probableClosedShadow =
    step.nestedContext?.degradedReason === 'probable_closed_shadow_host';
  if (!targetPresent && probableClosedShadow) {
    return {
      targetPresent: false,
      skipReason: SNAPSHOT_SKIP_REASONS.CLOSED_SHADOW_DOM_UNOBSERVABLE,
      shadowDegraded: true,
      confidenceScore: destructive ? 0 : 0.2,
      evidenceReason: null,
    };
  }

  if (!targetPresent && step.nestedContext?.isShadowDom) {
    return {
      targetPresent: false,
      skipReason: SNAPSHOT_SKIP_REASONS.SHADOW_DOM_NOT_SERIALIZED,
      shadowDegraded: true,
      confidenceScore: destructive ? 0 : 0.25,
      evidenceReason: null,
    };
  }

  if (!targetPresent) {
    return {
      targetPresent: false,
      skipReason: SNAPSHOT_SKIP_REASONS.TARGET_MISSING_IN_SNAPSHOT,
      confidenceScore: destructive ? 0 : 0.35,
      evidenceReason: null,
    };
  }

  return { targetPresent: true, evidenceReason: evidenceReason ?? 'selector_match' };
}

function selectFromCandidates(
  step: CodegenStep,
  candidates: SnapshotCandidateOption[],
  inventory: SnapshotInventory,
  mode: SnapshotSelectionMode
): SnapshotSelectionResult {
  const evaluatedCandidates: SnapshotCandidateTraceEntry[] = [];
  let selectedSnapshot: Document | null = null;
  let selectedCandidate: SnapshotCandidateOption | null = null;
  let selectedConfidence = 0;
  let selectedLabelEvidence: LabelStructureEvidence = {
    active: false,
    evidence: false,
    score: 0,
    reason: null,
    blockedReason: null,
  };
  const weakLabelFallback = mode === 'action' && isWeakLabelContextFallbackCandidate(step);
  let targetMissingFallback:
    | {
      snapshot: Document;
      candidate: SnapshotCandidateOption;
      confidenceScore: number;
      evidenceReason: string | null;
      labelEvidence: LabelStructureEvidence;
      traceIndex: number;
    }
    | null = null;

  for (const candidate of candidates) {
    if (selectedCandidate && !weakLabelFallback) {
      evaluatedCandidates.push(
        createTraceEntry(candidate, {
          skipReason: SNAPSHOT_SKIP_REASONS.HIGHER_PRIORITY_CANDIDATE_ALREADY_SELECTED,
          confidenceScore: deriveBaseConfidence(candidate, mode),
        })
      );
      continue;
    }

    if (!candidate.handle) {
      evaluatedCandidates.push(
        createTraceEntry(candidate, {
          skipReason: candidate.skipReasonIfMissing,
          confidenceScore: deriveBaseConfidence(candidate, mode),
        })
      );
      continue;
    }

    const snapshot = candidate.handle.load();
    if (!snapshot) {
      evaluatedCandidates.push(
        createTraceEntry(candidate, {
          skipReason: SNAPSHOT_SKIP_REASONS.SNAPSHOT_PARSE_FAILED,
          confidenceScore: deriveBaseConfidence(candidate, mode),
        })
      );
      continue;
    }

    let confidenceScore = deriveBaseConfidence(candidate, mode);
    const icStateEvaluation = evaluateInteractionContextState(step, candidate, inventory, mode);
    if (icStateEvaluation.confidenceScore !== undefined) {
      confidenceScore = Math.min(confidenceScore, icStateEvaluation.confidenceScore);
    }
    if (icStateEvaluation.skipReason) {
      evaluatedCandidates.push(
        createTraceEntry(candidate, {
          skipReason: icStateEvaluation.skipReason,
          confidenceScore,
        })
      );
      continue;
    }

    const icTabUnknown =
      isInteractionContextSource(candidate.source) &&
      !!step.tabId &&
      !candidate.handle.tabId;

    if (mode === 'outcome') {
      evaluatedCandidates.push(
        createTraceEntry(candidate, {
          selected: true,
          reason: candidate.reasonIfSelected,
          confidenceScore,
          skipReason: icStateEvaluation.annotationReason
            ?? (icTabUnknown ? SNAPSHOT_SKIP_REASONS.IC_TAB_UNKNOWN : undefined),
        })
      );
      selectedSnapshot = snapshot;
      selectedCandidate = candidate;
      selectedConfidence = confidenceScore;
      continue;
    }

    const targetEvaluation = evaluateTargetPresence(step, candidate, snapshot, mode);
    const destructive = isDestructiveAction(step);
    const labelEvidence = weakLabelFallback
      ? findLabelStructureEvidence(step, snapshot)
      : {
          active: false,
          evidence: false,
          score: 0,
          reason: null,
          blockedReason: null,
        };
    if (targetEvaluation.confidenceScore !== undefined) {
      confidenceScore = Math.min(confidenceScore, targetEvaluation.confidenceScore);
    }

    if (targetEvaluation.skipReason && destructive) {
      evaluatedCandidates.push(
        createTraceEntry(candidate, {
          skipReason: targetEvaluation.skipReason,
          confidenceScore,
          targetPresent: targetEvaluation.targetPresent,
          shadowDegraded: targetEvaluation.shadowDegraded,
          labelStructureEvidence: labelEvidence.evidence,
          labelStructureEvidenceReason: labelEvidenceReason(labelEvidence),
        })
      );
      continue;
    }

    if (targetEvaluation.skipReason && !destructive) {
      const traceIndex = evaluatedCandidates.push(
        createTraceEntry(candidate, {
          selected: false,
          confidenceScore,
          targetPresent: targetEvaluation.targetPresent,
          snapshotTargetEvidenceReason: targetEvaluation.evidenceReason ?? targetEvaluation.skipReason ?? null,
          shadowDegraded: targetEvaluation.shadowDegraded,
          skipReason: targetEvaluation.skipReason,
          labelStructureEvidence: labelEvidence.evidence,
          labelStructureEvidenceReason: labelEvidenceReason(labelEvidence),
        })
      ) - 1;
      if (!targetMissingFallback) {
        targetMissingFallback = {
          snapshot,
          candidate,
          confidenceScore,
          evidenceReason: targetEvaluation.evidenceReason ?? targetEvaluation.skipReason ?? null,
          labelEvidence,
          traceIndex,
        };
      }
      continue;
    }

    const traceEntry = createTraceEntry(candidate, {
      selected: true,
      reason: candidate.reasonIfSelected,
      confidenceScore,
      targetPresent: true,
      snapshotTargetEvidenceReason: targetEvaluation.evidenceReason ?? 'selector_match',
      skipReason: icStateEvaluation.annotationReason
        ?? (icTabUnknown ? SNAPSHOT_SKIP_REASONS.IC_TAB_UNKNOWN : undefined),
      labelStructureEvidence: labelEvidence.evidence,
      labelStructureEvidenceReason: labelEvidenceReason(labelEvidence),
    });

    if (!weakLabelFallback) {
      evaluatedCandidates.push(traceEntry);
      selectedSnapshot = snapshot;
      selectedCandidate = candidate;
      selectedConfidence = confidenceScore;
      selectedLabelEvidence = labelEvidence;
      continue;
    }

    const candidateIndex = evaluatedCandidates.push(traceEntry) - 1;
    const shouldReplace =
      !selectedCandidate
      || (
        labelEvidence.evidence
        && !selectedLabelEvidence.evidence
      )
      || (
        labelEvidence.evidence
        && selectedLabelEvidence.evidence
        && (
          labelEvidence.score > selectedLabelEvidence.score
          || (
            labelEvidence.score === selectedLabelEvidence.score
            && confidenceScore > selectedConfidence
          )
        )
      );

    if (shouldReplace) {
      if (selectedCandidate) {
        const previousIndex = evaluatedCandidates.findIndex(entry =>
          entry.selected
          && entry.source === selectedCandidate?.source
          && entry.temporalClass === selectedCandidate?.temporalClass,
        );
        if (previousIndex >= 0) {
          evaluatedCandidates[previousIndex] = {
            ...evaluatedCandidates[previousIndex],
            selected: false,
            reason: undefined,
            skipReason: SNAPSHOT_SKIP_REASONS.HIGHER_PRIORITY_CANDIDATE_ALREADY_SELECTED,
          };
        }
      }
      evaluatedCandidates[candidateIndex] = {
        ...evaluatedCandidates[candidateIndex],
        selected: true,
        reason: candidate.reasonIfSelected,
      };
      selectedSnapshot = snapshot;
      selectedCandidate = candidate;
      selectedConfidence = confidenceScore;
      selectedLabelEvidence = labelEvidence;
    } else {
      evaluatedCandidates[candidateIndex] = {
        ...evaluatedCandidates[candidateIndex],
        selected: false,
        reason: undefined,
        skipReason: SNAPSHOT_SKIP_REASONS.HIGHER_PRIORITY_CANDIDATE_ALREADY_SELECTED,
      };
    }
  }

  if (!selectedCandidate && targetMissingFallback) {
    selectedSnapshot = targetMissingFallback.snapshot;
    selectedCandidate = targetMissingFallback.candidate;
    selectedConfidence = targetMissingFallback.confidenceScore;
    selectedLabelEvidence = targetMissingFallback.labelEvidence;
    evaluatedCandidates[targetMissingFallback.traceIndex] = {
      ...evaluatedCandidates[targetMissingFallback.traceIndex],
      selected: true,
      reason: targetMissingFallback.candidate.reasonIfSelected,
    };
  }

  if (!selectedCandidate) {
    return createUnavailableResult(evaluatedCandidates);
  }

  const provenance: SnapshotSelectionProvenance = {
    source: selectedCandidate.source,
    temporalClass: selectedCandidate.temporalClass,
    reason: selectedCandidate.reasonIfSelected,
    eventId: selectedCandidate.eventId ?? selectedCandidate.handle?.eventId,
    sourceNodeId: selectedCandidate.sourceNodeId ?? selectedCandidate.handle?.sourceNodeId,
    timestamp: selectedCandidate.timestamp ?? selectedCandidate.handle?.timestamp,
    confidenceScore: selectedConfidence,
    snapshotTargetEvidence: evaluatedCandidates.find(entry =>
      entry.selected &&
      entry.source === selectedCandidate?.source &&
      entry.temporalClass === selectedCandidate?.temporalClass,
    )?.targetPresent,
    snapshotTargetEvidenceReason: evaluatedCandidates.find(entry =>
      entry.selected &&
      entry.source === selectedCandidate?.source &&
      entry.temporalClass === selectedCandidate?.temporalClass,
    )?.snapshotTargetEvidenceReason ?? null,
    labelStructureEvidence: weakLabelFallback ? selectedLabelEvidence.evidence : undefined,
    labelStructureEvidenceReason: weakLabelFallback
      ? labelEvidenceReason(selectedLabelEvidence)
      : undefined,
    labelContextSnapshotSource: weakLabelFallback && selectedLabelEvidence.evidence
      ? selectedCandidate.source
      : null,
    labelContextBlockedReason: weakLabelFallback && !selectedLabelEvidence.evidence
      ? selectedLabelEvidence.blockedReason
      : null,
  };

  return {
    snapshot: selectedSnapshot,
    provenance,
    evaluatedCandidates,
  };
}

export function selectSnapshotForAction(
  step: CodegenStep,
  inventory: SnapshotInventory
): SnapshotSelectionResult {
  return selectFromCandidates(step, buildActionCandidates(step, inventory), inventory, 'action');
}

export function selectSnapshotForOutcome(
  step: CodegenStep,
  inventory: SnapshotInventory
): SnapshotSelectionResult {
  return selectFromCandidates(step, buildOutcomeCandidates(step, inventory), inventory, 'outcome');
}

export function selectSnapshotForStep(
  step: CodegenStep,
  inventory: SnapshotInventory,
  mode: SnapshotSelectionMode = 'action'
): SnapshotSelectionResult {
  if (mode === 'outcome') {
    return selectSnapshotForOutcome(step, inventory);
  }
  return selectSnapshotForAction(step, inventory);
}
