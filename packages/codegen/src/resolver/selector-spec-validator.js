"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateScopedSelectorSpec = validateScopedSelectorSpec;
exports.validateBoundedFieldStructuredSelectorSpec = validateBoundedFieldStructuredSelectorSpec;
exports.validateSelectorSpec = validateSelectorSpec;
exports.validateRawCandidate = validateRawCandidate;
const types_1 = require("./types");
const validate_bounded_field_1 = require("./bounded-field/validate-bounded-field");
const text_matching_1 = require("./text-matching");
const visibility_1 = require("./visibility");
const structured_selector_utils_1 = require("./structured-selector-utils");
const visibility_2 = require("./visibility");
function getValidationRoot(snapshot, root) {
    return root ?? snapshot;
}
function summarizeMatches(collection) {
    if (collection.blockedReason === 'invalid-selector') {
        return {
            totalMatchCount: 0,
            visibleMatchCount: 0,
            effectiveMatchCount: 0,
            reason: 'invalid-selector',
            confidenceScore: 0,
        };
    }
    if (collection.visibleMatchCount === 0) {
        return {
            totalMatchCount: collection.totalMatchCount,
            visibleMatchCount: 0,
            effectiveMatchCount: 0,
            reason: collection.blockedReason === 'too-broad' ? 'too-broad' : 'no-visible-match',
            matchCount: 0,
            confidenceScore: 0,
            resolvedElement: null,
        };
    }
    if (collection.visibleMatchCount === 1) {
        return {
            totalMatchCount: collection.totalMatchCount,
            visibleMatchCount: 1,
            effectiveMatchCount: 1,
            reason: 'unique-visible',
            matchCount: 1,
            confidenceScore: 1,
            resolvedElement: collection.matches[0] ?? null,
        };
    }
    return {
        totalMatchCount: collection.totalMatchCount,
        visibleMatchCount: collection.visibleMatchCount,
        effectiveMatchCount: collection.visibleMatchCount > 1 ? 2 : 0,
        reason: collection.totalMatchCount > types_1.BROAD_SELECTOR_MATCH_LIMIT ? 'too-broad' : 'non-unique',
        matchCount: collection.visibleMatchCount,
        confidenceScore: 0.3,
        resolvedElement: null,
    };
}
function isWithinRoot(root, element) {
    if (root === element || root === element.ownerDocument)
        return true;
    if ('contains' in root && typeof root.contains === 'function') {
        return root.contains(element);
    }
    return false;
}
function collectFlatMatches(spec, snapshot, context) {
    const root = getValidationRoot(snapshot, context.root);
    const selector = spec.selector.trim();
    if ((0, text_matching_1.isTextSelector)(selector)) {
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
                    matches: [],
                    totalMatchCount: 0,
                    visibleMatchCount: 0,
                    blockedReason: 'invalid-selector',
                };
            }
            scopeSelector = hasTextMatch[1]?.trim() || null;
            textNeedle = (0, text_matching_1.unquoteTextLiteral)(hasTextMatch[2]?.trim() || '');
        }
        const normalizedNeedle = (0, text_matching_1.normalizeTextForMatch)(textNeedle);
        if (!normalizedNeedle) {
            return {
                matches: [],
                totalMatchCount: 0,
                visibleMatchCount: 0,
                blockedReason: 'invalid-selector',
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
                matches: [],
                totalMatchCount: 0,
                visibleMatchCount: 0,
                blockedReason: 'invalid-selector',
            };
        }
        let matchedElements = scopeMatches.filter(element => {
            const signals = (0, text_matching_1.getElementTextSignals)(element).map(text_matching_1.normalizeTextForMatch).filter(Boolean);
            return signals.some(signal => signal.includes(normalizedNeedle));
        });
        if (context.step && (0, visibility_1.hasFieldIntent)(context.step)) {
            matchedElements = matchedElements.filter(element => (0, visibility_1.elementLooksInputLike)(element) || (0, visibility_1.elementLooksInteractive)(element));
        }
        const visibleMatches = matchedElements.filter(visibility_2.isVisibleElement);
        return {
            matches: visibleMatches,
            totalMatchCount: matchedElements.length,
            visibleMatchCount: visibleMatches.length,
            blockedReason: visibleMatches.length > types_1.BROAD_SELECTOR_MATCH_LIMIT ? 'too-broad' : undefined,
        };
    }
    if (!(0, text_matching_1.isLikelyCssSelector)(selector)) {
        return {
            matches: [],
            totalMatchCount: 0,
            visibleMatchCount: 0,
            blockedReason: 'invalid-selector',
        };
    }
    try {
        const allMatches = Array.from(root.querySelectorAll(selector));
        const visibleMatches = allMatches.filter(visibility_2.isVisibleElement);
        return {
            matches: visibleMatches,
            totalMatchCount: allMatches.length,
            visibleMatchCount: visibleMatches.length,
            blockedReason: allMatches.length > types_1.BROAD_SELECTOR_MATCH_LIMIT ? 'too-broad' : undefined,
        };
    }
    catch {
        return {
            matches: [],
            totalMatchCount: 0,
            visibleMatchCount: 0,
            blockedReason: 'invalid-selector',
        };
    }
}
function collectLabelContextMatches(labelContext, snapshot, context) {
    const root = getValidationRoot(snapshot, context.root);
    const matches = [];
    if (labelContext.association === 'wrapped-label') {
        try {
            const labels = Array.from(root.querySelectorAll('label')).filter(label => (0, structured_selector_utils_1.normalizeStructuredSelectorText)(label.textContent || '') === (0, structured_selector_utils_1.normalizeStructuredSelectorText)(labelContext.labelText));
            for (const label of labels) {
                const controls = (0, structured_selector_utils_1.getVisibleInputLikeControls)(label).filter(control => control.tagName?.toLowerCase() === labelContext.targetTag);
                if (controls.length === 1) {
                    matches.push(controls[0]);
                }
            }
        }
        catch {
            return {
                matches: [],
                totalMatchCount: 0,
                visibleMatchCount: 0,
                blockedReason: 'invalid-selector',
            };
        }
        return {
            matches,
            totalMatchCount: matches.length,
            visibleMatchCount: matches.length,
        };
    }
    if (labelContext.association === 'bounded-field' && labelContext.containerSelector) {
        try {
            const containers = Array.from(root.querySelectorAll(labelContext.containerSelector)).filter(visibility_2.isVisibleElement);
            for (const container of containers) {
                const labels = Array.from(container.querySelectorAll('label')).filter(label => (0, structured_selector_utils_1.normalizeStructuredSelectorText)(label.textContent || '') === (0, structured_selector_utils_1.normalizeStructuredSelectorText)(labelContext.labelText));
                if (labels.length !== 1)
                    continue;
                const controls = (0, structured_selector_utils_1.getVisibleInputLikeControls)(container).filter(control => control.tagName?.toLowerCase() === labelContext.targetTag);
                if (controls.length === 1) {
                    matches.push(controls[0]);
                }
            }
        }
        catch {
            return {
                matches: [],
                totalMatchCount: 0,
                visibleMatchCount: 0,
                blockedReason: 'invalid-selector',
            };
        }
        return {
            matches,
            totalMatchCount: matches.length,
            visibleMatchCount: matches.length,
        };
    }
    if (labelContext.association === 'label-for' && labelContext.targetId) {
        const target = snapshot.getElementById(labelContext.targetId);
        if (!target || !isWithinRoot(root, target) || !(0, visibility_2.isVisibleElement)(target)) {
            return {
                matches: [],
                totalMatchCount: target ? 1 : 0,
                visibleMatchCount: 0,
                blockedReason: target ? 'no-visible-match' : 'no-visible-match',
            };
        }
        return {
            matches: [target],
            totalMatchCount: 1,
            visibleMatchCount: 1,
        };
    }
    if (labelContext.association === 'aria-labelledby' && labelContext.ariaLabelledBy) {
        const selector = `${labelContext.targetTag}[aria-labelledby="${labelContext.ariaLabelledBy.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
        return collectFlatMatches({
            engine: 'css',
            selector,
            source: 'resolver',
            proofLevel: 'snapshot_validated',
        }, snapshot, context);
    }
    return {
        matches: [],
        totalMatchCount: 0,
        visibleMatchCount: 0,
        blockedReason: 'invalid-selector',
    };
}
function collectTriggerContextMatches(triggerContext, snapshot, context) {
    const root = getValidationRoot(snapshot, context.root);
    if (triggerContext.association !== 'bounded-field' || !triggerContext.containerSelector) {
        return {
            matches: [],
            totalMatchCount: 0,
            visibleMatchCount: 0,
            blockedReason: 'invalid-selector',
        };
    }
    const matches = [];
    try {
        const containers = Array.from(root.querySelectorAll(triggerContext.containerSelector)).filter(visibility_2.isVisibleElement);
        for (const container of containers) {
            const labelMatches = (0, structured_selector_utils_1.findExactVisibleLabelLikeDescendants)(container, triggerContext.labelText)
                .filter(element => (element.tagName?.toLowerCase() || '') === (triggerContext.labelElementTag || 'label'));
            if (labelMatches.length !== 1)
                continue;
            const controls = (0, structured_selector_utils_1.getVisibleTriggerLikeControls)(container).filter(control => {
                const childSelector = triggerContext.cleanChildSelector || triggerContext.triggerSelector;
                if (!childSelector)
                    return false;
                try {
                    return Array.from(container.querySelectorAll(childSelector)).includes(control);
                }
                catch {
                    return false;
                }
            });
            if (controls.length === 1) {
                matches.push(controls[0]);
            }
        }
    }
    catch {
        return {
            matches: [],
            totalMatchCount: 0,
            visibleMatchCount: 0,
            blockedReason: 'invalid-selector',
        };
    }
    return {
        matches,
        totalMatchCount: matches.length,
        visibleMatchCount: matches.length,
    };
}
function collectScopedMatches(spec, snapshot, context) {
    const scopeCollection = collectMatchesForSelectorSpec(spec.scope, snapshot, context);
    if (scopeCollection.visibleMatchCount === 0) {
        return {
            matches: [],
            totalMatchCount: 0,
            visibleMatchCount: 0,
            blockedReason: scopeCollection.blockedReason ?? 'no-visible-match',
        };
    }
    const matches = [];
    for (const scopeElement of scopeCollection.matches) {
        const targetCollection = collectMatchesForSelectorSpec(spec.target, snapshot, {
            ...context,
            root: scopeElement,
        });
        for (const match of targetCollection.matches) {
            if ((0, visibility_2.isVisibleElement)(match)) {
                matches.push(match);
            }
        }
    }
    return {
        matches,
        totalMatchCount: matches.length,
        visibleMatchCount: matches.length,
        blockedReason: matches.length > types_1.BROAD_SELECTOR_MATCH_LIMIT ? 'too-broad' : undefined,
    };
}
function collectMatchesForSelectorSpec(spec, snapshot, context) {
    switch (spec.engine) {
        case 'scoped':
            return collectScopedMatches(spec, snapshot, context);
        case 'bounded-field': {
            const validation = validateBoundedFieldStructuredSelectorSpec(spec, snapshot, context);
            return {
                matches: validation.resolvedElement ? [validation.resolvedElement] : [],
                totalMatchCount: validation.totalMatchCount,
                visibleMatchCount: validation.visibleMatchCount,
                blockedReason: validation.reason === 'unique-visible' ? undefined : validation.reason,
            };
        }
        case 'label-context':
            return spec.labelContext
                ? collectLabelContextMatches(spec.labelContext, snapshot, context)
                : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' };
        case 'trigger-context':
            return spec.triggerContext
                ? collectTriggerContextMatches(spec.triggerContext, snapshot, context)
                : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' };
        default:
            return collectFlatMatches(spec, snapshot, context);
    }
}
function validateScopedSelectorSpec(spec, snapshot, context = {}) {
    return summarizeMatches(collectScopedMatches(spec, snapshot, context));
}
function validateBoundedFieldStructuredSelectorSpec(spec, snapshot, context = {}) {
    return (0, validate_bounded_field_1.validateBoundedFieldSelectorSpec)(spec, snapshot, context);
}
function validateSelectorSpec(spec, snapshot, context = {}) {
    switch (spec.engine) {
        case 'scoped':
            return validateScopedSelectorSpec(spec, snapshot, context);
        case 'bounded-field':
            return validateBoundedFieldStructuredSelectorSpec(spec, snapshot, context);
        case 'label-context':
            return summarizeMatches(spec.labelContext
                ? collectLabelContextMatches(spec.labelContext, snapshot, context)
                : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' });
        case 'trigger-context':
            return summarizeMatches(spec.triggerContext
                ? collectTriggerContextMatches(spec.triggerContext, snapshot, context)
                : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' });
        default:
            return (0, text_matching_1.isTextSelector)(spec.selector)
                ? (0, visibility_2.validateTextCandidate)(spec.selector, snapshot, context.step, context.root)
                : (0, visibility_2.validateCSSCandidate)(spec.selector, snapshot, context.step, context.root);
    }
}
function validateRawCandidate(candidate, snapshot, step) {
    if (candidate.engine === 'bounded-field' && candidate.boundedField) {
        return (0, validate_bounded_field_1.validateBoundedFieldSelectorSpec)({
            selector: candidate.selector,
            engine: 'bounded-field',
            boundedField: candidate.boundedField,
            source: 'resolver',
            proofLevel: 'snapshot_validated',
        }, snapshot, { step });
    }
    if (candidate.engine === 'label-context') {
        return summarizeMatches(candidate.labelContext
            ? collectLabelContextMatches(candidate.labelContext, snapshot, { step })
            : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' });
    }
    if (candidate.engine === 'trigger-context') {
        return summarizeMatches(candidate.triggerContext
            ? collectTriggerContextMatches(candidate.triggerContext, snapshot, { step })
            : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' });
    }
    const selector = candidate.selector;
    return (0, text_matching_1.isTextSelector)(selector)
        ? (0, visibility_2.validateTextCandidate)(selector, snapshot, step)
        : (0, visibility_2.validateCSSCandidate)(selector, snapshot, step);
}
