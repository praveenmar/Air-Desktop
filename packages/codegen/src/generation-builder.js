"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveGenerationContext = deriveGenerationContext;
const runtime_schemas_1 = require("./runtime-schemas");
/**
 * Phase 3C: Pure GenerationContext Builder
 *
 * Derives a pristine GenerationContextV1 from an internal CodegenSession
 * and lightweight event metadata.
 *
 * Does NOT query the DB, load HTML snapshots, or interact with heavy services.
 * Purely deterministic transformation.
 */
function deriveGenerationContext(input) {
    const { session, eventsById } = input;
    // Handle recordedAt safely
    let recordedAt = Date.now();
    if (typeof session.recordedAt === 'number') {
        recordedAt = session.recordedAt;
    }
    else if (typeof session.recordedAt === 'string') {
        const parsed = Date.parse(session.recordedAt);
        if (!isNaN(parsed)) {
            recordedAt = parsed;
        }
    }
    const steps = session.steps.map((step, index) => {
        const metadata = step.eventId ? eventsById.get(step.eventId) : undefined;
        const selectorResolution = metadata?.selectorResolution;
        const nextStep = session.steps[index + 1];
        const isTargetNeeded = actionNeedsTarget(step.action, step);
        let locatorStatus = 'not_applicable';
        let resolvedTarget = undefined;
        let fallbackHints = undefined;
        if (isTargetNeeded) {
            if (selectorResolution &&
                selectorResolution.status === 'resolved' &&
                selectorResolution.selected &&
                selectorResolution.selected.replaySafe === true &&
                typeof selectorResolution.selected.selector === 'string' &&
                selectorResolution.selected.selector.trim().length > 0 &&
                (selectorResolution.selected.engine === 'css' || selectorResolution.selected.engine === 'xpath')) {
                locatorStatus = 'resolved';
                resolvedTarget = {
                    kind: selectorResolution.selected.engine,
                    value: selectorResolution.selected.selector,
                    source: 'selectorResolution',
                    replaySafe: true,
                };
            }
            else {
                locatorStatus = 'unresolved';
                // Build fallback hints
                const legacySelector = metadata?.fallbackHints?.legacySelector ?? step.selector;
                const elementText = metadata?.fallbackHints?.elementText ?? step.fingerprint?.textExcerpt;
                const tagName = metadata?.fallbackHints?.tagName ?? step.fingerprint?.tagName;
                const hints = {};
                if (legacySelector)
                    hints.legacySelector = legacySelector;
                if (elementText)
                    hints.elementText = elementText;
                if (tagName)
                    hints.tagName = tagName;
                if (Object.keys(hints).length > 0) {
                    fallbackHints = hints;
                }
            }
        }
        const assertions = (step.assertions || [])
            .filter((assertion) => !shouldDropConflictingOutcomeUrlAssertion(assertion, nextStep))
            .map(mapAssertion);
        const mappedStep = {
            stepIndex: step.step,
            eventId: step.eventId,
            traceId: step.traceId,
            action: step.action,
            intent: step.intent,
            value: step.value,
            locatorStatus,
            resolvedTarget,
            fallbackHints,
            selectorResolution,
            assertions,
            pageUrl: step.pageUrl,
            normalizedUrl: step.normalizedUrl,
            outcomeType: step.outcomeType,
            confidence: step.confidence,
        };
        return stripUndefined(mappedStep);
    });
    const context = {
        schemaVersion: "air:generation-context:v1",
        sessionId: session.sessionId,
        url: session.url,
        recordedAt,
        steps,
        metadata: {
            generatedAt: Date.now(),
            source: "air-db"
        }
    };
    return runtime_schemas_1.GenerationContextSchemaV1.parse(context);
}
/**
 * Type-safe helper to deeply or shallowly strip undefined fields
 */
function stripUndefined(obj) {
    const result = { ...obj };
    for (const key of Object.keys(result)) {
        if (result[key] === undefined) {
            delete result[key];
        }
    }
    return result;
}
/**
 * Determines whether an action inherently needs a targeted element locator.
 */
function actionNeedsTarget(action, step) {
    if (['click', 'input', 'submit', 'custom-control-open', 'custom-select', 'custom-menu-select', 'hover'].includes(action)) {
        return true;
    }
    if (action === 'scroll') {
        return !!step?.selector;
    }
    if (action === 'navigate') {
        return false;
    }
    // Default to true for any unknown/future actions to avoid hiding unresolved target problems
    return true;
}
/**
 * Maps internal assertions to the public generation contract shape.
 */
function mapAssertion(assertion) {
    let type = 'custom';
    if (['url', 'element_visible', 'element_text', 'title', 'custom'].includes(assertion.type)) {
        type = assertion.type;
    }
    let source = undefined;
    if (assertion.source) {
        if (['url', 'url_change', 'navigation', 'outcome'].includes(assertion.source)) {
            source = 'outcome';
        }
        else if (assertion.source === 'anchor') {
            source = 'anchor';
        }
        else if (assertion.source === 'user_defined') {
            source = 'user_defined';
        }
        else {
            source = 'anchor'; // Safe default per requirements
        }
    }
    const mapped = {
        type,
        value: assertion.value,
        selector: assertion.selector,
        confidence: assertion.confidence,
        source,
    };
    return stripUndefined(mapped);
}
function shouldDropConflictingOutcomeUrlAssertion(assertion, nextStep) {
    if (assertion.type !== 'url')
        return false;
    if (assertion.source !== 'outcome')
        return false;
    if (!nextStep)
        return false;
    const nextPageUrl = typeof nextStep.pageUrl === 'string' ? nextStep.pageUrl : '';
    const nextNormalizedUrl = typeof nextStep.normalizedUrl === 'string' ? nextStep.normalizedUrl : '';
    if (!nextPageUrl && !nextNormalizedUrl)
        return false;
    return urlsClearlyConflict(assertion.value, nextPageUrl, nextNormalizedUrl);
}
function urlsClearlyConflict(assertionUrl, nextPageUrl, nextNormalizedUrl) {
    const assertionTrimmed = assertionUrl.trim();
    const nextPageTrimmed = (nextPageUrl ?? '').trim();
    const nextNormalizedTrimmed = (nextNormalizedUrl ?? '').trim();
    if (!assertionTrimmed || (!nextPageTrimmed && !nextNormalizedTrimmed)) {
        return false;
    }
    if (assertionTrimmed === nextPageTrimmed || assertionTrimmed === nextNormalizedTrimmed) {
        return false;
    }
    const parsedAssertion = tryParseUrl(assertionTrimmed);
    const parsedNextPage = tryParseUrl(nextPageTrimmed);
    const parsedNextNormalized = tryParseUrl(nextNormalizedTrimmed);
    if (parsedAssertion && parsedNextPage && urlsMatch(parsedAssertion, parsedNextPage)) {
        return false;
    }
    if (parsedAssertion && parsedNextNormalized && urlsMatch(parsedAssertion, parsedNextNormalized)) {
        return false;
    }
    if (parsedAssertion && (parsedNextPage || parsedNextNormalized)) {
        const comparableNext = parsedNextPage ?? parsedNextNormalized;
        return !urlsMatch(parsedAssertion, comparableNext);
    }
    return false;
}
function urlsMatch(left, right) {
    if (left.href === right.href)
        return true;
    if (left.pathname === right.pathname && left.search === right.search)
        return true;
    return false;
}
function tryParseUrl(value) {
    if (!value)
        return null;
    try {
        return new URL(value);
    }
    catch {
        return null;
    }
}
