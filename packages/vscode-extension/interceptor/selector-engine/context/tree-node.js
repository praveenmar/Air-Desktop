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

const TREE_CONTAINER_ROLES = new Set(['tree', 'treegrid', 'group']);
const TREE_NODE_ROLES = new Set(['treeitem', 'row']);

function findTreeContainer(target) {
  let current = target?.parentElement;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const role = getRole(current);
    if (role && TREE_CONTAINER_ROLES.has(role)) return current;
    if (current.tagName?.toLowerCase() === 'ul' || current.tagName?.toLowerCase() === 'ol') return current;
    current = current.parentElement;
  }
  return null;
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

export function resolveTreeNodeContextEvidence({ element } = {}) {
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

  const treeSelector = buildSelectorForElement(treeContainer, { allowRole: true });
  const nodeSelector = buildSelectorForElement(treeNode, { allowRole: true });
  
  const nodeName = normalizeLabelText(treeNode.textContent || '');
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
      const name = normalizeLabelText(pathNode.textContent || '');
      if (name) ancestorPath.unshift({ name });
    }
    pathNode = pathNode.parentElement;
  }

  if (depth === null) {
    depth = currentDepth;
  }

  const ariaExpanded = treeNode.getAttribute('aria-expanded');
  const isExpanded = ariaExpanded === 'true';

  const isValid = !!treeSelector && !!nodeSelector && !!nodeName;

  return {
    rawTargetSummary: summarizeTarget(rawTarget),
    treeSelector,
    nodeSelector,
    nodeName,
    ancestorPath,
    depth,
    isExpanded,
    isValid,
    blockedReason: isValid ? null : 'tree-node-missing-selectors'
  };
}
