import {
  buildAttributeSelector,
  getSafeClassTokens,
  isLikelyDynamicId,
  safeTrim,
} from '../utils.js';
import { isFastVisible } from '../shared/visibility.js';
import { getRole } from '../shared/dom-attributes.js';
import { normalizeLabelText } from '../shared/text.js';
import { buildSelectorForElement } from '../shared/selectors.js';
import { summarizeTarget as _summarizeTarget } from '../shared/target-summary.js';

function summarizeTarget(element) {
  return _summarizeTarget(element, { includeClassList: true });
}

// 'group' intentionally excluded - it is a child container inside a tree, never the root.
// findTreeContainer walks to the outermost tree/treegrid, not the innermost group.
const TREE_CONTAINER_ROLES = new Set(['tree', 'treegrid']);
const TREE_NODE_ROLES = new Set(['treeitem', 'row']);

function getShallowText(node) {
  if (!node) return '';
  let text = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tagName = child.tagName?.toLowerCase();
      const role = child.getAttribute('role');
      if (tagName === 'ul' || tagName === 'ol' || role === 'treeitem' || role === 'group') {
        continue; // skip child subtrees
      }
      text += getShallowText(child);
    }
  }
  return text;
}

function findTreeContainer(target) {
  // Walk ALL the way to the top, collecting every tree/treegrid ancestor.
  // Return the OUTERMOST one - that is the true tree root.
  // A [role="group"] inside a tree is a child container, not the root.
  // We never stop at the first match because nested trees (tree > treeitem > group > treeitem)
  // would otherwise anchor to the inner group, producing a useless [role="group"] selector.
  let current = target?.parentElement;
  let found = null;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const role = getRole(current);
    const tagName = current.tagName?.toLowerCase();
    
    if (role && TREE_CONTAINER_ROLES.has(role)) {
      found = current; // keep walking - want outermost
    } else if (tagName === 'ul' || tagName === 'ol') {
      // Strict Gate: Must have aria-label/labelledby OR be inside a nav/aside
      const hasAriaLabel = !!safeTrim(current.getAttribute('aria-label') || current.getAttribute('aria-labelledby') || '');
      const hasNavParent = !!current.closest('nav, aside, [role="navigation"], [role="menu"]');
      if (hasAriaLabel || hasNavParent) {
        found = current;
      }
    }
    current = current.parentElement;
  }
  return found;
}

function findTreeNode(target) {
  let current = target;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const role = getRole(current);
    if (role && TREE_NODE_ROLES.has(role)) return current;
    if (current.tagName?.toLowerCase() === 'li') return current;
    current = current.parentElement;
  }
  return null;
}

export function resolveTreeNodeContextEvidence({ element, accessibilityEvidence } = {}) {
  const rawTarget = element || null;
  if (!rawTarget || rawTarget.nodeType !== Node.ELEMENT_NODE || rawTarget.isConnected === false) {
    return { isValid: false, blockedReason: 'tree-node-detached' };
  }

  const treeNode = findTreeNode(rawTarget);
  const treeContainer = findTreeContainer(treeNode || rawTarget);

  if (!treeNode || !treeContainer) {
    return {
      isValid: false,
      blockedReason: 'tree-node-not-in-tree',
    };
  }

  let nodeRole = null;
  let containerRole = null;
  
  const treeNodeRole = getRole(treeNode);
  const treeNodeTagName = treeNode.tagName?.toLowerCase();
  
  if (treeNodeRole && TREE_NODE_ROLES.has(treeNodeRole)) {
    nodeRole = treeNodeRole;
  } else if (treeNodeTagName === 'li') {
    nodeRole = 'listitem';
  }
  
  const containerTagRole = getRole(treeContainer);
  const containerTagName = treeContainer.tagName?.toLowerCase();
  if (containerTagRole && TREE_CONTAINER_ROLES.has(containerTagRole)) {
    containerRole = containerTagRole;
  } else if (containerTagName === 'ul' || containerTagName === 'ol') {
    containerRole = 'list';
  }

  const treeSelector = buildSelectorForElement(treeContainer, { allowRole: true });
  const nodeSelector = buildSelectorForElement(treeNode, { allowRole: true });
  
  // Priority: accessibility-computed name (what Playwright sees) > aria-label attr > shallow text nodes only.
  // NEVER use treeNode.textContent - it includes all descendant text (child treeitems, badges, icons).
  const nodeName = (() => {
    // 1. Use the pre-computed accessibility name if available (same algorithm Playwright uses)
    if (accessibilityEvidence?.accessibleName) {
      return normalizeLabelText(accessibilityEvidence.accessibleName);
    }
    // 2. aria-label attribute (leaf-only, set by most component libraries)
    const ariaLabel = normalizeLabelText(safeTrim(treeNode.getAttribute?.('aria-label') || ''));
    if (ariaLabel) return ariaLabel;
    // 3. Shallow text nodes only - NOT recursive textContent
    const shallowText = normalizeLabelText(getShallowText(treeNode));
    return shallowText || null;
  })();
  let depth = null;
  const ariaLevelAttr = treeNode.getAttribute('aria-level');
  if (ariaLevelAttr) {
    const parsed = parseInt(ariaLevelAttr, 10);
    if (!isNaN(parsed)) depth = parsed;
  }

  const ancestorPath = [];
  let currentDepth = 1;
  let pathNode = treeNode.parentElement;
  
  while (pathNode && pathNode !== treeContainer) {
    const role = getRole(pathNode);
    if (pathNode.tagName?.toLowerCase() === 'li' || role === 'treeitem' || role === 'row') {
      currentDepth += 1;
      // Same priority as nodeName: aria-label first, then shallow text nodes only.
      // textContent is excluded because ancestor treeitems include ALL their descendants' text.
      const ariaLabel = normalizeLabelText(safeTrim(pathNode.getAttribute?.('aria-label') || ''));
      const shallowText = normalizeLabelText(getShallowText(pathNode));
      const name = ariaLabel || shallowText || null;
      if (name) {
        // Store both the resolved name AND whether it came from aria-label.
        // The generator uses ariaLabel to determine if Shape P-aria is viable for this step.
        ancestorPath.unshift({ name, ariaLabel: ariaLabel || null });
      }
    }
    pathNode = pathNode.parentElement;
  }

  if (depth === null) {
    depth = currentDepth;
  }

function checkUniqueTreeNodeName(treeContainer, nodeName, nodeRole) {
  if (!treeContainer || !nodeName || !nodeRole) return false;
  try {
    const selector = nodeRole === 'listitem' ? 'li' : `[role="${nodeRole}"]`;
    const candidates = treeContainer.querySelectorAll(selector);
    let matchCount = 0;
    
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) continue;
      if (el.getAttribute('aria-hidden') === 'true') continue;
      
      const ariaLabel = normalizeLabelText(safeTrim(el.getAttribute('aria-label') || ''));
      let elName = ariaLabel;
      if (!elName) {
        elName = normalizeLabelText(getShallowText(el));
      }
      
      if (elName === nodeName) {
        matchCount++;
        if (matchCount > 1) return false;
      }
    }
    return matchCount === 1;
  } catch {
    return false;
  }
}

  const ariaExpanded = treeNode.getAttribute('aria-expanded');
  const isExpanded = ariaExpanded ? ariaExpanded === 'true' : null;

  // nodeName can be null when aria-label, aria-labelledby, and direct text are all absent.
  // In that case isValid = false and no candidate is emitted. This is correct - emitting
  // a selector with no name anchor would produce an unreliable mass-match locator.
  const isValid = !!treeSelector && !!nodeName;
  
  const uniqueNodeName = isValid ? checkUniqueTreeNodeName(treeContainer, nodeName, nodeRole) : false;

  return {
    rawTargetSummary: summarizeTarget(rawTarget),
    treeSelector,
    nodeSelector,
    nodeName,
    uniqueNodeName,
    nodeRole,
    containerRole,
    ancestorPath,
    depth,
    isExpanded,
    isValid,
    blockedReason: isValid ? null : 'tree-node-missing-selectors'
  };
}
