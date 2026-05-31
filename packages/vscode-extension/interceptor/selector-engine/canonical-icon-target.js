import { summarizeTarget as _summarizeTarget } from './shared/target-summary.js';

function summarizeTarget(element) {
  return _summarizeTarget(element, { includeClassList: true, includeTabIndex: true });
}

const SVG_TAGS = new Set([
  'svg', 'path', 'use', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'
]);

const ACTIONABLE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemradio', 'menuitemcheckbox',
  'tab', 'checkbox', 'radio', 'switch', 'option', 'treeitem',
  'gridcell', 'cell', 'row'
]);

const MAX_ICON_OWNER_ANCESTOR_DEPTH = 5;

export function isIconNode(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  const tagName = (element.tagName || '').toLowerCase();
  return SVG_TAGS.has(tagName);
}

export function isSafeSemanticOwner(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  if (element.disabled === true) return false;

  const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;

  const tagName = (element.tagName || '').toLowerCase();
  if (tagName === 'button') return true;
  if (tagName === 'summary') return true;
  if (tagName === 'a' && element.hasAttribute('href')) return true;

  const role = (element.getAttribute('role') || '').toLowerCase();
  if (ACTIONABLE_ROLES.has(role)) return true;

  return false;
}

export function resolveCanonicalIconTarget(rawTarget) {
  const base = {
    rawTarget,
    canonicalTarget: null,
    rawTargetSummary: summarizeTarget(rawTarget),
    canonicalTargetSummary: null,
    canonicalReason: null,
    canonicalConfidence: null,
    canonicalDiffers: false,
    blockedReason: null,
  };

  if (!rawTarget || rawTarget.nodeType !== Node.ELEMENT_NODE || rawTarget.isConnected === false) {
    return { ...base, blockedReason: 'detached-target' };
  }

  if (!isIconNode(rawTarget)) {
    return { ...base, blockedReason: 'not-an-icon-node' };
  }

  let current = rawTarget.parentElement;
  let depth = 1;

  while (current && depth <= MAX_ICON_OWNER_ANCESTOR_DEPTH) {
    if (isSafeSemanticOwner(current)) {
      return {
        ...base,
        canonicalTarget: current,
        canonicalTargetSummary: summarizeTarget(current),
        canonicalReason: 'svg-icon-owned-by-actionable-parent',
        canonicalConfidence: 0.9, // High confidence for semantic owner
        canonicalDiffers: true,
      };
    }
    current = current.parentElement;
    depth++;
  }

  return {
    ...base,
    blockedReason: 'svg-icon-no-actionable-owner',
  };
}
