import { isFastVisible, queryVisibleElements } from '../shared/visibility.js';
import { normalizeLabelText, extractReferencedText } from '../shared/text.js';
import { resolveAccessibilityEvidence } from '../accessibility/role-name.js';
import { getRole } from '../shared/dom-attributes.js';

const MAX_CONTAINER_ANCESTOR_DEPTH = 8;

const ALLOWED_ACTIONS = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="link"]',
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="reset"]',
].join(', ');

function extractActionEvidence(target) {
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;
  if (!target.matches(ALLOWED_ACTIONS)) return null;

  const tagName = target.tagName.toLowerCase();
  const accessibility = resolveAccessibilityEvidence({ element: target });
  let actionName = accessibility.accessibleName;
  let nameSource = accessibility.accessibleNameSource;
  let actionInputType = null;

  if (tagName === 'input') {
    actionInputType = target.getAttribute('type') || null;
    if (!actionName) {
      const val = target.getAttribute('value');
      if (val) {
        actionName = normalizeLabelText(val);
        nameSource = 'value';
      }
    }
  }

  if (!actionName) return null;

  return {
    actionName,
    actionRole: accessibility.role || tagName,
    actionTag: tagName,
    actionInputType,
    nameSource,
  };
}

function extractContainerAnchor(container) {
  const tagName = container.tagName.toLowerCase();
  const role = getRole(container);
  
  // 1. aria-labelledby
  const labelledBy = container.getAttribute('aria-labelledby');
  if (labelledBy) {
    const referenced = (container.ownerDocument || document).getElementById(labelledBy);
    if (referenced) {
      const text = extractReferencedText(container.ownerDocument || document, labelledBy);
      if (text) return { text, source: 'aria-labelledby', element: referenced, id: labelledBy };
    }
  }

  // 2. aria-label (for dialog and region)
  if (['dialog', 'region'].includes(tagName) || ['dialog', 'alertdialog', 'region'].includes(role)) {
    const label = container.getAttribute('aria-label');
    if (label) {
      const text = normalizeLabelText(label);
      if (text) return { text, source: 'aria-label' };
    }
  }

  // 3. fieldset legend
  if (tagName === 'fieldset') {
    const legend = Array.from(container.children).find((c) => c.tagName.toLowerCase() === 'legend');
    if (legend && isFastVisible(legend)) {
      const text = normalizeLabelText(legend.textContent);
      if (text) return { text, source: 'legend', element: legend };
    }
    return null; // fieldset without legend fails
  }

  // 4. visible heading
  const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'));
  for (const h of headings) {
    if (isFastVisible(h)) {
      const text = normalizeLabelText(h.textContent);
      if (text) return { text, source: 'heading', element: h };
    }
  }

  return null;
}

function findValidContainer(target) {
  let current = target.parentElement;
  let depth = 0;

  while (current && current !== document.body && depth < MAX_CONTAINER_ANCESTOR_DEPTH) {
    const tagName = current.tagName.toLowerCase();
    const role = getRole(current);
    
    let isCandidate = false;
    let containerType = tagName;

    if (tagName === 'article' || tagName === 'fieldset' || tagName === 'dialog') {
      isCandidate = true;
    } else if (role === 'dialog' || role === 'alertdialog') {
      isCandidate = true;
      containerType = role;
    } else if (tagName === 'section') {
      isCandidate = true;
    } else if (role === 'region') {
      isCandidate = true;
      containerType = 'region';
    }

    if (isCandidate) {
      const anchor = extractContainerAnchor(current);
      // Sections MUST have an anchor to be valid
      if (anchor) {
        return { container: current, containerType, anchor };
      }
    }

    current = current.parentElement;
    depth += 1;
  }
  
  return null;
}

export function resolveGenericContainerProof({
  element,
  boundedField,
  tableRow,
  optionPanel,
} = {}) {
  const basePayload = {
    containerType: null,
    containerAnchorText: null,
    anchorSource: null,
    anchorTag: null,
    anchorId: null,
    actionName: null,
    actionRole: null,
    actionTag: null,
    actionInputType: null,
    actionNameSource: null,
    containerTag: null,
    containerRole: null,
    containerSelectorKind: null,
    uniqueContainerBinding: false,
    uniqueAnchorBinding: false,
    uniqueActionBinding: false,
    isValid: false,
    eligibleForSelection: false,
    suppressedBy: null,
    blockedReason: null,
    reasons: [],
  };

  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return { ...basePayload, blockedReason: 'detached-target' };
  }

  const actionEvidence = extractActionEvidence(element);
  if (!actionEvidence) {
    return { ...basePayload, blockedReason: 'generic-container-missing-action-name' };
  }

  const containerMatch = findValidContainer(element);
  if (!containerMatch) {
    return { ...basePayload, blockedReason: 'generic-container-no-valid-container' };
  }

  const { container, containerType, anchor } = containerMatch;

  let currNode = element.parentElement;
  while (currNode && currNode !== container && currNode !== document.body) {
    const tn = currNode.tagName.toLowerCase();
    const r = getRole(currNode);
    let isC = false;
    if (tn === 'article' || tn === 'fieldset' || tn === 'dialog') isC = true;
    else if (r === 'dialog' || r === 'alertdialog') isC = true;
    else if (tn === 'section') isC = true;
    else if (r === 'region') isC = true;
    
    if (isC) {
      const anc = extractContainerAnchor(currNode);
      if (anc) {
        return { ...basePayload, blockedReason: 'generic-container-proposal-nested-container-risk' };
      }
    }
    currNode = currNode.parentElement;
  }

  if (anchor.source === 'heading' || anchor.source === 'legend') {
    const anchorElements = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"], legend'));
    for (const node of anchorElements) {
      if (node.contains(element) && normalizeLabelText(node.textContent) === anchor.text) {
        return { ...basePayload, blockedReason: 'generic-container-anchor-is-action' };
      }
    }
  }

  const containerSelector = containerType === 'region' || containerType === 'dialog' || containerType === 'alertdialog'
    ? `[role="${containerType}"]`
    : containerType;
    
  const allContainers = queryVisibleElements(container.ownerDocument || document, containerSelector);
  let duplicateContainerFound = false;
  
  for (const c of allContainers) {
    if (c === container) continue;
    const otherAnchor = extractContainerAnchor(c);
    if (otherAnchor && otherAnchor.text === anchor.text) {
      duplicateContainerFound = true;
      break;
    }
  }

  if (duplicateContainerFound) {
    return { ...basePayload, blockedReason: 'generic-container-ambiguous-anchor' };
  }

  const allActionsInContainer = Array.from(container.querySelectorAll(ALLOWED_ACTIONS));
  let duplicateActionFound = false;
  for (const a of allActionsInContainer) {
    if (a === element) continue;
    const aEv = extractActionEvidence(a);
    if (aEv && aEv.actionName === actionEvidence.actionName) {
      duplicateActionFound = true;
      break;
    }
  }

  if (duplicateActionFound) {
    return { ...basePayload, blockedReason: 'generic-container-ambiguous-action' };
  }

  let suppressedBy = null;
  let finalBlockedReason = null;
  let eligibleForSelection = true;

  if (tableRow?.isValid) {
    suppressedBy = 'table-row';
    finalBlockedReason = 'specialized-proof-already-available';
    eligibleForSelection = false;
  } else if (boundedField?.isValid) {
    suppressedBy = 'bounded-field';
    finalBlockedReason = 'specialized-proof-already-available';
    eligibleForSelection = false;
  } else if (optionPanel?.isValid) {
    suppressedBy = 'option-panel';
    finalBlockedReason = 'specialized-proof-already-available';
    eligibleForSelection = false;
  }

  return {
    ...basePayload,
    containerType,
    containerTag: container.tagName.toLowerCase(),
    containerRole: getRole(container) || null,
    containerSelectorKind: containerType,
    containerAnchorText: anchor.text,
    anchorSource: anchor.source,
    anchorTag: anchor.element ? anchor.element.tagName.toLowerCase() : null,
    anchorId: anchor.id || null,
    actionName: actionEvidence.actionName,
    actionRole: actionEvidence.actionRole,
    actionTag: actionEvidence.actionTag,
    actionInputType: actionEvidence.actionInputType,
    actionNameSource: actionEvidence.nameSource,
    uniqueContainerBinding: true,
    uniqueAnchorBinding: true,
    uniqueActionBinding: true,
    isValid: true,
    eligibleForSelection,
    suppressedBy,
    blockedReason: finalBlockedReason,
    reasons: [
      'valid-semantic-container',
      'visible-heading-anchor',
      'unique-anchor-binding',
      'unique-action-binding',
    ],
  };
}
