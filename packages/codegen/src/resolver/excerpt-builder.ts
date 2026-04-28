import type { CodegenStep } from '../types';
import { evaluateIntentMatch, findSeedElements } from './element-ranking';
import { isLikelyCssSelector } from './text-matching';

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

function excerptNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function isExcerptTelemetryEnabled(): boolean {
  const runtime = globalThis as { __AIR_RESOLVER_DEBUG__?: boolean; __AIR_DEBUG__?: boolean };
  return runtime.__AIR_RESOLVER_DEBUG__ === true || runtime.__AIR_DEBUG__ === true;
}

function legacyRegexRedactSnapshot(html: string): string {
  const redactLegacyInputTag = (tag: string): string => {
    const typeMatch = tag.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const inputType = (typeMatch?.[1] ?? typeMatch?.[2] ?? '').trim().toLowerCase();
    if (!TEXT_LIKE_INPUT_TYPES.has(inputType)) {
      return tag;
    }

    return tag.replace(
      /\bvalue\s*=\s*(?:"[^"]*"|'[^']*')/i,
      'value="REDACTED"',
    );
  };

  return html
    .replace(/<input\b[^>]*\bvalue\s*=\s*(?:"[^"]*"|'[^']*')[^>]*>/gi, redactLegacyInputTag)
    .replace(/<textarea[^>]*>[\s\S]*?<\/textarea>/gi, '<textarea>REDACTED</textarea>')
    .replace(/\b\d{6,}\b/g, 'REDACTED')
    .replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, 'REDACTED');
}

function containsSensitivePattern(value?: string | null): boolean {
  if (typeof value !== 'string' || !value) return false;
  return SENSITIVE_TEXT_DETECTORS.some(pattern => pattern.test(value));
}

function redactSensitiveSubstrings(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_TEXT_REPLACERS) {
    result = result.replace(pattern, 'REDACTED');
  }
  return result;
}

function shouldRedactValueAttribute(element: Element): boolean {
  const tagName = ((element as HTMLElement).tagName || '').toLowerCase();
  if (tagName === 'textarea') return true;
  if (tagName !== 'input') return false;

  const type = ((element.getAttribute('type') || '').trim().toLowerCase());
  if (type === 'radio' || type === 'checkbox' || type === 'submit' || type === 'button' || type === 'reset') {
    return false;
  }
  return TEXT_LIKE_INPUT_TYPES.has(type);
}

function stripNoiseFromDom(root: Element): void {
  const rootTag = ((root as HTMLElement).tagName || '').toLowerCase();
  if (STRIPPED_TAGS.has(rootTag)) {
    while (root.firstChild) {
      root.removeChild(root.firstChild);
    }
    return;
  }

  const selectors = Array.from(STRIPPED_TAGS).join(',');
  if (!selectors) return;
  for (const node of Array.from(root.querySelectorAll(selectors))) {
    node.parentNode?.removeChild(node);
  }
}

function redactElementAttributes(element: Element): void {
  const tagName = ((element as HTMLElement).tagName || '').toLowerCase();

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

function redactTextNodes(root: Element): void {
  const doc = root.ownerDocument;
  const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(root, showText);
  const textNodes: Text[] = [];

  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const parentElement = textNode.parentElement;
    if (!parentElement) continue;

    const parentTag = (parentElement.tagName || '').toLowerCase();
    if (parentTag === 'textarea') continue;
    if (NON_CONTENT_TAGS.has(parentTag)) continue;

    const original = textNode.textContent || '';
    if (!original) continue;
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

function redactDomFragment(root: Element): void {
  stripNoiseFromDom(root);

  const showElement = root.ownerDocument.defaultView?.NodeFilter?.SHOW_ELEMENT ?? 1;
  const walker = root.ownerDocument.createTreeWalker(root, showElement);
  const elements: Element[] = [root];
  let current = walker.nextNode();
  while (current) {
    elements.push(current as Element);
    current = walker.nextNode();
  }

  for (const element of elements) {
    const tagName = ((element as HTMLElement).tagName || '').toLowerCase();
    if (NON_CONTENT_TAGS.has(tagName) || tagName === 'meta') continue;
    redactElementAttributes(element);
  }

  redactTextNodes(root);
}

function serializeRedactedElement(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  redactDomFragment(clone);
  return (clone as HTMLElement).outerHTML || '';
}

function parseHtmlWithAvailableDom(html: string): Element | null {
  const globalDocument = (globalThis as { document?: Document }).document;
  if (!globalDocument?.implementation?.createHTMLDocument) {
    return null;
  }

  const scratch = globalDocument.implementation.createHTMLDocument('air-redact');
  const container = scratch.createElement('div');
  container.innerHTML = html;
  return container;
}

export function redactSnapshot(html: string): string {
  try {
    const container = parseHtmlWithAvailableDom(html);
    if (!container) {
      throw new Error('dom-parser-unavailable');
    }
    redactDomFragment(container);
    return container.innerHTML;
  } catch {
    return legacyRegexRedactSnapshot(html);
  }
}

export function serializeSnapshotExcerpt(
  snapshot: Document,
  step: CodegenStep,
  maxChars: number
): {
  excerpt: string;
  mode: 'target-selector' | 'seed-element' | 'document-fallback';
  metrics: {
    excerptBuildTotalMs: number;
    pruneMs: number;
    redactMs: number;
    finalExcerptChars: number;
  };
} {
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

  const stripNoise = (html: string): string => {
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

  const legacySerializeFromElement = (
    targetElement: Element,
    strategy: 'max-context' | 'focused' = 'max-context'
  ): string => {
    const candidateElements: Element[] = [];
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
      } catch {
        return redactSnapshot(stripNoise(element.outerHTML));
      }
    });

    if (strategy === 'focused') {
      for (let index = 0; index < redactedCandidates.length; index += 1) {
        const redacted = redactedCandidates[index];
        const tagName = ((candidateElements[index] as HTMLElement).tagName || '').toLowerCase();
        if (tagName === 'html' || tagName === 'body') continue;
        if (redacted.length >= 60 && redacted.length <= maxChars) {
          return redacted;
        }
      }
      for (let index = 0; index < redactedCandidates.length; index += 1) {
        const tagName = ((candidateElements[index] as HTMLElement).tagName || '').toLowerCase();
        if (tagName === 'html' || tagName === 'body') continue;
        const candidate = redactedCandidates[index] || '';
        if (candidate.length > 0) return candidate.slice(0, maxChars);
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

  const isSemanticBoundaryElement = (element: Element): boolean => {
    const htmlElement = element as HTMLElement;
    const tagName = (htmlElement.tagName || '').toLowerCase();
    if (SEMANTIC_BOUNDARY_TAGS.has(tagName)) return true;

    const role = (htmlElement.getAttribute('role') || '').toLowerCase();
    if (role === 'dialog') return true;
    if (role === 'row' && tagName !== 'tr') return true;
    if (role === 'listitem' && tagName !== 'li') return true;
    return false;
  };

  const getBoundaryReason = (element: Element, source: 'semantic' | 'fallback'): string => {
    const htmlElement = element as HTMLElement;
    const tagName = (htmlElement.tagName || '').toLowerCase();
    const role = (htmlElement.getAttribute('role') || '').toLowerCase();
    if (source === 'semantic') {
      if (role === 'dialog') return 'semantic-dialog';
      if (role === 'row' && tagName !== 'tr') return 'semantic-row';
      if (role === 'listitem' && tagName !== 'li') return 'semantic-listitem';
      return `semantic-${tagName || 'unknown'}`;
    }
    return `fallback-${tagName || 'target'}`;
  };

  const getAncestryChain = (targetElement: Element): Element[] => {
    const chain: Element[] = [];
    let current: Element | null = targetElement;
    while (current) {
      chain.push(current);
      const tagName = (((current as HTMLElement).tagName) || '').toLowerCase();
      if (tagName === 'body' || tagName === 'html') break;
      current = current.parentElement;
    }
    return chain;
  };

  const chooseBoundaryCandidate = (
    targetElement: Element
  ): { boundary: Element; boundaryReason: string } => {
    const ancestry = getAncestryChain(targetElement);
    const semanticIndex = ancestry.findIndex(isSemanticBoundaryElement);
    const startingIndex = semanticIndex >= 0 ? semanticIndex : Math.min(2, ancestry.length - 1);
    const startingReason = semanticIndex >= 0
      ? getBoundaryReason(ancestry[startingIndex] as Element, 'semantic')
      : getBoundaryReason(ancestry[startingIndex] as Element, 'fallback');

    for (let index = startingIndex; index >= 0; index -= 1) {
      const candidate = ancestry[index] as Element;
      const candidateOuterHtml = typeof (candidate as HTMLElement).outerHTML === 'string'
        ? (candidate as HTMLElement).outerHTML
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

  const pruneSiblingSubtree = (element: Element): number => {
    const descendantCount = typeof (element as HTMLElement).querySelectorAll === 'function'
      ? (element as HTMLElement).querySelectorAll('*').length
      : 0;

    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }

    const htmlElement = element as HTMLElement;
    const tagName = (htmlElement.tagName || '').toLowerCase();
    htmlElement.setAttribute('data-air-pruned', 'true');
    if (!VOID_TAGS.has(tagName)) {
      htmlElement.textContent = PRUNED_MARKER_TEXT;
    }

    return descendantCount + 1;
  };

  const serializePrunedBoundary = (
    targetElement: Element,
    strategy: 'max-context' | 'focused' = 'max-context'
  ): string | null => {
    const pruneStartedAt = excerptNowMs();
    const targetHtmlElement = targetElement as HTMLElement;
    if (typeof targetHtmlElement.outerHTML !== 'string') {
      return null;
    }

    const { boundary, boundaryReason } = chooseBoundaryCandidate(targetElement);
    const boundaryHtmlElement = boundary as HTMLElement;
    if (typeof boundaryHtmlElement.outerHTML !== 'string') {
      return null;
    }

    let boundaryClone: Element | null = null;
    let clonedTarget: Element | null = null;

    try {
      targetHtmlElement.setAttribute(TARGET_MARKER_ATTR, 'true');

      if (typeof (boundary as Node).cloneNode !== 'function') {
        return null;
      }

      boundaryClone = (boundary as Node).cloneNode(true) as Element;
      if (!boundaryClone) {
        return null;
      }

      const cloneHtmlElement = boundaryClone as HTMLElement;
      clonedTarget = cloneHtmlElement.getAttribute(TARGET_MARKER_ATTR) === 'true'
        ? boundaryClone
        : boundaryClone.querySelector(`[${TARGET_MARKER_ATTR}="true"]`);

      if (!clonedTarget) {
        return null;
      }

      targetHtmlElement.removeAttribute(TARGET_MARKER_ATTR);
      (clonedTarget as HTMLElement).removeAttribute(TARGET_MARKER_ATTR);

      const pathNodes: Element[] = [];
      const pathSet = new Set<Element>();
      let current: Element | null = clonedTarget;
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
        const pathNode = pathNodes[index] as HTMLElement;
        const childElements = Array.from(pathNode.children);
        for (const child of childElements) {
          if (pathSet.has(child)) continue;
          prunedNodeCount += pruneSiblingSubtree(child);
        }
      }

      const boundarySizeBefore = stripNoise(boundaryHtmlElement.outerHTML).length;
      const boundarySizeAfter = stripNoise((boundaryClone as HTMLElement).outerHTML || '').length;

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
        redacted = (boundaryClone as HTMLElement).outerHTML || '';
      } catch {
        redacted = redactSnapshot(stripNoise((boundaryClone as HTMLElement).outerHTML || ''));
      }
      telemetry.redactMs += excerptNowMs() - redactStartedAt;

      if (strategy === 'focused') {
        return redacted.slice(0, maxChars);
      }

      return redacted.length <= maxChars
        ? redacted
        : redacted.slice(0, maxChars);
    } catch (error) {
      console.warn('[AIR] [RESOLVER] Excerpt pruning failed, using legacy excerpt behavior', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      targetHtmlElement.removeAttribute(TARGET_MARKER_ATTR);
      if (clonedTarget) {
        (clonedTarget as HTMLElement).removeAttribute(TARGET_MARKER_ATTR);
      }
    }
  };

  const serializeFromElement = (
    targetElement: Element,
    strategy: 'max-context' | 'focused' = 'max-context'
  ): string => {
    const pruned = serializePrunedBoundary(targetElement, strategy);
    if (typeof pruned === 'string' && pruned.length > 0) {
      return pruned;
    }
    return legacySerializeFromElement(targetElement, strategy);
  };

  const fallbackDocumentExcerpt = (): string => {
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

    const interactiveCandidates: Element[] = [];
    const seenCandidates = new Set<Element>();
    const addCandidate = (element: Element | null): void => {
      if (!element) return;
      if (seenCandidates.has(element)) return;
      seenCandidates.add(element);
      interactiveCandidates.push(element);
    };

    for (const selector of interactiveSelectors) {
      try {
        const matches = Array.from(snapshot.querySelectorAll(selector)).slice(0, 4);
        for (const match of matches) {
          addCandidate(match);
        }
      } catch {
        // Ignore invalid selector errors and continue probing.
      }
    }

    if (interactiveCandidates.length > 0) {
      const ranked = interactiveCandidates
        .map(element => ({
          element,
          score: evaluateIntentMatch(element, step).score,
        }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0]?.element;
      if (best) {
        return serializeFromElement(best, 'focused');
      }
    }

    const root = (snapshot.body || snapshot.documentElement) as Element | null;
    if (root) {
      try {
        const redactStartedAt = excerptNowMs();
        const redacted = serializeRedactedElement(root).slice(0, maxChars);
        telemetry.redactMs += excerptNowMs() - redactStartedAt;
        return redacted;
      } catch {
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

  const finalizeExcerpt = (
    excerpt: string,
    mode: 'target-selector' | 'seed-element' | 'document-fallback',
  ): {
    excerpt: string;
    mode: 'target-selector' | 'seed-element' | 'document-fallback';
    metrics: {
      excerptBuildTotalMs: number;
      pruneMs: number;
      redactMs: number;
      finalExcerptChars: number;
    };
  } => {
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
  if (targetSelector && isLikelyCssSelector(targetSelector)) {
    try {
      const targetElement = snapshot.querySelector(targetSelector);
      if (targetElement) {
        return finalizeExcerpt(
          serializeFromElement(targetElement),
          'target-selector',
        );
      }
    } catch {
      // Ignore and continue with seed search.
    }
  }

  const seedElements = findSeedElements(step, snapshot);
  if (seedElements.length > 0) {
    const rankedSeed = seedElements
      .map(element => ({
        element,
        score: evaluateIntentMatch(element, step).score,
      }))
      .sort((a, b) => b.score - a.score)[0]?.element;

    if (rankedSeed) {
      return finalizeExcerpt(
        serializeFromElement(rankedSeed),
        'seed-element',
      );
    }
  }

  return finalizeExcerpt(
    fallbackDocumentExcerpt(),
    'document-fallback',
  );
}
