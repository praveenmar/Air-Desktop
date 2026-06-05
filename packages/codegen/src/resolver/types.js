"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOM_ORDER_TIEBREAKER_REASON = exports.NON_RENDERED_TAGS = exports.BROAD_SELECTOR_SCORE_LIMIT = exports.BROAD_SELECTOR_MATCH_LIMIT = void 0;
exports.assertionNeedsDomContext = assertionNeedsDomContext;
exports.attachAssertionOutcomeSelections = attachAssertionOutcomeSelections;
exports.BROAD_SELECTOR_MATCH_LIMIT = 50;
exports.BROAD_SELECTOR_SCORE_LIMIT = 15;
exports.NON_RENDERED_TAGS = new Set(['script', 'style', 'template', 'meta', 'link', 'noscript']);
exports.DOM_ORDER_TIEBREAKER_REASON = 'resolved_by_dom_order_tiebreaker';
function assertionNeedsDomContext(assertion) {
    if (assertion.selector && assertion.selector.trim().length > 0) {
        return true;
    }
    return assertion.type === 'element_visible' || assertion.type === 'element_text';
}
function attachAssertionOutcomeSelections(session, snapshotCache) {
    for (const step of session.steps) {
        if (!Array.isArray(step.assertions) || step.assertions.length === 0) {
            continue;
        }
        const eligibleAssertions = step.assertions.filter(assertionNeedsDomContext);
        if (eligibleAssertions.length === 0) {
            continue;
        }
        let selection = null;
        try {
            if (snapshotCache.selectForStep) {
                selection = snapshotCache.selectForStep(step, 'outcome');
            }
        }
        catch (_err) {
            selection = null;
        }
        if (!selection) {
            const nodeId = step.destinationNodeId ?? step.sourceNodeId ?? '';
            const snapshot = snapshotCache.get(nodeId, step.normalizedUrl, step.controlSignature);
            const snapshotSource = snapshotCache.getSource
                ? snapshotCache.getSource(nodeId, step.normalizedUrl, step.controlSignature)
                : (snapshot ? 'latest' : 'unavailable');
            selection = {
                snapshot,
                provenance: {
                    source: snapshotSource,
                    temporalClass: 'unknown',
                    reason: snapshot ? 'legacy_snapshot_cache_selection' : 'legacy_snapshot_cache_unavailable',
                    eventId: step.eventId,
                    sourceNodeId: step.destinationNodeId ?? step.sourceNodeId,
                    confidenceScore: snapshot ? 0.5 : 0,
                },
                evaluatedCandidates: [
                    {
                        source: snapshotSource,
                        temporalClass: 'unknown',
                        selected: !!snapshot,
                        reason: snapshot ? 'legacy_snapshot_cache_selection' : undefined,
                        skipReason: snapshot ? undefined : 'snapshot-unavailable',
                        eventId: step.eventId,
                        sourceNodeId: step.destinationNodeId ?? step.sourceNodeId,
                        confidenceScore: snapshot ? 0.5 : 0,
                    },
                ],
            };
        }
        step.assertions = step.assertions.map(assertion => {
            if (!assertionNeedsDomContext(assertion)) {
                return assertion;
            }
            return {
                ...assertion,
                assertionSnapshotSelection: selection.provenance,
                assertionCandidateTrace: selection.evaluatedCandidates,
                assertionTemporalClass: selection.provenance.temporalClass,
            };
        });
    }
}
