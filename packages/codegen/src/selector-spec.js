"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferSelectorEngine = inferSelectorEngine;
exports.buildSelectorSpec = buildSelectorSpec;
exports.buildScopedSelectorSpec = buildScopedSelectorSpec;
exports.buildBoundedFieldSelectorSpec = buildBoundedFieldSelectorSpec;
exports.isSelectorSpecExactProofLevel = isSelectorSpecExactProofLevel;
exports.isSelectorSpecRenderableAsNative = isSelectorSpecRenderableAsNative;
exports.isEquivalentRenderingRenderable = isEquivalentRenderingRenderable;
exports.canRenderSelectorSpecConfidently = canRenderSelectorSpecConfidently;
exports.getSelectorSpecRenderingWarnings = getSelectorSpecRenderingWarnings;
exports.pickPreferredEquivalentRendering = pickPreferredEquivalentRendering;
exports.renderLocatorExpressionFromSelectorSpec = renderLocatorExpressionFromSelectorSpec;
exports.renderLocatorExpressionFromEquivalentRendering = renderLocatorExpressionFromEquivalentRendering;
const render_bounded_field_1 = require("./resolver/bounded-field/render-bounded-field");
function escapeRegexLiteral(value) {
    return value.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}
function buildExactHasTextRegexLiteral(text) {
    return `/^${escapeRegexLiteral(text)}$/`;
}
function trimSelector(selector) {
    return typeof selector === 'string' ? selector.trim() : '';
}
function inferSelectorEngine(selector, selectorPriority) {
    const trimmed = trimSelector(selector);
    if (/^getByTestId\(/.test(trimmed))
        return 'testid';
    if (/^getByRole\(/.test(trimmed))
        return 'role';
    if (/^getByLabel\(/.test(trimmed))
        return 'label';
    if (/^getByPlaceholder\(/.test(trimmed))
        return 'placeholder';
    if (/^getByText\(/.test(trimmed))
        return 'text';
    if (/^(?:locator|getBy)[A-Za-z]/.test(trimmed))
        return 'playwright';
    if (trimmed.startsWith('text=') || /:has-text\((?:"[^"]*"|'[^']*')\)/i.test(trimmed))
        return 'text';
    if (trimmed.startsWith('//') || trimmed.startsWith('xpath=') || /^id\(".*"\)$/i.test(trimmed))
        return 'xpath';
    if (selectorPriority === 'xpath')
        return 'xpath';
    if (selectorPriority === 'text')
        return 'text';
    return 'css';
}
function buildSelectorSpec(params) {
    const selector = trimSelector(params.selector);
    const warningCodes = Array.from(new Set((params.warningCodes ?? []).filter(Boolean)));
    return {
        selector,
        engine: params.engine ?? inferSelectorEngine(selector, params.selectorPriority),
        source: params.source,
        proofLevel: params.proofLevel,
        labelContext: params.labelContext,
        triggerContext: params.triggerContext,
        rank: typeof params.rank === 'number' ? params.rank : undefined,
        confidence: typeof params.confidence === 'number' ? params.confidence : undefined,
        rejectReason: params.rejectReason ?? undefined,
        warningCodes: warningCodes.length > 0 ? warningCodes : undefined,
    };
}
function buildScopedSelectorSpec(params) {
    const warningCodes = Array.from(new Set((params.warningCodes ?? []).filter(Boolean)));
    return {
        selector: trimSelector(params.selector),
        engine: 'scoped',
        scope: params.scope,
        target: params.target,
        relation: params.relation,
        source: params.source,
        proofLevel: params.proofLevel,
        rank: typeof params.rank === 'number' ? params.rank : undefined,
        confidence: typeof params.confidence === 'number' ? params.confidence : undefined,
        rejectReason: params.rejectReason ?? undefined,
        warningCodes: warningCodes.length > 0 ? warningCodes : undefined,
    };
}
function buildBoundedFieldSelectorSpec(params) {
    const warningCodes = Array.from(new Set((params.warningCodes ?? []).filter(Boolean)));
    return {
        selector: trimSelector(params.selector),
        engine: 'bounded-field',
        boundedField: params.boundedField,
        source: params.source,
        proofLevel: params.proofLevel,
        rank: typeof params.rank === 'number' ? params.rank : undefined,
        confidence: typeof params.confidence === 'number' ? params.confidence : undefined,
        rejectReason: params.rejectReason ?? undefined,
        warningCodes: warningCodes.length > 0 ? warningCodes : undefined,
    };
}
function buildStructuralTriggerContextLocator(triggerContext) {
    const labelRegex = buildExactHasTextRegexLiteral(triggerContext.labelText);
    const labelTag = triggerContext.labelElementTag || 'label';
    const childSelector = triggerContext.cleanChildSelector || triggerContext.triggerSelector;
    if (!childSelector)
        return null;
    switch (triggerContext.association) {
        case 'bounded-field':
            if (!triggerContext.containerSelector)
                return null;
            return `locator(${JSON.stringify(triggerContext.containerSelector)}).filter({ has: this.page.locator(${JSON.stringify(labelTag)}).filter({ hasText: ${labelRegex} }) }).locator(${JSON.stringify(childSelector)})`;
        default:
            return null;
    }
}
function buildStructuralLabelContextLocator(labelContext) {
    const targetTag = labelContext.targetTag || 'input';
    const labelRegex = buildExactHasTextRegexLiteral(labelContext.labelText);
    switch (labelContext.association) {
        case 'wrapped-label':
            return `locator("label").filter({ hasText: ${labelRegex} }).locator(${JSON.stringify(targetTag)})`;
        case 'bounded-field':
            if (!labelContext.containerSelector)
                return null;
            return `locator(${JSON.stringify(labelContext.containerSelector)}).filter({ has: this.page.locator("label").filter({ hasText: ${labelRegex} }) }).locator(${JSON.stringify(targetTag)})`;
        case 'label-for':
            if (labelContext.targetId) {
                return `locator(${JSON.stringify(`[id="${labelContext.targetId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)})`;
            }
            return null;
        case 'aria-labelledby':
            if (labelContext.ariaLabelledBy) {
                return `locator(${JSON.stringify(`${targetTag}[aria-labelledby="${labelContext.ariaLabelledBy.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)})`;
            }
            return null;
        default:
            return null;
    }
}
function classifyLabelContextRenderStatus(labelContext) {
    if (labelContext.renderStatus)
        return labelContext.renderStatus;
    switch (labelContext.association) {
        case 'label-for':
        case 'aria-labelledby':
            return 'clean-direct-selector';
        case 'bounded-field':
            return labelContext.cleanParentSelector ? 'clean-scoped-locator' : 'proven-structural-fallback';
        case 'wrapped-label':
            return 'proven-structural-fallback';
        default:
            return 'proof-only-no-clean-render';
    }
}
function renderLabelContextLocator(labelContext) {
    const targetTag = labelContext.targetTag || 'input';
    const renderStatus = classifyLabelContextRenderStatus(labelContext);
    switch (renderStatus) {
        case 'clean-direct-selector':
            return buildStructuralLabelContextLocator(labelContext);
        case 'clean-scoped-locator':
            if (!labelContext.cleanParentSelector)
                return null;
            return `locator(${JSON.stringify(labelContext.cleanParentSelector)}).locator(${JSON.stringify(labelContext.cleanChildSelector || targetTag)})`;
        case 'proven-structural-fallback':
            return labelContext.structuralFallbackLocator || buildStructuralLabelContextLocator(labelContext);
        case 'proof-only-no-clean-render':
        case 'blocked-unsafe-render':
        default:
            return null;
    }
}
function renderTriggerContextLocator(triggerContext) {
    const renderStatus = triggerContext.renderStatus ?? 'proof-only-no-clean-render';
    switch (renderStatus) {
        case 'clean-direct-selector':
        case 'proven-structural-fallback':
            return triggerContext.structuralFallbackLocator || buildStructuralTriggerContextLocator(triggerContext);
        case 'clean-scoped-locator':
            if (!triggerContext.cleanParentSelector)
                return null;
            return `locator(${JSON.stringify(triggerContext.cleanParentSelector)}).locator(${JSON.stringify(triggerContext.cleanChildSelector || triggerContext.triggerSelector)})`;
        case 'proof-only-no-clean-render':
        case 'blocked-unsafe-render':
        default:
            return null;
    }
}
function renderScopedTargetSegment(spec) {
    if (!spec || spec.engine === 'scoped')
        return null;
    if (spec.engine === 'label-context' || spec.engine === 'trigger-context' || spec.engine === 'bounded-field')
        return null;
    const selector = trimSelector(spec.selector);
    return selector ? JSON.stringify(selector) : null;
}
function renderScopedLocator(spec) {
    const scopeExpr = renderLocatorExpressionFromSelectorSpec(spec.scope);
    const targetSegment = renderScopedTargetSegment(spec.target);
    if (!scopeExpr || !targetSegment)
        return null;
    return `${scopeExpr}.locator(${targetSegment})`;
}
function isSelectorSpecExactProofLevel(proofLevel) {
    return (proofLevel === 'recorded' ||
        proofLevel === 'snapshot_validated' ||
        proofLevel === 'semantic_validated' ||
        proofLevel === 'live_smoke_validated' ||
        proofLevel === 'weak_but_usable');
}
function isSelectorSpecRenderableAsNative(spec) {
    if (!spec)
        return false;
    const selector = spec.selector.trim();
    const hasNativeExpression = /^getBy(?:TestId|Role|Label|Placeholder|Text)\(/.test(selector) ||
        /^locator\(/.test(selector);
    if (!hasNativeExpression)
        return false;
    switch (spec.engine) {
        case 'role':
        case 'label':
            return spec.proofLevel === 'recorded' || spec.proofLevel === 'live_smoke_validated';
        case 'testid':
        case 'placeholder':
        case 'playwright':
            return (spec.proofLevel === 'proven_equivalent' ||
                spec.proofLevel === 'recorded' ||
                spec.proofLevel === 'live_smoke_validated');
        case 'text':
            return (/^getByText\(/.test(selector) &&
                (spec.proofLevel === 'proven_equivalent' ||
                    spec.proofLevel === 'recorded' ||
                    spec.proofLevel === 'live_smoke_validated'));
        default:
            return false;
    }
}
function isEquivalentRenderingRenderable(rendering) {
    if (!rendering)
        return false;
    switch (rendering.engine) {
        case 'testid':
        case 'placeholder':
        case 'text':
        case 'playwright':
            return (rendering.proofLevel === 'proven_equivalent' ||
                rendering.proofLevel === 'recorded' ||
                rendering.proofLevel === 'live_smoke_validated');
        case 'role':
        case 'label':
        default:
            return false;
    }
}
function canRenderSelectorSpecConfidently(spec) {
    if (!spec)
        return false;
    if (spec.engine === 'scoped') {
        return (canRenderSelectorSpecConfidently(spec.scope) &&
            canRenderSelectorSpecConfidently(spec.target) &&
            !!renderScopedLocator(spec) &&
            !(spec.proofLevel === 'blocked' ||
                spec.proofLevel === 'unvalidated' ||
                spec.proofLevel === 'inferred_unproven'));
    }
    if (spec.engine === 'bounded-field' &&
        spec.boundedField &&
        ((0, render_bounded_field_1.classifyBoundedFieldRenderStatus)(spec.boundedField) === 'proof-only-no-clean-render' ||
            (0, render_bounded_field_1.classifyBoundedFieldRenderStatus)(spec.boundedField) === 'blocked-unsafe-render' ||
            !(0, render_bounded_field_1.renderBoundedFieldLocator)(spec.boundedField))) {
        return false;
    }
    if (spec.engine === 'label-context' &&
        spec.labelContext &&
        (classifyLabelContextRenderStatus(spec.labelContext) === 'proof-only-no-clean-render' ||
            classifyLabelContextRenderStatus(spec.labelContext) === 'blocked-unsafe-render')) {
        return false;
    }
    if (spec.engine === 'trigger-context' &&
        spec.triggerContext &&
        ((spec.triggerContext.renderStatus ?? 'proof-only-no-clean-render') === 'proof-only-no-clean-render' ||
            (spec.triggerContext.renderStatus ?? 'proof-only-no-clean-render') === 'blocked-unsafe-render')) {
        return false;
    }
    return !(spec.proofLevel === 'blocked' ||
        spec.proofLevel === 'unvalidated' ||
        spec.proofLevel === 'inferred_unproven');
}
function getSelectorSpecRenderingWarnings(spec) {
    if (!spec)
        return [];
    const warnings = new Set(spec.warningCodes ?? []);
    const flatSpec = spec.engine !== 'scoped' && spec.engine !== 'bounded-field' ? spec : null;
    if (flatSpec?.labelContext?.warningCodes) {
        for (const code of flatSpec.labelContext.warningCodes)
            warnings.add(code);
    }
    if (flatSpec?.triggerContext?.warningCodes) {
        for (const code of flatSpec.triggerContext.warningCodes)
            warnings.add(code);
    }
    if (spec.engine === 'bounded-field' && spec.boundedField) {
        for (const code of (0, render_bounded_field_1.getBoundedFieldRenderingWarnings)(spec.boundedField))
            warnings.add(code);
    }
    switch (spec.proofLevel) {
        case 'recorded':
            warnings.add('recorded-not-revalidated');
            break;
        case 'weak_but_usable':
            warnings.add('weak-selector');
            break;
        case 'inferred_unproven':
            warnings.add('inferred-unproven');
            break;
        case 'blocked':
            warnings.add('blocked-selector');
            break;
        case 'unvalidated':
            warnings.add('unvalidated-selector');
            break;
        default:
            break;
    }
    if (spec.engine === 'label-context' && spec.labelContext) {
        const renderStatus = classifyLabelContextRenderStatus(spec.labelContext);
        if (renderStatus === 'proven-structural-fallback')
            warnings.add('label-context-structural-fallback');
        if (renderStatus === 'proof-only-no-clean-render')
            warnings.add('label-context-proof-only');
        if (renderStatus === 'blocked-unsafe-render')
            warnings.add('label-context-blocked-unsafe-render');
    }
    if (spec.engine === 'trigger-context' && spec.triggerContext) {
        const renderStatus = spec.triggerContext.renderStatus ?? 'proof-only-no-clean-render';
        if (renderStatus === 'proven-structural-fallback')
            warnings.add('custom-control-trigger-structural-fallback');
        if (renderStatus === 'proof-only-no-clean-render')
            warnings.add('custom-control-trigger-proof-only');
        if (renderStatus === 'blocked-unsafe-render')
            warnings.add('custom-control-trigger-blocked-unsafe-render');
    }
    return Array.from(warnings);
}
function pickPreferredEquivalentRendering(renderings) {
    if (!Array.isArray(renderings) || renderings.length === 0)
        return null;
    return renderings.find(rendering => isEquivalentRenderingRenderable(rendering)) ?? null;
}
function renderLocatorExpressionFromSelectorSpec(spec) {
    if (!spec)
        return null;
    if (spec.engine === 'scoped') {
        return renderScopedLocator(spec);
    }
    if (spec.engine === 'bounded-field' && spec.boundedField) {
        return (0, render_bounded_field_1.renderBoundedFieldLocator)(spec.boundedField);
    }
    if (spec.engine === 'label-context' && spec.labelContext) {
        return renderLabelContextLocator(spec.labelContext);
    }
    if (spec.engine === 'trigger-context' && spec.triggerContext) {
        return renderTriggerContextLocator(spec.triggerContext);
    }
    if (isSelectorSpecRenderableAsNative(spec)) {
        return spec.selector.trim();
    }
    return `locator(${JSON.stringify(spec.selector)})`;
}
function renderLocatorExpressionFromEquivalentRendering(rendering) {
    if (!rendering || !isEquivalentRenderingRenderable(rendering))
        return null;
    return rendering.locator.trim();
}
