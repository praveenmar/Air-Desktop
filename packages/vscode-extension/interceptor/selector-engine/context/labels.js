import {
  getSafeClassTokens,
  isLikelyDynamicId,
  normalizeText,
  safeCssEscape,
  safeTrim,
} from '../utils.js';

const MAX_CONTAINER_DEPTH = 5;
const STOP_TAGS = new Set([
  'body',
  'html',
  'main',
  'section',
  'article',
  'table',
  'tbody',
  'thead',
  'form',
]);
const INPUT_LIKE_SELECTOR = [
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[role="spinbutton"]',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');
const TRIGGER_LIKE_SELECTOR = [
  'select',
  '[role="combobox"]',
  '[role="button"][aria-haspopup]',
  '[aria-haspopup="listbox"]',
  '[aria-haspopup="combobox"]',
  'button[aria-haspopup]',
  'input[role="combobox"]',
  '[contenteditable="true"]',
].join(', ');
const LABEL_CANDIDATE_SELECTOR = 'label, legend, span, div, p';

function isFastVisible(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  if (element.isConnected === false) return false;
  if (element.hidden) return false;
  if (element.getAttribute?.('aria-hidden') === 'true') return false;

  const inlineStyle = element.style || null;
  if (inlineStyle && (inlineStyle.display === 'none' || inlineStyle.visibility === 'hidden')) {
    return false;
  }

  return true;
}

function normalizeLabelText(value) {
  const normalized = normalizeText(value)
    .replace(/[:*]\s*$/, '')
    .trim();
  return normalized || null;
}

function getRole(element) {
  return safeTrim(element?.getAttribute?.('role') || '').toLowerCase();
}

function summarizeTarget(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;

  const classes = getSafeClassTokens(element).slice(0, 3);
  return {
    tagName: element.tagName?.toLowerCase?.() || null,
    role: getRole(element) || null,
    classList: classes.length > 0 ? classes.join(' ') : null,
    textExcerpt: normalizeText(element.innerText || element.textContent || '').slice(0, 80) || null,
    tabIndex: element.getAttribute?.('tabindex') ?? null,
  };
}

function resolveControlKind(element, eventContext) {
  const tagName = element?.tagName?.toLowerCase?.() || '';
  const role = getRole(element);
  const inputType = safeTrim(element?.getAttribute?.('type') || '').toLowerCase();
  const hasPopup = safeTrim(element?.getAttribute?.('aria-haspopup') || '').toLowerCase();
  const contentEditable = safeTrim(element?.getAttribute?.('contenteditable') || '').toLowerCase();
  const eventType = safeTrim(eventContext?.eventType || '');

  if (tagName === 'textarea') return 'textarea';
  if (tagName === 'select') return 'select';
  if (tagName === 'input' && inputType !== 'hidden') {
    if (inputType === 'search' || role === 'searchbox') return 'searchbox';
    return 'input';
  }
  if (role === 'combobox') return 'combobox';
  if (role === 'searchbox') return 'searchbox';
  if (role === 'textbox' || role === 'spinbutton') return role;
  if (element?.isContentEditable || (element?.hasAttribute?.('contenteditable') && contentEditable !== 'false')) {
    return 'contenteditable';
  }
  if (
    eventType === 'custom-control-open' ||
    eventType === 'custom-select' ||
    hasPopup === 'listbox' ||
    hasPopup === 'combobox'
  ) {
    return 'custom-trigger';
  }
  return null;
}

function resolveEffectiveTarget(element, canonicalTargetInfo) {
  if (canonicalTargetInfo?.canonicalDiffers && canonicalTargetInfo?.canonicalTarget) {
    return canonicalTargetInfo.canonicalTarget;
  }
  return element;
}

function extractReferencedText(documentRef, idList) {
  if (!documentRef || typeof idList !== 'string') return null;
  const parts = [];
  for (const refId of idList.split(/\s+/).filter(Boolean)) {
    const ref = documentRef.getElementById?.(refId);
    const text = normalizeLabelText(ref?.textContent || '');
    if (!text) continue;
    if (!parts.includes(text)) parts.push(text);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function collectExplicitLabelProof(target) {
  const documentRef = target?.ownerDocument || document;
  const ariaLabelledBy = target?.getAttribute?.('aria-labelledby');
  if (ariaLabelledBy) {
    const text = extractReferencedText(documentRef, ariaLabelledBy);
    if (text) {
      return {
        fieldLabelText: text,
        fieldRelation: 'aria-labelledby',
        labelElement: null,
      };
    }
  }

  if (target?.id) {
    try {
      const label = documentRef.querySelector(`label[for="${safeCssEscape(target.id)}"]`);
      const text = normalizeLabelText(label?.textContent || '');
      if (label && text) {
        return {
          fieldLabelText: text,
          fieldRelation: 'label-for',
          labelElement: label,
        };
      }
    } catch {
      // Fail closed.
    }
  }

  const wrappedLabel = target?.closest?.('label') || null;
  const wrappedText = normalizeLabelText(wrappedLabel?.textContent || '');
  if (wrappedLabel && wrappedText) {
    return {
      fieldLabelText: wrappedText,
      fieldRelation: 'wrapped-label',
      labelElement: wrappedLabel,
    };
  }

  return null;
}

function queryVisibleElements(root, selector) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  try {
    return Array.from(root.querySelectorAll(selector)).filter(isFastVisible);
  } catch {
    return [];
  }
}

function getVisibleControlLikeTargets(root, controlKind) {
  if (!root || !controlKind) return [];
  if (controlKind === 'custom-trigger') {
    return queryVisibleElements(root, TRIGGER_LIKE_SELECTOR);
  }
  return queryVisibleElements(root, INPUT_LIKE_SELECTOR);
}

function findContainerLabelCandidates(container, target) {
  const targetText = normalizeLabelText(target?.textContent || '');
  const candidates = queryVisibleElements(container, LABEL_CANDIDATE_SELECTOR)
    .filter((candidate) => !candidate.contains(target))
    .map((candidate) => ({
      element: candidate,
      text: normalizeLabelText(candidate.textContent || ''),
    }))
    .filter((entry) => !!entry.text)
    .filter((entry) => entry.text.length <= 80)
    .filter((entry) => entry.text !== targetText)
    .filter((entry) => !/^(?:select|choose|search|open)$/i.test(entry.text));

  return candidates.filter((entry) => (
    !candidates.some((other) => other !== entry && other.element.contains(entry.element))
  ));
}

function buildContainerSummary(container) {
  if (!container || container.nodeType !== Node.ELEMENT_NODE) return null;
  const tagName = container.tagName?.toLowerCase?.() || 'div';
  const classToken = getSafeClassTokens(container)[0];
  if (classToken) return `${tagName}.${classToken}`;
  const role = getRole(container);
  if (role) return `${tagName}[role="${role}"]`;
  return tagName;
}

function isFrameworkClassToken(token) {
  return /^(?:oxd-|mui|ant-|chakra-|radix-|headlessui-)/i.test(String(token || ''));
}

function isGenericShellClassToken(token) {
  return /^(?:container|wrapper|row|item|content|layout|shell|panel|section|body|header|footer)$/i.test(String(token || ''));
}

function isStateClassToken(token) {
  const normalized = String(token || '').toLowerCase();
  if (!normalized) return false;
  if (/^(?:is|has)-[a-z0-9:_-]+$/i.test(normalized)) return true;
  if (/--(?:focus|focused|active|selected|open|disabled|hover|loading|expanded|collapsed|current|checked|invalid|valid|dirty|touched|visited|state)$/i.test(normalized)) {
    return true;
  }
  return /(?:^|[-_])(?:focus|focused|active|selected|open|disabled|hover|loading|expanded|collapsed|current|checked|invalid|valid|dirty|touched|visited|state)(?:$|[-_])/i.test(normalized);
}

function isDynamicClassToken(token) {
  return isStateClassToken(token) || /^(?:css-|sc-)/i.test(String(token || ''));
}

function getBestStableClassToken(element) {
  const tokens = getSafeClassTokens(element)
    .filter((token) => !isDynamicClassToken(token))
    .filter((token) => !isGenericShellClassToken(token))
    .sort((left, right) => left.length - right.length);

  if (tokens.length === 0) return null;
  return tokens[0];
}

function deriveContainerSelectorCandidates(container) {
  if (!container || container.nodeType !== Node.ELEMENT_NODE) {
    return {
      cleanParentSelector: null,
      containerSelector: null,
      boundedContainerSelectorCandidates: [],
    };
  }

  const tagName = container.tagName?.toLowerCase?.() || 'div';
  const candidates = [];
  const pushCandidate = (selector, isClean) => {
    if (!selector) return;
    if (candidates.some((entry) => entry.selector === selector)) return;
    candidates.push({ selector, isClean });
  };

  const dataTestId = container.getAttribute('data-testid');
  if (dataTestId) pushCandidate(`[data-testid="${dataTestId.replace(/"/g, '\\"')}"]`, true);

  for (const attrName of ['data-cy', 'data-qa']) {
    const attrValue = container.getAttribute(attrName);
    if (attrValue) pushCandidate(`${tagName}[${attrName}="${attrValue.replace(/"/g, '\\"')}"]`, true);
  }

  if (container.id && !isLikelyDynamicId(container.id)) {
    pushCandidate(`#${safeCssEscape(container.id)}`, true);
  }

  const classToken = getBestStableClassToken(container);
  if (classToken) {
    pushCandidate(`${tagName}.${safeCssEscape(classToken)}`, !isFrameworkClassToken(classToken));
  }

  const cleanParentSelector = candidates.find((entry) => entry.isClean)?.selector || null;
  const containerSelector = cleanParentSelector || candidates[0]?.selector || null;

  return {
    cleanParentSelector,
    containerSelector,
    boundedContainerSelectorCandidates: candidates,
  };
}

function buildChildSelector(target, selectorResult, controlKind) {
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;
  const tagName = target.tagName?.toLowerCase?.() || '';
  if (!tagName) return null;

  const attributeSelector = (() => {
    for (const attrName of ['data-testid', 'data-cy', 'data-qa']) {
      const attrValue = target.getAttribute(attrName);
      if (attrValue) return `${tagName}[${attrName}="${attrValue.replace(/"/g, '\\"')}"]`;
    }

    const name = target.getAttribute('name');
    if (name) return `${tagName}[name="${name.replace(/"/g, '\\"')}"]`;

    const ariaLabel = target.getAttribute('aria-label');
    if (ariaLabel) return `${tagName}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;

    const role = getRole(target);
    const hasPopup = safeTrim(target.getAttribute('aria-haspopup') || '').toLowerCase();
    if (role === 'combobox') return `${tagName}[role="combobox"]`;
    if (role === 'button' && hasPopup) {
      return `${tagName}[role="button"][aria-haspopup="${hasPopup.replace(/"/g, '\\"')}"]`;
    }
    if (controlKind === 'custom-trigger' && (hasPopup === 'listbox' || hasPopup === 'combobox')) {
      return `${tagName}[aria-haspopup="${hasPopup.replace(/"/g, '\\"')}"]`;
    }

    return null;
  })();
  if (attributeSelector) return attributeSelector;

  const classToken = getBestStableClassToken(target);
  if (classToken) return `${tagName}.${safeCssEscape(classToken)}`;

  const primarySelector = safeTrim(selectorResult?.selector || '');
  if (
    primarySelector &&
    !primarySelector.includes(',') &&
    !primarySelector.includes(':has-text(') &&
    !primarySelector.startsWith('//') &&
    !primarySelector.startsWith('xpath=')
  ) {
    return primarySelector;
  }

  return tagName;
}

function countDocumentLabelDuplicates(target, fieldLabelText) {
  const documentRef = target?.ownerDocument || document;
  const normalized = normalizeLabelText(fieldLabelText || '');
  if (!documentRef || !normalized) return 0;
  const labels = queryVisibleElements(documentRef, LABEL_CANDIDATE_SELECTOR);
  return labels.filter((label) => normalizeLabelText(label.textContent || '') === normalized).length;
}

function findBoundedContainerProof(scopeTarget, childTarget, selectorResult, controlKind) {
  let current = scopeTarget?.parentElement || null;
  let depth = 0;

  while (current && depth < MAX_CONTAINER_DEPTH) {
    const tagName = current.tagName?.toLowerCase?.() || '';
    if (STOP_TAGS.has(tagName)) break;

    const labelCandidates = findContainerLabelCandidates(current, childTarget);
    const controls = getVisibleControlLikeTargets(current, controlKind);
    const targetIndex = controls.indexOf(scopeTarget);

    if (labelCandidates.length > 1 && targetIndex >= 0) {
      return {
        isValid: false,
        blockedReason: 'duplicate-container-labels',
        warningCodes: ['duplicate-container-labels'],
      };
    }

    if (labelCandidates.length === 1 && controls.length === 1 && targetIndex === 0) {
      const selectors = deriveContainerSelectorCandidates(current);
      const fieldLabelText = labelCandidates[0].text;
      return {
        fieldLabelText,
        fieldRelation: 'bounded-container',
        visibleControlCountInContainer: 1,
        competingControlCount: 0,
        targetIndexWithinContainer: 0,
        duplicateLabelCount: countDocumentLabelDuplicates(scopeTarget, fieldLabelText),
        boundedContainerSummary: buildContainerSummary(current),
        cleanParentSelector: selectors.cleanParentSelector,
        cleanChildSelector: buildChildSelector(childTarget, selectorResult, controlKind),
        containerSelector: selectors.containerSelector,
        boundedContainerSelectorCandidates: selectors.boundedContainerSelectorCandidates,
        warningCodes: [],
        isValid: true,
        blockedReason: null,
      };
    }

    if (labelCandidates.length === 1 && targetIndex >= 0 && controls.length > 1) {
      return {
        isValid: false,
        blockedReason: 'multiple-control-like-targets',
        warningCodes: ['multiple-control-like-targets'],
      };
    }

    current = current.parentElement;
    depth += 1;
  }

  return {
    isValid: false,
    blockedReason: 'no-bounded-label-context',
    warningCodes: [],
  };
}

export function resolveLabelContextEvidence({
  element,
  selectorResult,
  eventContext,
  canonicalTargetInfo,
} = {}) {
  const rawTarget = element || null;
  const effectiveTarget = resolveEffectiveTarget(rawTarget, canonicalTargetInfo);
  const rawTargetSummary = summarizeTarget(rawTarget);
  const effectiveTargetSummary = summarizeTarget(effectiveTarget);
  const targetControlKind = resolveControlKind(effectiveTarget, eventContext);
  const scopeTarget = targetControlKind === 'custom-trigger' ? rawTarget : effectiveTarget;
  const base = {
    rawTarget,
    effectiveTarget,
    rawTargetSummary,
    effectiveTargetSummary,
    usedCanonicalTarget: effectiveTarget !== rawTarget,
    targetControlKind,
    fieldLabelText: null,
    fieldRelation: null,
    visibleControlCountInContainer: null,
    competingControlCount: null,
    targetIndexWithinContainer: null,
    duplicateLabelCount: null,
    boundedContainerSummary: null,
    cleanParentSelector: null,
    cleanChildSelector: null,
    containerSelector: null,
    boundedContainerSelectorCandidates: [],
    warningCodes: [],
    isValid: false,
    blockedReason: null,
  };

  if (!rawTarget || rawTarget.nodeType !== Node.ELEMENT_NODE || rawTarget.isConnected === false) {
    return {
      ...base,
      blockedReason: 'detached-target',
      warningCodes: ['detached-target'],
    };
  }

  if (!effectiveTarget || effectiveTarget.nodeType !== Node.ELEMENT_NODE || effectiveTarget.isConnected === false) {
    return {
      ...base,
      blockedReason: 'detached-effective-target',
      warningCodes: ['detached-effective-target'],
    };
  }

  if (!targetControlKind) {
    return {
      ...base,
      blockedReason: 'unsupported-control-kind',
      warningCodes: ['unsupported-control-kind'],
    };
  }

  const explicitProof = collectExplicitLabelProof(effectiveTarget);
  if (explicitProof?.fieldLabelText) {
    return {
      ...base,
      fieldLabelText: explicitProof.fieldLabelText,
      fieldRelation: explicitProof.fieldRelation,
      duplicateLabelCount: countDocumentLabelDuplicates(scopeTarget, explicitProof.fieldLabelText),
      cleanChildSelector: buildChildSelector(effectiveTarget, selectorResult, targetControlKind),
      isValid: true,
    };
  }

  const boundedProof = findBoundedContainerProof(
    scopeTarget,
    effectiveTarget,
    selectorResult,
    targetControlKind,
  );
  return {
    ...base,
    fieldLabelText: boundedProof.fieldLabelText || null,
    fieldRelation: boundedProof.fieldRelation || null,
    visibleControlCountInContainer: boundedProof.visibleControlCountInContainer ?? null,
    competingControlCount: boundedProof.competingControlCount ?? null,
    targetIndexWithinContainer: boundedProof.targetIndexWithinContainer ?? null,
    duplicateLabelCount: boundedProof.duplicateLabelCount ?? null,
    boundedContainerSummary: boundedProof.boundedContainerSummary || null,
    cleanParentSelector: boundedProof.cleanParentSelector || null,
    cleanChildSelector: boundedProof.cleanChildSelector || null,
    containerSelector: boundedProof.containerSelector || null,
    boundedContainerSelectorCandidates: boundedProof.boundedContainerSelectorCandidates || [],
    warningCodes: Array.isArray(boundedProof.warningCodes) ? boundedProof.warningCodes : [],
    isValid: boundedProof.isValid === true,
    blockedReason: boundedProof.blockedReason || null,
  };
}
