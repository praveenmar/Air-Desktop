"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasFieldIntent = exports.elementLooksInteractive = exports.elementLooksInputLike = void 0;
exports.isVisibleElement = isVisibleElement;
exports.validateCSSCandidate = validateCSSCandidate;
exports.validateTextCandidate = validateTextCandidate;
const types_1 = require("./types");
const text_matching_1 = require("./text-matching");
const element_ranking_1 = require("./element-ranking");
Object.defineProperty(exports, "elementLooksInputLike", { enumerable: true, get: function () { return element_ranking_1.elementLooksInputLike; } });
Object.defineProperty(exports, "elementLooksInteractive", { enumerable: true, get: function () { return element_ranking_1.elementLooksInteractive; } });
Object.defineProperty(exports, "hasFieldIntent", { enumerable: true, get: function () { return element_ranking_1.hasFieldIntent; } });
function isVisibleElement(el) {
    let current = el;
    while (current) {
        const htmlEl = current;
        const tagName = (htmlEl.tagName || '').toLowerCase();
        if (types_1.NON_RENDERED_TAGS.has(tagName))
            return false;
        if (htmlEl.hasAttribute('hidden'))
            return false;
        if ((htmlEl.getAttribute('aria-hidden') || '').toLowerCase() === 'true')
            return false;
        if (tagName === 'input' &&
            (htmlEl.getAttribute('type') || '').toLowerCase() === 'hidden') {
            return false;
        }
        const style = (htmlEl.getAttribute('style') || '')
            .toLowerCase()
            .replace(/\s+/g, '');
        if (style.includes('display:none'))
            return false;
        if (style.includes('visibility:hidden'))
            return false;
        current = htmlEl.parentElement;
    }
    return true;
}
function validateCSSCandidate(selector, snapshot, step, root = snapshot) {
    if (!(0, text_matching_1.isLikelyCssSelector)(selector)) {
        return {
            totalMatchCount: 0,
            visibleMatchCount: 0,
            effectiveMatchCount: 0,
            reason: 'invalid-selector',
        };
    }
    let matches;
    try {
        matches = root.querySelectorAll(selector);
    }
    catch {
        return {
            totalMatchCount: 0,
            visibleMatchCount: 0,
            effectiveMatchCount: 0,
            reason: 'invalid-selector',
        };
    }
    const visibleMatches = Array.from(matches).filter(isVisibleElement);
    if (visibleMatches.length === 0) {
        return {
            totalMatchCount: matches.length,
            visibleMatchCount: 0,
            effectiveMatchCount: 0,
            reason: 'no-visible-match',
            matchCount: 0,
            confidenceScore: 0,
            resolvedElement: null,
        };
    }
    if (visibleMatches.length === 1) {
        return {
            totalMatchCount: matches.length,
            visibleMatchCount: 1,
            effectiveMatchCount: 1,
            reason: 'unique-visible',
            matchCount: 1,
            confidenceScore: 1,
            resolvedElement: visibleMatches[0] ?? null,
        };
    }
    const rankedMatches = (0, element_ranking_1.scoreMatchedElements)(visibleMatches, snapshot, step);
    const winner = rankedMatches[0];
    const runnerUp = rankedMatches[1];
    const ambiguityReason = winner && runnerUp && Math.abs(winner.score - runnerUp.score) < 0.05
        ? types_1.DOM_ORDER_TIEBREAKER_REASON
        : undefined;
    return {
        totalMatchCount: matches.length,
        visibleMatchCount: visibleMatches.length,
        effectiveMatchCount: 1,
        reason: matches.length > types_1.BROAD_SELECTOR_MATCH_LIMIT ? 'too-broad' : 'resolved-multi-match',
        matchCount: visibleMatches.length,
        confidenceScore: ambiguityReason ? Math.min(winner?.score ?? 0, 0.7) : (winner?.score ?? 0),
        ambiguityReason,
        resolvedElement: winner?.element ?? null,
    };
}
function validateTextCandidate(selector, snapshot, step, root = snapshot) {
    const rawSelector = selector.trim();
    let scopeSelector = null;
    let textNeedle = '';
    if (rawSelector.startsWith('text=')) {
        textNeedle = (0, text_matching_1.unquoteTextLiteral)(rawSelector.slice(5).trim());
    }
    else {
        const hasTextMatch = rawSelector.match(/^(.*):has-text\((.*)\)$/);
        if (!hasTextMatch) {
            return {
                totalMatchCount: 0,
                visibleMatchCount: 0,
                effectiveMatchCount: 0,
                reason: 'invalid-selector',
            };
        }
        scopeSelector = hasTextMatch[1]?.trim() || null;
        textNeedle = (0, text_matching_1.unquoteTextLiteral)(hasTextMatch[2]?.trim() || '');
    }
    const normalizedNeedle = (0, text_matching_1.normalizeTextForMatch)(textNeedle);
    if (!normalizedNeedle) {
        return {
            totalMatchCount: 0,
            visibleMatchCount: 0,
            effectiveMatchCount: 0,
            reason: 'invalid-selector',
        };
    }
    let scopeMatches;
    try {
        scopeMatches = scopeSelector
            ? Array.from(root.querySelectorAll(scopeSelector))
            : Array.from(root.querySelectorAll('*'));
    }
    catch {
        return {
            totalMatchCount: 0,
            visibleMatchCount: 0,
            effectiveMatchCount: 0,
            reason: 'invalid-selector',
        };
    }
    const wasTooBroad = scopeMatches.length > types_1.BROAD_SELECTOR_MATCH_LIMIT;
    if (wasTooBroad) {
        const filtered = scopeMatches.filter(element => {
            const signals = (0, text_matching_1.getElementTextSignals)(element).map(text_matching_1.normalizeTextForMatch).filter(Boolean);
            if (signals.some(signal => signal.includes(normalizedNeedle))) {
                return true;
            }
            return (0, element_ranking_1.elementLooksInteractive)(element) || (0, element_ranking_1.elementLooksInputLike)(element);
        });
        scopeMatches = filtered.slice(0, types_1.BROAD_SELECTOR_MATCH_LIMIT);
    }
    let matchedElements = scopeMatches.filter(element => {
        const signals = (0, text_matching_1.getElementTextSignals)(element).map(text_matching_1.normalizeTextForMatch).filter(Boolean);
        return signals.some(signal => signal.includes(normalizedNeedle));
    });
    if (step && (0, element_ranking_1.hasFieldIntent)(step)) {
        matchedElements = matchedElements.filter(element => (0, element_ranking_1.elementLooksInputLike)(element) || (0, element_ranking_1.elementLooksInteractive)(element));
    }
    const visibleMatches = matchedElements.filter(isVisibleElement);
    if (visibleMatches.length === 0) {
        return {
            totalMatchCount: matchedElements.length,
            visibleMatchCount: 0,
            effectiveMatchCount: 0,
            reason: 'no-visible-match',
            matchCount: 0,
            confidenceScore: 0,
            resolvedElement: null,
        };
    }
    if (visibleMatches.length === 1) {
        return {
            totalMatchCount: matchedElements.length,
            visibleMatchCount: 1,
            effectiveMatchCount: 1,
            reason: 'unique-visible',
            matchCount: 1,
            confidenceScore: 1,
            resolvedElement: visibleMatches[0] ?? null,
        };
    }
    const rankedMatches = (0, element_ranking_1.scoreMatchedElements)(visibleMatches, snapshot, step);
    const winner = rankedMatches[0];
    const runnerUp = rankedMatches[1];
    const ambiguityReason = winner && runnerUp && Math.abs(winner.score - runnerUp.score) < 0.05
        ? types_1.DOM_ORDER_TIEBREAKER_REASON
        : undefined;
    return {
        totalMatchCount: matchedElements.length,
        visibleMatchCount: visibleMatches.length,
        effectiveMatchCount: 1,
        reason: wasTooBroad ? 'too-broad' : 'resolved-multi-match',
        matchCount: visibleMatches.length,
        confidenceScore: ambiguityReason ? Math.min(winner?.score ?? 0, 0.7) : (winner?.score ?? 0),
        ambiguityReason,
        resolvedElement: winner?.element ?? null,
    };
}
