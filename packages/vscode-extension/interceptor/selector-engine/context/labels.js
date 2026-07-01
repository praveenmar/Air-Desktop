import {
  buildAttributeSelector,
  getSafeClassTokens,
  isLikelyDynamicId,
  normalizeText,
  safeCssEscape,
  safeTrim,
} from '../utils.js';
import { resolveCanonicalCustomControlTargetInternal } from '../canonical-target.js';
import { isFastVisible, queryVisibleElements, queryVisibleElementsPiercingShadow } from '../shared/visibility.js';
import { getRole } from '../shared/dom-attributes.js';
import { normalizeLabelText, extractReferencedText } from '../shared/text.js';
import { summarizeTarget as _summarizeTarget } from '../shared/target-summary.js';

function summarizeTarget(element) {
  return _summarizeTarget(element, { includeClassList: true, includeTabIndex: true });
}

const MAX_CONTAINER_DEPTH = 5;
const STOP_TAGS = new Set([
  'body',
  'html',
  'main',
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
  '.select-trigger',
  '.oxd-select-text',
  '.oxd-select-wrapper',
].join(', ');
const LABEL_CANDIDATE_SELECTOR = 'label, legend, span, div, p';

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
      const labelSelector = buildAttributeSelector('label', 'for', target.id);
      const label = labelSelector ? documentRef.querySelector(labelSelector) : null;
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

function getVisibleControlLikeTargets(root, controlKind) {
  if (!root || !controlKind) return [];
  const selector = controlKind === 'custom-trigger' ? TRIGGER_LIKE_SELECTOR : INPUT_LIKE_SELECTOR;
  const matches = queryVisibleElements(root, selector);
  return matches.filter((match) => !matches.some((other) => other !== match && other.contains(match)));
}

function buildAncestorPath(element) {
  const path = [];
  let current = element || null;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    path.push(current);
    current = current.parentElement || null;
  }
  return path;
}

function getDomDistance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  if (left === right) return 0;

  const leftPath = buildAncestorPath(left);
  const rightPath = buildAncestorPath(right);
  for (let leftIndex = 0; leftIndex < leftPath.length; leftIndex += 1) {
    const sharedIndex = rightPath.indexOf(leftPath[leftIndex]);
    if (sharedIndex >= 0) {
      return leftIndex + sharedIndex;
    }
  }

  return leftPath.length + rightPath.length;
}

function collectControlStateTexts(controls) {
  const texts = new Set();
  for (const control of controls || []) {
    const normalized = normalizeLabelText(control?.textContent || '');
    if (normalized && normalized.length <= 80) texts.add(normalized);
  }
  return Array.from(texts);
}

function hasSelectorMatch(root, selector) {
  if (!root || typeof root.querySelector !== 'function') return false;
  try {
    return !!root.querySelector(selector);
  } catch {
    return false;
  }
}

function isAggregateWrapperCandidate(element, entryText, controlTexts) {
  if (!element || !entryText) return false;

  if (element.children.length > 1 && element.tagName?.toLowerCase?.() !== 'label') {
    return true;
  }

  return controlTexts.some((controlText) => (
    controlText
    && controlText.length >= 3
    && controlText !== entryText
    && entryText.includes(controlText)
  ));
}

function findContainerLabelCandidates(container, target, controlBoundary, controls = [], targetControl = null) {
  const targetText = normalizeLabelText(target?.textContent || '');
  const boundary = controlBoundary || target;
  const controlTexts = collectControlStateTexts(controls);

  const rawCandidates = queryVisibleElements(container, LABEL_CANDIDATE_SELECTOR)
    .filter((candidate) => !candidate.contains(boundary) && !boundary.contains(candidate))
    .map((candidate) => ({
      element: candidate,
      text: normalizeLabelText(candidate.textContent || ''),
      tagName: candidate.tagName?.toLowerCase?.() || '',
    }))
    .filter((entry) => !!entry.text)
    .filter((entry) => entry.text.length <= 80)
    .filter((entry) => entry.text !== targetText)
    .filter((entry) => !/^(?:select|choose|search|open)$/i.test(entry.text));

  const scoredCandidates = rawCandidates.map((entry) => {
    const isTrueLabel = entry.tagName === 'label' || entry.tagName === 'legend';
    const hasControlDescendants = (
      entry.element.children.length > 0
      && (hasSelectorMatch(entry.element, INPUT_LIKE_SELECTOR) || hasSelectorMatch(entry.element, TRIGGER_LIKE_SELECTOR))
    );
    const hasOptionDescendants = hasSelectorMatch(entry.element, '[role="option"], [role="menuitem"], .oxd-select-option, .oxd-dropdown-menu');
    const isAggregateWrapper = !isTrueLabel && isAggregateWrapperCandidate(entry.element, entry.text, controlTexts);
    const sameParentAsControl = !!(targetControl && entry.element.parentElement === targetControl.parentElement);
    const isPrecedingControl = !!(
      targetControl
      && !!(entry.element.compareDocumentPosition(targetControl) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
    const domDistance = targetControl ? getDomDistance(entry.element, targetControl) : Number.POSITIVE_INFINITY;

    let score = 0;
    if (isTrueLabel) score += 20;
    if (entry.text.length < 30) score += 2;
    if (sameParentAsControl) score += 6;
    if (isPrecedingControl) score += 6;
    if (Number.isFinite(domDistance)) score -= Math.min(domDistance, 12);

    return {
      ...entry,
      score,
      isTrueLabel,
      hasControlDescendants,
      hasOptionDescendants,
      isAggregateWrapper,
    };
  });

  const candidates = scoredCandidates.filter((entry) => {
    if (entry.hasControlDescendants || entry.hasOptionDescendants || entry.isAggregateWrapper) {
      return false;
    }

    const containers = scoredCandidates.filter(other => other !== entry && other.element.contains(entry.element));
    if (containers.length > 0) {
      return containers.every(c => entry.score > c.score);
    }
    const descendants = scoredCandidates.filter(other => other !== entry && entry.element.contains(other.element));
    if (descendants.length > 0) {
      return descendants.every(d => entry.score >= d.score);
    }
    return true;
  });

  return candidates.sort((a, b) => b.score - a.score);
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
  const pushCandidate = (selector, kind, isClean) => {
    if (!selector) return;
    if (candidates.some((entry) => entry.selector === selector)) return;
    candidates.push({ selector, kind, isClean });
  };

  const dataTestIdSelector = buildAttributeSelector(null, 'data-testid', container.getAttribute('data-testid'), { tagScoped: false });
  if (dataTestIdSelector) pushCandidate(dataTestIdSelector, 'data-testid', true);

  for (const attrName of ['data-cy', 'data-qa']) {
    const selector = buildAttributeSelector(tagName, attrName, container.getAttribute(attrName));
    if (selector) pushCandidate(selector, attrName, true);
  }

  if (container.id && !isLikelyDynamicId(container.id)) {
    pushCandidate(`#${safeCssEscape(container.id)}`, 'id', true);
  }

  const classToken = getBestStableClassToken(container);
  if (classToken) {
    pushCandidate(
      `${tagName}.${safeCssEscape(classToken)}`,
      isFrameworkClassToken(classToken) ? 'framework-class' : 'semantic-class',
      !isFrameworkClassToken(classToken),
    );
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
      const selector = buildAttributeSelector(tagName, attrName, target.getAttribute(attrName));
      if (selector) return selector;
    }

    const nameSelector = buildAttributeSelector(tagName, 'name', target.getAttribute('name'));
    if (nameSelector) return nameSelector;

    const ariaLabelSelector = buildAttributeSelector(tagName, 'aria-label', target.getAttribute('aria-label'));
    if (ariaLabelSelector) return ariaLabelSelector;

    const role = getRole(target);
    const hasPopup = safeTrim(target.getAttribute('aria-haspopup') || '').toLowerCase();
    if (role === 'combobox') return `${tagName}[role="combobox"]`;
    if (role === 'button' && hasPopup) {
      return `${tagName}[role="button"][aria-haspopup="${hasPopup.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    }
    if (controlKind === 'custom-trigger' && (hasPopup === 'listbox' || hasPopup === 'combobox')) {
      return `${tagName}[aria-haspopup="${hasPopup.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
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

function countDocumentLabelDuplicates(target, fieldLabelText, associatedLabelElement = null) {
  const documentRef = target?.ownerDocument || document;
  const normalized = normalizeLabelText(fieldLabelText || '');
  if (!documentRef || !normalized) return { count: 0, targetIndex: -1 };
  const labels = queryVisibleElementsPiercingShadow(documentRef, LABEL_CANDIDATE_SELECTOR);
  const matchingLabels = labels.filter((label) => normalizeLabelText(label.textContent || '') === normalized);
  let targetIndex = -1;
  if (associatedLabelElement && matchingLabels.length > 0) {
    targetIndex = matchingLabels.indexOf(associatedLabelElement);
  }
  return { count: matchingLabels.length, targetIndex };
}

function resolveControlBoundary(scopeTarget, effectiveTarget, controlKind) {
  const genericSelector = controlKind === 'custom-trigger' ? TRIGGER_LIKE_SELECTOR : INPUT_LIKE_SELECTOR;
  return scopeTarget?.closest?.(genericSelector) || effectiveTarget || scopeTarget || null;
}

function findBoundedContainerProof(scopeTarget, effectiveTarget, childTarget, selectorResult, controlKind) {
  const controlBoundary = resolveControlBoundary(scopeTarget, effectiveTarget, controlKind);

  let current = scopeTarget?.parentElement || null;
  let depth = 0;

  while (current && depth < MAX_CONTAINER_DEPTH) {
    const tagName = current.tagName?.toLowerCase?.() || '';
    if (STOP_TAGS.has(tagName)) break;

    const controls = getVisibleControlLikeTargets(current, controlKind);
    const targetControl = controls.find(
      (control) => control === controlBoundary || control.contains(controlBoundary) || controlBoundary.contains(control),
    );
    const targetIndex = targetControl ? controls.indexOf(targetControl) : -1;
    const strictBoundary = targetControl || controlBoundary;

    const labelCandidates = findContainerLabelCandidates(current, childTarget, strictBoundary, controls, targetControl);
    const topLabel = labelCandidates[0];
    const hasClearWinner = labelCandidates.length === 1
      || (labelCandidates.length > 1 && topLabel.score > labelCandidates[1].score);

    if (labelCandidates.length > 1 && !hasClearWinner && targetIndex >= 0) {
      return {
        isValid: false,
        blockedReason: 'bounded-field-duplicate-label',
        warningCodes: ['bounded-field-duplicate-label'],
      };
    }

    if (labelCandidates.length > 0 && hasClearWinner && controls.length === 1 && targetIndex === 0) {
      const selectors = deriveContainerSelectorCandidates(current);
      const fieldLabelText = topLabel.text;
      const duplicateInfo = countDocumentLabelDuplicates(scopeTarget, fieldLabelText, topLabel.element);
      return {
        fieldLabelText,
        fieldRelation: topLabel.element.parentElement === current ? 'sibling-label' : 'bounded-container',
        visibleControlCountInContainer: 1,
        competingControlCount: 0,
        targetIndexWithinContainer: 0,
        duplicateLabelCount: duplicateInfo.count,
        targetIndexWithinAmbiguity: duplicateInfo.targetIndex,
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

    if (labelCandidates.length > 0 && hasClearWinner && targetIndex >= 0 && controls.length > 1) {
      return {
        isValid: false,
        blockedReason: 'bounded-field-multiple-targets',
        warningCodes: ['bounded-field-multiple-targets'],
      };
    }

    current = current.parentElement;
    depth += 1;
  }

  return {
    isValid: false,
    blockedReason: 'bounded-field-broad-container',
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
  const resolvedCanonicalTargetInfo = canonicalTargetInfo?.canonicalTarget
    ? canonicalTargetInfo
    : resolveCanonicalCustomControlTargetInternal(rawTarget, eventContext);
  const effectiveTarget = resolveEffectiveTarget(rawTarget, resolvedCanonicalTargetInfo);
  const rawTargetSummary = summarizeTarget(rawTarget);
  const effectiveTargetSummary = summarizeTarget(effectiveTarget);
  const targetControlKind = resolveControlKind(effectiveTarget, eventContext);
  const scopeTarget = targetControlKind === 'custom-trigger' ? rawTarget : effectiveTarget;
  const base = {
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
    targetIndexWithinAmbiguity: null,
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
    const duplicateInfo = countDocumentLabelDuplicates(scopeTarget, explicitProof.fieldLabelText, explicitProof.labelElement);
    return {
      ...base,
      fieldLabelText: explicitProof.fieldLabelText,
      fieldRelation: explicitProof.fieldRelation,
      duplicateLabelCount: duplicateInfo.count,
      targetIndexWithinAmbiguity: duplicateInfo.targetIndex,
      cleanChildSelector: buildChildSelector(effectiveTarget, selectorResult, targetControlKind),
      boundedContainerSelectorCandidates: [],
      isValid: true,
    };
  }

  const boundedProof = findBoundedContainerProof(
    scopeTarget,
    effectiveTarget,
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
    targetIndexWithinAmbiguity: boundedProof.targetIndexWithinAmbiguity ?? null,
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
