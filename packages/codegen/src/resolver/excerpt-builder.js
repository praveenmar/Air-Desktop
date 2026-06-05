"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactSnapshot = redactSnapshot;
exports.serializeSnapshotExcerpt = serializeSnapshotExcerpt;
const element_ranking_1 = require("./element-ranking");
const text_matching_1 = require("./text-matching");
const NON_CONTENT_TAGS = new Set(['script', 'style', 'template', 'noscript']);
const STRIPPED_TAGS = new Set(['script', 'style', 'template', 'noscript', 'link', 'meta']);
const TEXT_LIKE_INPUT_TYPES = new Set([
    '',
    'text',
    'email',
    'password',
    'tel',
    'search',
    'url',
    'number',
    'date',
    'datetime-local',
    'time',
    'hidden',
]);
const SENSITIVE_TEXT_DETECTORS = [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b\d{10,15}\b/,
    /\b\d{6,}\b/,
    /\b[a-zA-Z0-9_-]{20,}\b/,
];
const SENSITIVE_TEXT_REPLACERS = [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /\b\d{10,15}\b/g,
    /\b\d{6,}\b/g,
    /\b[a-zA-Z0-9_-]{20,}\b/g,
];
function excerptNowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}
function isExcerptTelemetryEnabled() {
    const runtime = globalThis;
    return runtime.__AIR_RESOLVER_DEBUG__ === true || runtime.__AIR_DEBUG__ === true;
}
function legacyRegexRedactSnapshot(html) {
    const redactLegacyInputTag = (tag) => {
        const typeMatch = tag.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        const inputType = (typeMatch?.[1] ?? typeMatch?.[2] ?? '').trim().toLowerCase();
        if (!TEXT_LIKE_INPUT_TYPES.has(inputType)) {
            return tag;
        }
        return tag.replace(/\bvalue\s*=\s*(?:"[^"]*"|'[^']*')/i, 'value="REDACTED"');
    };
    return html
        .replace(/<input\b[^>]*\bvalue\s*=\s*(?:"[^"]*"|'[^']*')[^>]*>/gi, redactLegacyInputTag)
        .replace(/<textarea[^>]*>[\s\S]*?<\/textarea>/gi, '<textarea>REDACTED</textarea>')
        .replace(/\b\d{6,}\b/g, 'REDACTED')
        .replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, 'REDACTED');
}
function containsSensitivePattern(value) {
    if (typeof value !== 'string' || !value)
        return false;
    return SENSITIVE_TEXT_DETECTORS.some(pattern => pattern.test(value));
}
function redactSensitiveSubstrings(value) {
    let result = value;
    for (const pattern of SENSITIVE_TEXT_REPLACERS) {
        result = result.replace(pattern, 'REDACTED');
    }
    return result;
}
function shouldRedactValueAttribute(element) {
    const tagName = (element.tagName || '').toLowerCase();
    if (tagName === 'textarea')
        return true;
    if (tagName !== 'input')
        return false;
    const type = ((element.getAttribute('type') || '').trim().toLowerCase());
    if (type === 'radio' || type === 'checkbox' || type === 'submit' || type === 'button' || type === 'reset') {
        return false;
    }
    return TEXT_LIKE_INPUT_TYPES.has(type);
}
function stripNoiseFromDom(root) {
    const rootTag = (root.tagName || '').toLowerCase();
    if (STRIPPED_TAGS.has(rootTag)) {
        while (root.firstChild) {
            root.removeChild(root.firstChild);
        }
        return;
    }
    const selectors = Array.from(STRIPPED_TAGS).join(',');
    if (!selectors)
        return;
    for (const node of Array.from(root.querySelectorAll(selectors))) {
        node.parentNode?.removeChild(node);
    }
}
function redactElementAttributes(element) {
    const tagName = (element.tagName || '').toLowerCase();
    if (tagName === 'textarea') {
        const currentText = element.textContent || '';
        if (currentText.length > 0) {
            element.textContent = 'REDACTED';
        }
    }
    if (element.hasAttribute('value') && shouldRedactValueAttribute(element)) {
        element.setAttribute('value', 'REDACTED');
    }
    if (element.hasAttribute('data-value')) {
        const dataValue = element.getAttribute('data-value');
        if (containsSensitivePattern(dataValue)) {
            element.setAttribute('data-value', 'REDACTED');
        }
    }
    if (tagName !== 'meta' && element.hasAttribute('content')) {
        const content = element.getAttribute('content');
        if (containsSensitivePattern(content)) {
            element.setAttribute('content', 'REDACTED');
        }
    }
}
function redactTextNodes(root) {
    const doc = root.ownerDocument;
    const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
    const walker = doc.createTreeWalker(root, showText);
    const textNodes = [];
    let current = walker.nextNode();
    while (current) {
        textNodes.push(current);
        current = walker.nextNode();
    }
    for (const textNode of textNodes) {
        const parentElement = textNode.parentElement;
        if (!parentElement)
            continue;
        const parentTag = (parentElement.tagName || '').toLowerCase();
        if (parentTag === 'textarea')
            continue;
        if (NON_CONTENT_TAGS.has(parentTag))
            continue;
        const original = textNode.textContent || '';
        if (!original)
            continue;
        if (!containsSensitivePattern(original)) {
            if (original.trim().length < 40) {
                continue;
            }
            continue;
        }
        const redacted = redactSensitiveSubstrings(original);
        if (redacted !== original) {
            textNode.textContent = redacted;
        }
    }
}
function redactDomFragment(root) {
    stripNoiseFromDom(root);
    const showElement = root.ownerDocument.defaultView?.NodeFilter?.SHOW_ELEMENT ?? 1;
    const walker = root.ownerDocument.createTreeWalker(root, showElement);
    const elements = [root];
    let current = walker.nextNode();
    while (current) {
        elements.push(current);
        current = walker.nextNode();
    }
    for (const element of elements) {
        const tagName = (element.tagName || '').toLowerCase();
        if (NON_CONTENT_TAGS.has(tagName) || tagName === 'meta')
            continue;
        redactElementAttributes(element);
    }
    redactTextNodes(root);
}
function serializeRedactedElement(root) {
    const clone = root.cloneNode(true);
    redactDomFragment(clone);
    return clone.outerHTML || '';
}
function parseHtmlWithAvailableDom(html) {
    const globalDocument = globalThis.document;
    if (!globalDocument?.implementation?.createHTMLDocument) {
        return null;
    }
    const scratch = globalDocument.implementation.createHTMLDocument('air-redact');
    const container = scratch.createElement('div');
    container.innerHTML = html;
    return container;
}
function redactSnapshot(html) {
    try {
        const container = parseHtmlWithAvailableDom(html);
        if (!container) {
            throw new Error('dom-parser-unavailable');
        }
        redactDomFragment(container);
        return container.innerHTML;
    }
    catch {
        return legacyRegexRedactSnapshot(html);
    }
}
function serializeSnapshotExcerpt(snapshot, step, maxChars) {
    const telemetry = {
        excerptBuildStartedAt: excerptNowMs(),
        pruneMs: 0,
        redactMs: 0,
    };
    const TARGET_MARKER_ATTR = 'data-air-target';
    const MAX_BOUNDARY_HTML_CHARS = 50000;
    const PRUNED_MARKER_TEXT = '[...pruned...]';
    const PRUNING_MODE = 'path_only_phase_1';
    const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const SEMANTIC_BOUNDARY_TAGS = new Set(['form', 'dialog', 'table', 'section', 'fieldset', 'tr', 'li']);
    const stripNoise = (html) => {
        if (typeof html !== 'string') {
            return '';
        }
        return html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<link\b[^>]*>/gi, '')
            .replace(/<meta\b[^>]*>/gi, '')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
    };
    const legacySerializeFromElement = (targetElement, strategy = 'max-context') => {
        const candidateElements = [];
        candidateElements.push(targetElement);
        let parent = targetElement.parentElement;
        let depth = 0;
        while (parent && depth < 2) {
            candidateElements.push(parent);
            parent = parent.parentElement;
            depth++;
        }
        const redactedCandidates = candidateElements.map(element => {
            try {
                return serializeRedactedElement(element);
            }
            catch {
                return redactSnapshot(stripNoise(element.outerHTML));
            }
        });
        if (strategy === 'focused') {
            for (let index = 0; index < redactedCandidates.length; index += 1) {
                const redacted = redactedCandidates[index];
                const tagName = (candidateElements[index].tagName || '').toLowerCase();
                if (tagName === 'html' || tagName === 'body')
                    continue;
                if (redacted.length >= 60 && redacted.length <= maxChars) {
                    return redacted;
                }
            }
            for (let index = 0; index < redactedCandidates.length; index += 1) {
                const tagName = (candidateElements[index].tagName || '').toLowerCase();
                if (tagName === 'html' || tagName === 'body')
                    continue;
                const candidate = redactedCandidates[index] || '';
                if (candidate.length > 0)
                    return candidate.slice(0, maxChars);
            }
            const firstRedacted = redactedCandidates[0] || '';
            return firstRedacted.slice(0, maxChars);
        }
        let bestHtml = '';
        for (const redacted of redactedCandidates) {
            if (redacted.length <= maxChars && redacted.length > bestHtml.length) {
                bestHtml = redacted;
            }
        }
        if (!bestHtml) {
            const firstRedacted = redactedCandidates[0] || '';
            bestHtml = firstRedacted.slice(0, maxChars);
        }
        return bestHtml;
    };
    const isSemanticBoundaryElement = (element) => {
        const htmlElement = element;
        const tagName = (htmlElement.tagName || '').toLowerCase();
        if (SEMANTIC_BOUNDARY_TAGS.has(tagName))
            return true;
        const role = (htmlElement.getAttribute('role') || '').toLowerCase();
        if (role === 'dialog')
            return true;
        if (role === 'row' && tagName !== 'tr')
            return true;
        if (role === 'listitem' && tagName !== 'li')
            return true;
        return false;
    };
    const getBoundaryReason = (element, source) => {
        const htmlElement = element;
        const tagName = (htmlElement.tagName || '').toLowerCase();
        const role = (htmlElement.getAttribute('role') || '').toLowerCase();
        if (source === 'semantic') {
            if (role === 'dialog')
                return 'semantic-dialog';
            if (role === 'row' && tagName !== 'tr')
                return 'semantic-row';
            if (role === 'listitem' && tagName !== 'li')
                return 'semantic-listitem';
            return `semantic-${tagName || 'unknown'}`;
        }
        return `fallback-${tagName || 'target'}`;
    };
    const getAncestryChain = (targetElement) => {
        const chain = [];
        let current = targetElement;
        while (current) {
            chain.push(current);
            const tagName = ((current.tagName) || '').toLowerCase();
            if (tagName === 'body' || tagName === 'html')
                break;
            current = current.parentElement;
        }
        return chain;
    };
    const chooseBoundaryCandidate = (targetElement) => {
        const ancestry = getAncestryChain(targetElement);
        const semanticIndex = ancestry.findIndex(isSemanticBoundaryElement);
        const startingIndex = semanticIndex >= 0 ? semanticIndex : Math.min(2, ancestry.length - 1);
        const startingReason = semanticIndex >= 0
            ? getBoundaryReason(ancestry[startingIndex], 'semantic')
            : getBoundaryReason(ancestry[startingIndex], 'fallback');
        for (let index = startingIndex; index >= 0; index -= 1) {
            const candidate = ancestry[index];
            const candidateOuterHtml = typeof candidate.outerHTML === 'string'
                ? candidate.outerHTML
                : '';
            const candidateSize = stripNoise(candidateOuterHtml).length;
            if (!candidateOuterHtml || candidateSize === 0 || candidateSize <= MAX_BOUNDARY_HTML_CHARS) {
                const boundaryReason = index === startingIndex
                    ? startingReason
                    : `${startingReason}-size-guard-fallback`;
                return { boundary: candidate, boundaryReason };
            }
        }
        return {
            boundary: targetElement,
            boundaryReason: `${startingReason}-size-guard-target`,
        };
    };
    const pruneSiblingSubtree = (element) => {
        const descendantCount = typeof element.querySelectorAll === 'function'
            ? element.querySelectorAll('*').length
            : 0;
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
        const htmlElement = element;
        const tagName = (htmlElement.tagName || '').toLowerCase();
        htmlElement.setAttribute('data-air-pruned', 'true');
        if (!VOID_TAGS.has(tagName)) {
            htmlElement.textContent = PRUNED_MARKER_TEXT;
        }
        return descendantCount + 1;
    };
    const serializePrunedBoundary = (targetElement, strategy = 'max-context') => {
        const pruneStartedAt = excerptNowMs();
        const targetHtmlElement = targetElement;
        if (typeof targetHtmlElement.outerHTML !== 'string') {
            return null;
        }
        const { boundary, boundaryReason } = chooseBoundaryCandidate(targetElement);
        const boundaryHtmlElement = boundary;
        if (typeof boundaryHtmlElement.outerHTML !== 'string') {
            return null;
        }
        let boundaryClone = null;
        let clonedTarget = null;
        try {
            targetHtmlElement.setAttribute(TARGET_MARKER_ATTR, 'true');
            if (typeof boundary.cloneNode !== 'function') {
                return null;
            }
            boundaryClone = boundary.cloneNode(true);
            if (!boundaryClone) {
                return null;
            }
            const cloneHtmlElement = boundaryClone;
            clonedTarget = cloneHtmlElement.getAttribute(TARGET_MARKER_ATTR) === 'true'
                ? boundaryClone
                : boundaryClone.querySelector(`[${TARGET_MARKER_ATTR}="true"]`);
            if (!clonedTarget) {
                return null;
            }
            targetHtmlElement.removeAttribute(TARGET_MARKER_ATTR);
            clonedTarget.removeAttribute(TARGET_MARKER_ATTR);
            const pathNodes = [];
            const pathSet = new Set();
            let current = clonedTarget;
            while (current) {
                pathNodes.push(current);
                pathSet.add(current);
                if (current === boundaryClone) {
                    break;
                }
                current = current.parentElement;
            }
            if (pathNodes[pathNodes.length - 1] !== boundaryClone) {
                return null;
            }
            let prunedNodeCount = 0;
            for (let index = pathNodes.length - 1; index >= 0; index -= 1) {
                const pathNode = pathNodes[index];
                const childElements = Array.from(pathNode.children);
                for (const child of childElements) {
                    if (pathSet.has(child))
                        continue;
                    prunedNodeCount += pruneSiblingSubtree(child);
                }
            }
            const boundarySizeBefore = stripNoise(boundaryHtmlElement.outerHTML).length;
            const boundarySizeAfter = stripNoise(boundaryClone.outerHTML || '').length;
            console.log('[AIR] [RESOLVER] Excerpt pruning applied', {
                boundarySizeBefore,
                boundarySizeAfter,
                prunedNodeCount,
                boundaryReason,
                pruningMode: PRUNING_MODE,
            });
            let redacted = '';
            const beforeRedactAt = excerptNowMs();
            telemetry.pruneMs += beforeRedactAt - pruneStartedAt;
            const redactStartedAt = excerptNowMs();
            try {
                redactDomFragment(boundaryClone);
                redacted = boundaryClone.outerHTML || '';
            }
            catch {
                redacted = redactSnapshot(stripNoise(boundaryClone.outerHTML || ''));
            }
            telemetry.redactMs += excerptNowMs() - redactStartedAt;
            if (strategy === 'focused') {
                return redacted.slice(0, maxChars);
            }
            return redacted.length <= maxChars
                ? redacted
                : redacted.slice(0, maxChars);
        }
        catch (error) {
            console.warn('[AIR] [RESOLVER] Excerpt pruning failed, using legacy excerpt behavior', {
                reason: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
        finally {
            targetHtmlElement.removeAttribute(TARGET_MARKER_ATTR);
            if (clonedTarget) {
                clonedTarget.removeAttribute(TARGET_MARKER_ATTR);
            }
        }
    };
    const serializeFromElement = (targetElement, strategy = 'max-context') => {
        const pruned = serializePrunedBoundary(targetElement, strategy);
        if (typeof pruned === 'string' && pruned.length > 0) {
            return pruned;
        }
        return legacySerializeFromElement(targetElement, strategy);
    };
    const fallbackDocumentExcerpt = () => {
        const interactiveSelectors = [
            'a[href]',
            'button',
            'input:not([type="hidden"])',
            'select',
            '[role="button"]',
            '[role="link"]',
            '[data-testid]',
            '[data-id]',
            '[class*="btn"]',
            '[class*="button"]',
        ];
        const interactiveCandidates = [];
        const seenCandidates = new Set();
        const addCandidate = (element) => {
            if (!element)
                return;
            if (seenCandidates.has(element))
                return;
            seenCandidates.add(element);
            interactiveCandidates.push(element);
        };
        for (const selector of interactiveSelectors) {
            try {
                const matches = Array.from(snapshot.querySelectorAll(selector)).slice(0, 4);
                for (const match of matches) {
                    addCandidate(match);
                }
            }
            catch {
                // Ignore invalid selector errors and continue probing.
            }
        }
        if (interactiveCandidates.length > 0) {
            const ranked = interactiveCandidates
                .map(element => ({
                element,
                score: (0, element_ranking_1.evaluateIntentMatch)(element, step).score,
            }))
                .sort((a, b) => b.score - a.score);
            const best = ranked[0]?.element;
            if (best) {
                return serializeFromElement(best, 'focused');
            }
        }
        const root = (snapshot.body || snapshot.documentElement);
        if (root) {
            try {
                const redactStartedAt = excerptNowMs();
                const redacted = serializeRedactedElement(root).slice(0, maxChars);
                telemetry.redactMs += excerptNowMs() - redactStartedAt;
                return redacted;
            }
            catch {
                const fullHtml = root.outerHTML || '';
                const cleaned = stripNoise(fullHtml);
                const redactStartedAt = excerptNowMs();
                const redacted = redactSnapshot(cleaned);
                telemetry.redactMs += excerptNowMs() - redactStartedAt;
                return redacted.slice(0, maxChars);
            }
        }
        const fullHtml = snapshot.body?.outerHTML || snapshot.documentElement?.outerHTML || '';
        const cleaned = stripNoise(fullHtml);
        const redactStartedAt = excerptNowMs();
        const redacted = redactSnapshot(cleaned);
        telemetry.redactMs += excerptNowMs() - redactStartedAt;
        return redacted.slice(0, maxChars);
    };
    const finalizeExcerpt = (excerpt, mode) => {
        const excerptBuildTotalMs = Math.round((excerptNowMs() - telemetry.excerptBuildStartedAt) * 100) / 100;
        const pruneMs = Math.round(telemetry.pruneMs * 100) / 100;
        const redactMs = Math.round(telemetry.redactMs * 100) / 100;
        const finalExcerptChars = excerpt.length;
        if (isExcerptTelemetryEnabled()) {
            console.log('[AIR] [RESOLVER] Excerpt telemetry', {
                mode,
                excerptBuildMs: excerptBuildTotalMs,
                excerptBuildTotalMs,
                pruneMs,
                redactMs,
                finalExcerptChars,
            });
        }
        return {
            excerpt,
            mode,
            metrics: {
                excerptBuildTotalMs,
                pruneMs,
                redactMs,
                finalExcerptChars,
            },
        };
    };
    const targetSelector = step.selector || '';
    if (targetSelector && (0, text_matching_1.isLikelyCssSelector)(targetSelector)) {
        try {
            const targetElement = snapshot.querySelector(targetSelector);
            if (targetElement) {
                return finalizeExcerpt(serializeFromElement(targetElement), 'target-selector');
            }
        }
        catch {
            // Ignore and continue with seed search.
        }
    }
    const seedElements = (0, element_ranking_1.findSeedElements)(step, snapshot);
    if (seedElements.length > 0) {
        const rankedSeed = seedElements
            .map(element => ({
            element,
            score: (0, element_ranking_1.evaluateIntentMatch)(element, step).score,
        }))
            .sort((a, b) => b.score - a.score)[0]?.element;
        if (rankedSeed) {
            return finalizeExcerpt(serializeFromElement(rankedSeed), 'seed-element');
        }
    }
    return finalizeExcerpt(fallbackDocumentExcerpt(), 'document-fallback');
}
