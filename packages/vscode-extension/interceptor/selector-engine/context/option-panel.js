import {
  buildAttributeSelector,
  getSafeClassTokens,
  isLikelyDynamicId,
  normalizeText,
  safeCssEscape,
  safeTrim,
} from '../utils.js';
import { resolveAccessibilityEvidence } from '../accessibility/role-name.js';
import { resolveCanonicalCustomControlTargetInternal } from '../canonical-target.js';

const PANEL_CONTAINER_ROLES = new Set([
  'listbox',
  'menu',
  'tree',
  'tablist',
  'group',
  'grid',
]);
const PANEL_ITEM_ROLES = new Set([
  'option',
  'menuitem',
  'menuitemradio',
  'menuitemcheckbox',
  'treeitem',
  'tab',
]);
const PANEL_CONTAINER_TAGS = new Set([
  'select',
  'datalist',
  'menu',
  'ul',
  'ol',
  'nav',
]);
const STOP_TAGS = new Set([
  'body',
  'html',
  'main',
  'form',
  'dialog',
]);
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"], legend, label';
const MAX_CONTAINER_DEPTH = 6;
const MAX_PARENT_TRIGGER_SCAN = 5;

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

function getRole(element) {
  return safeTrim(element?.getAttribute?.('role') || '').toLowerCase() || null;
}

function summarizeTarget(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  const classes = getSafeClassTokens(element).slice(0, 3);
  return {
    tagName: element.tagName?.toLowerCase?.() || null,
    role: getRole(element),
    classList: classes.length > 0 ? classes.join(' ') : null,
    textExcerpt: normalizeText(element.innerText || element.textContent || '').slice(0, 80) || null,
  };
}

function normalizeLabelText(value) {
  const normalized = normalizeText(value)
    .replace(/[:*]\s*$/, '')
    .trim();
  return normalized || null;
}

function escapeTextLiteral(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
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

function inferPanelItemRole(target, accessibilityProof) {
  const explicitRole = getRole(target);
  if (explicitRole && PANEL_ITEM_ROLES.has(explicitRole)) return explicitRole;

  const tagName = target?.tagName?.toLowerCase?.() || '';
  if (tagName === 'option') return 'option';
  if (tagName === 'a' && target?.closest?.('[role="menu"]')) return 'menuitem';
  if (tagName === 'button' && target?.closest?.('[role="menu"]')) return 'menuitem';
  if (accessibilityProof?.role && PANEL_ITEM_ROLES.has(accessibilityProof.role)) {
    return accessibilityProof.role;
  }
  return null;
}

function isPanelContainer(element) {
  const role = getRole(element);
  if (role && PANEL_CONTAINER_ROLES.has(role)) return true;
  const tagName = element?.tagName?.toLowerCase?.() || '';
  return PANEL_CONTAINER_TAGS.has(tagName);
}

function findPanelContainer(target) {
  let current = target;
  let depth = 0;

  while (current && depth < MAX_CONTAINER_DEPTH) {
    if (isPanelContainer(current)) {
      return current;
    }

    const tagName = current.tagName?.toLowerCase?.() || '';
    if (STOP_TAGS.has(tagName)) break;
    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function findContainerLabel(container) {
  if (!container || container.nodeType !== Node.ELEMENT_NODE) {
    return {
      containerLabelText: null,
      containerLabelSource: 'none',
    };
  }

  const ariaLabel = normalizeLabelText(container.getAttribute?.('aria-label') || '');
  if (ariaLabel) {
    return {
      containerLabelText: ariaLabel,
      containerLabelSource: 'aria-label',
    };
  }

  const ariaLabelledBy = safeTrim(container.getAttribute?.('aria-labelledby') || '');
  if (ariaLabelledBy) {
    const referenced = extractReferencedText(container.ownerDocument || document, ariaLabelledBy);
    if (referenced) {
      return {
        containerLabelText: referenced,
        containerLabelSource: 'aria-labelledby',
      };
    }
  }

  try {
    const heading = Array.from(container.querySelectorAll(HEADING_SELECTOR))
      .find((candidate) => isFastVisible(candidate) && normalizeLabelText(candidate.textContent || ''));
    const text = normalizeLabelText(heading?.textContent || '');
    if (text) {
      return {
        containerLabelText: text,
        containerLabelSource: 'heading',
      };
    }
  } catch {
    // Fail closed.
  }

  return {
    containerLabelText: null,
    containerLabelSource: 'none',
  };
}

function isTriggerLike(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE || isFastVisible(element) === false) return false;
  const role = getRole(element);
  const tagName = element.tagName?.toLowerCase?.() || '';
  const hasPopup = safeTrim(element.getAttribute?.('aria-haspopup') || '').toLowerCase();

  if (hasPopup) return true;
  if (role === 'combobox') return true;
  if (role === 'button' && hasPopup) return true;
  if (tagName === 'button' && hasPopup) return true;
  if (tagName === 'select') return true;
  if (tagName === 'input' && role === 'combobox') return true;
  return false;
}

function hasIdReferenceToken(element, attributeName, targetId) {
  const value = safeTrim(element?.getAttribute?.(attributeName) || '');
  if (!value || !targetId) return false;
  return value.split(/\s+/).filter(Boolean).includes(targetId);
}

function collectTriggerCandidates(documentRef, container) {
  const containerId = safeTrim(container?.id || '');
  const candidates = [];

  if (documentRef && containerId) {
    const elements = Array.from(documentRef.querySelectorAll('[aria-controls], [aria-owns]'));
    for (const candidate of elements) {
      if (!isTriggerLike(candidate)) continue;
      if (
        hasIdReferenceToken(candidate, 'aria-controls', containerId)
        || hasIdReferenceToken(candidate, 'aria-owns', containerId)
      ) {
        candidates.push(candidate);
      }
    }
  }

  let parent = container?.parentElement || null;
  let depth = 0;
  while (parent && depth < MAX_PARENT_TRIGGER_SCAN && candidates.length === 0) {
    for (const sibling of Array.from(parent.children || [])) {
      if (sibling === container || sibling.contains?.(container)) continue;
      if (isTriggerLike(sibling)) candidates.push(sibling);
    }
    parent = parent.parentElement;
    depth += 1;
  }

  return candidates.filter((candidate, index, list) => list.indexOf(candidate) === index);
}

function buildContainerSummary(container) {
  if (!container || container.nodeType !== Node.ELEMENT_NODE) return null;
  const role = getRole(container);
  if (role) return role;
  const tagName = container.tagName?.toLowerCase?.() || 'div';
  const classToken = getSafeClassTokens(container)[0];
  return classToken ? `${tagName}.${classToken}` : tagName;
}

function getBestStableClassToken(element) {
  const tokens = getSafeClassTokens(element)
    .filter((token) => !/^(?:is|has)-/i.test(token))
    .filter((token) => !/^(?:css-|sc-)/i.test(token))
    .filter((token) => token.length >= 4)
    .sort((left, right) => left.length - right.length);
  return tokens[0] || null;
}

function buildSelectorForElement(element, options = {}) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  const tagName = element.tagName?.toLowerCase?.() || '';
  if (!tagName) return null;

  for (const attrName of options.preferredAttributes || ['data-testid', 'data-cy', 'data-qa']) {
    const selector = buildAttributeSelector(
      options.tagScoped === false ? null : tagName,
      attrName,
      element.getAttribute(attrName),
      { tagScoped: options.tagScoped !== false },
    );
    if (selector) return selector;
  }

  if (element.id && !isLikelyDynamicId(element.id)) {
    return `#${safeCssEscape(element.id)}`;
  }

  if (options.allowHref && tagName === 'a') {
    const hrefSelector = buildAttributeSelector(tagName, 'href', element.getAttribute('href'));
    if (hrefSelector) return hrefSelector;
  }

  if (options.allowValue && tagName === 'option') {
    const valueSelector = buildAttributeSelector(tagName, 'value', element.getAttribute('value'));
    if (valueSelector) return valueSelector;
  }

  if (options.allowRole !== false) {
    const role = getRole(element);
    if (role) return `${tagName}[role="${escapeTextLiteral(role)}"]`;
  }

  const classToken = getBestStableClassToken(element);
  if (classToken) return `${tagName}.${safeCssEscape(classToken)}`;

  return tagName;
}

function buildTriggerSelector(trigger, containerId) {
  if (!trigger || trigger.nodeType !== Node.ELEMENT_NODE) return null;
  const tagName = trigger.tagName?.toLowerCase?.() || '';
  if (!tagName) return null;

  if (containerId && hasIdReferenceToken(trigger, 'aria-controls', containerId)) {
    return buildAttributeSelector(tagName, 'aria-controls', containerId);
  }
  if (containerId && hasIdReferenceToken(trigger, 'aria-owns', containerId)) {
    return buildAttributeSelector(tagName, 'aria-owns', containerId);
  }

  return buildSelectorForElement(trigger, {
    allowHref: true,
    allowRole: true,
  });
}

function collectVisibleItemTargets(container, itemRole, targetTagName) {
  if (!container || container.nodeType !== Node.ELEMENT_NODE) return [];
  const selectors = [];
  if (itemRole) {
    selectors.push(`[role="${escapeTextLiteral(itemRole)}"]`);
  }
  if (targetTagName) {
    selectors.push(targetTagName);
  }

  const seen = new Set();
  const matches = [];
  for (const selector of selectors) {
    try {
      const elements = Array.from(container.querySelectorAll(selector)).filter(isFastVisible);
      for (const element of elements) {
        if (seen.has(element)) continue;
        seen.add(element);
        matches.push(element);
      }
    } catch {
      // Ignore invalid synthetic selector cases.
    }
  }
  return matches;
}

function countVisibleMatches(root, selector) {
  if (!root || typeof root.querySelectorAll !== 'function' || !selector) return 0;
  try {
    return Array.from(root.querySelectorAll(selector)).filter(isFastVisible).length;
  } catch {
    return 0;
  }
}

function countDuplicateItemText(visibleItems, targetText) {
  const normalizedTargetText = normalizeLabelText(targetText || '');
  if (!normalizedTargetText) return 0;
  return visibleItems.filter((item) => (
    normalizeLabelText(item.textContent || '') === normalizedTargetText
  )).length;
}

export function resolveOptionPanelContextEvidence({
  element,
  eventContext,
  canonicalTargetInfo,
  accessibilityEvidence,
} = {}) {
  const rawTarget = element || null;
  if (!rawTarget || rawTarget.nodeType !== Node.ELEMENT_NODE || rawTarget.isConnected === false) {
    return {
      rawTargetSummary: summarizeTarget(rawTarget),
      effectiveTargetSummary: null,
      proofTargetSummary: null,
      usedCanonicalTarget: false,
      itemRole: null,
      itemName: null,
      itemNameSource: 'none',
      containerRole: null,
      containerLabelText: null,
      containerLabelSource: 'none',
      containerSummary: null,
      containerSelector: null,
      itemSelector: null,
      scopedItemSelector: null,
      scopedTextSelector: null,
      triggerSummary: null,
      triggerSelector: null,
      triggerRelation: 'none',
      triggerBlockedReason: null,
      visibleItemCountInContainer: null,
      targetIndexWithinContainer: null,
      isValid: false,
      blockedReason: 'detached-target',
    };
  }

  const resolvedCanonicalTargetInfo = canonicalTargetInfo?.canonicalTarget
    ? canonicalTargetInfo
    : resolveCanonicalCustomControlTargetInternal(rawTarget, eventContext);
  const effectiveTarget = resolvedCanonicalTargetInfo?.canonicalDiffers && resolvedCanonicalTargetInfo?.canonicalTarget
    ? resolvedCanonicalTargetInfo.canonicalTarget
    : rawTarget;
  const accessibilityProof = accessibilityEvidence || resolveAccessibilityEvidence({
    element: effectiveTarget,
    eventContext,
    canonicalTargetInfo: resolvedCanonicalTargetInfo,
  });
  const itemRole = inferPanelItemRole(effectiveTarget, accessibilityProof);
  const itemName = accessibilityProof?.accessibleName || normalizeLabelText(effectiveTarget.textContent || '');
  const itemNameSource = accessibilityProof?.accessibleNameSource || (itemName ? 'text' : 'none');
  const container = findPanelContainer(effectiveTarget);

  if (!container) {
    return {
      rawTargetSummary: summarizeTarget(rawTarget),
      effectiveTargetSummary: summarizeTarget(effectiveTarget),
      proofTargetSummary: summarizeTarget(effectiveTarget),
      usedCanonicalTarget: resolvedCanonicalTargetInfo?.canonicalDiffers === true,
      itemRole,
      itemName: itemName || null,
      itemNameSource,
      containerRole: null,
      containerLabelText: null,
      containerLabelSource: 'none',
      containerSummary: null,
      containerSelector: null,
      itemSelector: null,
      scopedItemSelector: null,
      scopedTextSelector: null,
      triggerSummary: null,
      triggerSelector: null,
      triggerRelation: 'none',
      triggerBlockedReason: null,
      visibleItemCountInContainer: null,
      targetIndexWithinContainer: null,
      isValid: false,
      blockedReason: 'option-panel-no-container',
    };
  }

  const documentRef = effectiveTarget.ownerDocument || document;
  const containerRole = getRole(container) || (container.tagName?.toLowerCase?.() === 'select' ? 'listbox' : null);
  const { containerLabelText, containerLabelSource } = findContainerLabel(container);
  const containerSelector = buildSelectorForElement(container, {
    allowRole: true,
  });
  const itemSelector = buildSelectorForElement(effectiveTarget, {
    allowHref: true,
    allowValue: true,
    allowRole: true,
  });
  const scopedItemSelector = containerSelector && itemSelector
    ? `${containerSelector} ${itemSelector}`
    : null;
  const scopedTextSelector = scopedItemSelector && itemName && itemName.length <= 80
    ? `${scopedItemSelector}:has-text("${escapeTextLiteral(itemName)}")`
    : null;

  const triggerCandidates = collectTriggerCandidates(documentRef, container);
  const trigger = triggerCandidates.length === 1 ? triggerCandidates[0] : null;
  const triggerRelation = trigger
    ? (hasIdReferenceToken(trigger, 'aria-controls', safeTrim(container.id || ''))
      ? 'aria-controls'
      : (hasIdReferenceToken(trigger, 'aria-owns', safeTrim(container.id || '')) ? 'aria-owns' : 'ancestor-trigger'))
    : 'none';
  const triggerSelector = trigger ? buildTriggerSelector(trigger, safeTrim(container.id || '')) : null;
  const visibleItems = collectVisibleItemTargets(
    container,
    itemRole,
    effectiveTarget.tagName?.toLowerCase?.() || null,
  );
  const targetIndexWithinContainer = visibleItems.indexOf(effectiveTarget);
  const matchingContainerCount = countVisibleMatches(documentRef, containerSelector);
  const itemSelectorMatchCountInContainer = countVisibleMatches(container, itemSelector);
  const duplicateItemTextCount = countDuplicateItemText(visibleItems, itemName);
  const uniquePanelBinding = matchingContainerCount === 1
    || (!!triggerSelector && (triggerRelation === 'aria-controls' || triggerRelation === 'aria-owns'));
  const uniqueTargetBinding = itemSelectorMatchCountInContainer === 1
    || (!!itemName && duplicateItemTextCount === 1);
  const requiresPositionalDisambiguation = !uniqueTargetBinding && targetIndexWithinContainer >= 0;

  const isValid = !!containerSelector && !!itemSelector && !!(itemRole || itemName);
  let blockedReason = null;
  if (!containerSelector) blockedReason = 'option-panel-no-container-selector';
  else if (!itemSelector) blockedReason = 'option-panel-no-item-selector';
  else if (!(itemRole || itemName)) blockedReason = 'option-panel-no-item-name';
  else if (matchingContainerCount > 1 && !uniquePanelBinding) blockedReason = 'option-panel-multiple-panels';
  else if (duplicateItemTextCount > 1 && !uniqueTargetBinding) blockedReason = 'option-panel-duplicate-option-text';

  return {
    rawTargetSummary: summarizeTarget(rawTarget),
    effectiveTargetSummary: summarizeTarget(effectiveTarget),
    proofTargetSummary: summarizeTarget(effectiveTarget),
    usedCanonicalTarget: resolvedCanonicalTargetInfo?.canonicalDiffers === true,
    itemRole,
    itemName: itemName || null,
    itemNameSource,
    containerRole,
    containerLabelText,
    containerLabelSource,
    containerSummary: buildContainerSummary(container),
    containerSelector,
    itemSelector,
    scopedItemSelector,
    scopedTextSelector,
    triggerSummary: summarizeTarget(trigger),
    triggerSelector,
    triggerRelation,
    triggerBlockedReason: triggerCandidates.length > 1 ? 'multiple-triggers' : null,
    visibleItemCountInContainer: visibleItems.length,
    targetIndexWithinContainer: targetIndexWithinContainer >= 0 ? targetIndexWithinContainer : null,
    matchingContainerCount,
    itemSelectorMatchCountInContainer,
    duplicateItemTextCount,
    uniquePanelBinding,
    uniqueTargetBinding,
    requiresPositionalDisambiguation,
    isValid,
    blockedReason,
  };
}
