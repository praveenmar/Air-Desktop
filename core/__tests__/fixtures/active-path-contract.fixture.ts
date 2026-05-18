import type { ResolverMetadata } from '../../../packages/codegen/src/types';

export const ACTIVE_PATH_SESSION_ID = 'session-11111111-1111-4111-8111-111111111111';
export const ACTIVE_PATH_TRACE_ID = 'trace-active-contract-1';
export const ACTIVE_PATH_TAB_ID = 'tab-active-contract';

export function buildRawActivePathSnapshot() {
  return {
    html: `
      <html>
        <body>
          <main id="profile-shell">
            <form id="profile-form" data-testid="profile-form">
              <label for="displayName">Display Name</label>
              <input
                id="displayName"
                name="displayName"
                value="Ada Lovelace"
                aria-label="Display Name"
                data-testid="display-name"
                data-cy="display-name"
                data-qa="display-name"
                class="field-input field-input--primary profile-name"
                type="text"
                title="Display Name"
              />
              <a
                href="https://app.test/profile/help"
                class="help-link help-link--inline"
                title="Profile Help"
              >Help</a>
              <button
                data-air-node-id="air-node-1"
                type="submit"
                value="Save"
                title="Save Profile"
                aria-label="Save Profile"
                data-testid="save-profile"
                data-cy="save-profile"
                data-qa="save-profile"
                class="btn btn-primary profile-save"
              >
                <img alt="Save Icon" src="/icons/save.svg" />
                Save Profile
              </button>
            </form>
          </main>
        </body>
      </html>
    `.replace(/\s+/g, ' ').trim(),
    anchors: [
      'URL:/profile',
      'FORM:id=profile-form',
      'BUTTON:text=Save Profile',
    ],
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
        confidence: 0.94,
      },
    ],
    controlSignature: 'sig-profile-save',
    normalizedUrl: 'https://app.test/profile',
    isStable: true,
    viewport: { width: 1440, height: 900 },
    url: 'https://app.test/profile?tab=details',
    timestamp: 1_700_000_100_000,
    snapshotBuildId: 'snapshot-build-42',
    metrics: {
      anchorScanTotalMs: 18.4,
      flatScanMs: 5.1,
      compositeScanMs: 8.9,
      repeatedScanCount: 2,
      finalCompositeCount: 1,
      droppedCompositeCount: 0,
      snapshotBuildId: 'snapshot-build-42',
    },
  };
}

export function buildActivePathClickEvent(normalizedSnapshot: Record<string, unknown>) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'click',
    timestamp: 1_700_000_100_100,
    traceId: ACTIVE_PATH_TRACE_ID,
    sessionId: ACTIVE_PATH_SESSION_ID,
    tabId: ACTIVE_PATH_TAB_ID,
    pageUrl: 'https://app.test/profile?tab=details',
    normalizedUrl: 'https://app.test/profile',
    pageTitle: 'Profile Settings',
    viewport: { width: 1440, height: 900 },
    schemaVersion: 'air:v2',
    nestedContext: {
      isShadowDom: true,
      shadowHostTag: 'profile-shell',
      degraded: true,
      degradedReason: 'probable_closed_shadow_host',
      captureHint: 'shadow-fallback',
    },
    fingerprint: {
      selector: '[data-testid="save-profile"]',
      selectorPriority: 'data-testid',
      selectorRank: 1,
      tagName: 'button',
      parentSelector: '#profile-form',
      textExcerpt: 'Save Profile',
      context: {
        parentTag: 'form',
        nearestContainerTag: 'main',
      },
      attributes: {
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
          warningCodes: ['recorded-primary'],
        },
        {
          selector: 'button[aria-label="Save Profile"]',
          engine: 'css',
          family: 'aria-label',
          strength: 'medium',
          source: 'capture',
          matchCount: 1,
          visibleMatchCount: 1,
        },
      ],
      targetNodeId: 'air-node-1',
      targetIdentitySource: 'pageSnapshot',
      targetIdentityStatus: 'emitted',
      attributesHash: 'fingerprint-hash-profile-save',
    },
    meta: {
      stateCapture: true,
      snapshotDepth: 10,
    },
    pageSnapshot: normalizedSnapshot,
    pageState: normalizedSnapshot,
  };
}

export function buildActivePathOutcomeEvent(normalizedSnapshot: Record<string, unknown>) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    type: 'outcome',
    timestamp: 1_700_000_100_500,
    traceId: ACTIVE_PATH_TRACE_ID,
    sessionId: ACTIVE_PATH_SESSION_ID,
    tabId: ACTIVE_PATH_TAB_ID,
    pageUrl: 'https://app.test/profile?tab=details',
    normalizedUrl: 'https://app.test/profile',
    schemaVersion: 'air:v2',
    pageSnapshot: normalizedSnapshot,
    pageState: normalizedSnapshot,
    interactionContext: normalizedSnapshot,
    meta: {
      settleType: {
        stable: true,
        reason: 'ready',
        waitedMs: 75,
      },
      waitedMs: 75,
      urlAfter: 'https://app.test/profile?tab=details',
      titleAfter: 'Profile Settings',
      controlSignature: 'sig-profile-save',
    },
  };
}

export function buildSprint5ResolverMetadata(): ResolverMetadata {
  return {
    resolvedSelector: '[data-testid="save-profile"]',
    resolvedBy: 'blocked-semantic-mismatch',
    bestScore: 0.72,
    effectiveMatchCount: 1,
    matchCount: 1,
    confidenceScore: 0.72,
    ambiguityReason: null,
    snapshotSource: 'interaction-context-exact',
    validationMethod: 'css-query-static-visibility-element-ranking-v1',
    llmAttempted: false,
    llmAccepted: false,
    llmAlternative: null,
    rejectReason: 'href_mismatch',
    semanticRejectReason: 'href_mismatch',
    rejectedCandidates: [
      {
        selector: 'a.help-link',
        reason: 'href_mismatch',
      },
    ],
    semanticCompatibilityScore: 0.41,
    semanticCompatibilityReasons: ['href mismatch against saved fingerprint'],
    idEntropyScore: 0.18,
    idPenaltyReason: ['id missing'],
    classEntropyScore: 0.36,
    classPenaltyReason: ['class names reused across sibling controls'],
    warningCodes: ['deterministic-semantic-reject'],
    resolverVersion: 1,
    temporalClass: 'post_action',
    selectionReason: 'selected_ic_exact_for_action_fallback',
    snapshotSelection: {
      source: 'interaction-context-exact',
      temporalClass: 'post_action',
      reason: 'selected_ic_exact_for_action_fallback',
      eventId: '11111111-1111-4111-8111-111111111111',
      sourceNodeId: 'node-profile',
      confidenceScore: 0.91,
      snapshotTargetEvidence: true,
      snapshotTargetEvidenceReason: 'fingerprint_attribute:data-testid',
    },
    evaluatedCandidates: [
      {
        source: 'interaction-context-exact',
        temporalClass: 'post_action',
        selected: true,
        reason: 'selected_ic_exact_for_action_fallback',
        eventId: '11111111-1111-4111-8111-111111111111',
        sourceNodeId: 'node-profile',
        confidenceScore: 0.91,
        targetPresent: true,
        snapshotTargetEvidenceReason: 'fingerprint_attribute:data-testid',
      },
    ],
    snapshotTargetEvidence: true,
    snapshotTargetEvidenceReason: 'fingerprint_attribute:data-testid',
    excerptBuildTotalMs: 4,
    pruneMs: 1,
    redactMs: 1,
    finalExcerptChars: 420,
  };
}
