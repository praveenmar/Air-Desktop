import {
  buildAttributeSelector,
  normalizeText,
  safeTrim,
} from '../utils.js';
import { resolveCanonicalCustomControlTargetInternal } from '../canonical-target.js';
import { getRole } from '../shared/dom-attributes.js';
import { summarizeTarget as _summarizeTarget } from '../shared/target-summary.js';


// Known volatile suffixes that encode transient UI state but can be safely stripped
// before checking if the remaining accessible name is dynamic.
// e.g. "Country (required)" → "Country" (stable) ✓
//      "Price $12.99" → dynamic (still blocked after stripping) ✗
const STRIPPABLE_SUFFIX_PATTERN = /(?:\s*(?:\(required\)|\(optional\)|\*|\(new\)|\(beta\)|\(preview\)))+$/i;

/**
 * Strips known non-volatile suffixes from an accessible name before dynamic detection.
 * Returns the trimmed base name, or the original string if no suffix was stripped.
 */
function stripVolatileSuffixes(name) {
  if (typeof name !== 'string') return name;
  return name.replace(STRIPPABLE_SUFFIX_PATTERN, '').trim();
}

function isAccessibleNameDynamic(name) {
  if (!name) return false;
  // F-G9: Strip known safe suffixes before checking for dynamic content.
  // This prevents over-blocking labels like "Email (required)" while still
  // correctly blocking "Price $12.99" or "3 items selected".
  const stripped = stripVolatileSuffixes(name);
  return /[\d$€£¥]|selected|\d{1,2}\/\d{1,2}/i.test(stripped);
}
function summarizeTarget(element) {
  return _summarizeTarget(element, { includeAriaLabels: true, includeTextExcerpt: true });
}


const TEXTBOX_INPUT_TYPES = new Set([
  '',
  'text',
  'password',
  'email',
  'search',
  'tel',
  'url',
  'number',
]);
const ROLE_TEXT_ROLES = new Set([
  'option',
  'menuitem',
  'button',
  'link',
  'tab',
  'treeitem',
  'checkbox',
  'radio',
  'row',
  'gridcell',
]);

function normalizeAccessibleText(text) {
  if (typeof text !== 'string') return null;
  const normalized = normalizeText(text);
  if (!normalized) return null;
  return normalized.length > 100 ? normalized.slice(0, 100) : normalized;
}


function inferNativeRole(element) {
  const tagName = (element?.tagName || '').toLowerCase();
  const type = safeTrim(element?.getAttribute?.('type') || '').toLowerCase();

  if (tagName === 'input') {
    if (TEXTBOX_INPUT_TYPES.has(type)) return 'textbox';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
    return null;
  }
  if (tagName === 'textarea') return 'textbox';
  if (tagName === 'select') return 'combobox';
  if (tagName === 'button') return 'button';
  if (tagName === 'a' && element?.hasAttribute?.('href')) return 'link';
  return null;
}

function extractReferencedText(documentRef, idList) {
  if (!documentRef || typeof idList !== 'string') return null;
  const parts = [];
  for (const refId of idList.split(/\s+/).filter(Boolean)) {
    try {
      const ref = documentRef.getElementById?.(refId);
      const text = normalizeAccessibleText(ref?.textContent || '');
      if (!text) continue;
      if (!parts.includes(text)) parts.push(text);
    } catch {
      // Ignore synthetic DOM limitations and invalid IDs.
    }
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function buildEvidenceForTarget(target) {
  const documentRef = target?.ownerDocument || document;
  const explicitRole = getRole(target);
  const role = explicitRole || inferNativeRole(target);
  const roleSource = explicitRole ? 'explicit-role' : (role ? 'native-role' : 'none');
  const tagName = (target?.tagName || '').toLowerCase();

  const evidence = {
    role,
    roleSource,
    accessibleName: null,
    accessibleNameSource: 'none',
    accessibleNameIsDynamic: false,
    labelledByIds: undefined,
    isNativeLabelAssociation: undefined,
  };

  const ariaLabel = target?.getAttribute?.('aria-label');
  if (ariaLabel) {
    const accessibleName = normalizeAccessibleText(ariaLabel);
    if (accessibleName) {
      return {
        ...evidence,
        accessibleName,
        accessibleNameSource: 'aria-label',
      };
    }
  }

  const ariaLabelledBy = target?.getAttribute?.('aria-labelledby');
  if (ariaLabelledBy) {
    const labelledByIds = ariaLabelledBy.split(/\s+/).filter(Boolean);
    const accessibleName = extractReferencedText(documentRef, ariaLabelledBy);
    if (accessibleName) {
      return {
        ...evidence,
        accessibleName,
        accessibleNameSource: 'aria-labelledby',
        labelledByIds,
      };
    }
    evidence.labelledByIds = labelledByIds;
  }

  if (target?.id) {
    try {
      const labelSelector = buildAttributeSelector('label', 'for', target.id);
      const label = labelSelector ? documentRef.querySelector(labelSelector) : null;
      const accessibleName = normalizeAccessibleText(label?.textContent || '');
      if (accessibleName) {
        return {
          ...evidence,
          accessibleName,
          accessibleNameSource: 'label-for',
          isNativeLabelAssociation: true,
        };
      }
    } catch {
      // Ignore selector failures in synthetic DOMs.
    }
  }

  const wrappedLabel = target?.closest?.('label') || null;
  const wrappedLabelName = normalizeAccessibleText(wrappedLabel?.textContent || '');
  if (wrappedLabelName) {
    return {
      ...evidence,
      accessibleName: wrappedLabelName,
      accessibleNameSource: 'wrapped-label',
      isNativeLabelAssociation: true,
    };
  }

  const title = target?.getAttribute?.('title');
  if (title) {
    const accessibleName = normalizeAccessibleText(title);
    if (accessibleName) {
      return {
        ...evidence,
        accessibleName,
        accessibleNameSource: 'title',
      };
    }
  }

  const textContent = normalizeAccessibleText(target?.textContent || '');
  if (tagName === 'button' && textContent) {
    return {
      ...evidence,
      accessibleName: textContent,
      accessibleNameSource: 'button-text',
    };
  }

  if (tagName === 'a' && target?.hasAttribute?.('href') && textContent) {
    return {
      ...evidence,
      accessibleName: textContent,
      accessibleNameSource: 'link-text',
    };
  }

  if (role && ROLE_TEXT_ROLES.has(role) && textContent) {
    return {
      ...evidence,
      accessibleName: textContent,
      accessibleNameSource: 'role-text',
    };
  }

  if (tagName === 'input' || tagName === 'textarea') {
    const placeholder = target?.getAttribute?.('placeholder');
    const accessibleName = normalizeAccessibleText(placeholder || '');
    if (accessibleName) {
      return {
        ...evidence,
        accessibleName,
        accessibleNameSource: 'placeholder',
      };
    }
  }

  return evidence;
}

function scoreEvidence(evidence) {
  let score = 0;
  if (evidence.role) score += 4;
  if (evidence.accessibleName) score += 4;

  switch (evidence.accessibleNameSource) {
    case 'aria-label':
    case 'aria-labelledby':
      score += 4;
      break;
    case 'label-for':
    case 'wrapped-label':
      score += 3;
      break;
    case 'title':
      score += 2;
      break;
    case 'button-text':
    case 'link-text':
    case 'role-text':
    case 'placeholder':
      score += 1;
      break;
    default:
      break;
  }

  if (evidence.isNativeLabelAssociation) score += 1;
  if (evidence.roleSource === 'explicit-role') score += 1;
  return score;
}

function uniqueTargets(rawTarget, effectiveTarget) {
  const targets = [];
  for (const target of [effectiveTarget, rawTarget]) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE || target.isConnected === false) continue;
    if (!targets.includes(target)) targets.push(target);
  }
  return targets;
}

function getAriaMatches(documentRef, role, name) {
  if (!role || !name) return [];
  try {
    let query = '*';
    if (role === 'button') query = 'button, [role="button"], input[type="button"], input[type="submit"]';
    else if (role === 'link') query = 'a, [role="link"]';
    else if (role === 'textbox') query = 'input:not([type="hidden"]), textarea, [role="textbox"]';
    else if (role === 'checkbox') query = 'input[type="checkbox"], [role="checkbox"]';
    else if (role === 'combobox') query = 'select, input, [role="combobox"]';
    else query = `[role="${role}"], ${role}`;

    const candidates = [];
    
    function walk(node) {
      if (!node) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches && node.matches(query)) {
          candidates.push(node);
        }
        if (node.shadowRoot) {
          walk(node.shadowRoot);
        }
      }
      let child = node.firstChild;
      while (child) {
        walk(child);
        child = child.nextSibling;
      }
    }
    
    walk(documentRef);

    const matches = [];
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) continue;
      if (el.closest('[aria-hidden="true"]') !== null) continue;

      const evidence = buildEvidenceForTarget(el);
      if (evidence.role === role && evidence.accessibleName === name) {
        matches.push(el);
      }
    }
    return matches;
  } catch {
    return [];
  }
}

export function resolveAccessibilityEvidence({
  element,
  eventContext,
  canonicalTargetInfo,
} = {}) {
  const rawTarget = element || null;
  const resolvedCanonicalTargetInfo = canonicalTargetInfo?.canonicalTarget
    ? canonicalTargetInfo
    : resolveCanonicalCustomControlTargetInternal(rawTarget, eventContext);
  const effectiveTarget = resolvedCanonicalTargetInfo?.canonicalDiffers && resolvedCanonicalTargetInfo?.canonicalTarget
    ? resolvedCanonicalTargetInfo.canonicalTarget
    : rawTarget;
  const rawTargetSummary = summarizeTarget(rawTarget);
  const effectiveTargetSummary = summarizeTarget(effectiveTarget);
  const base = {
    rawTargetSummary,
    effectiveTargetSummary,
    proofTargetSummary: null,
    usedCanonicalTarget: false,
    role: null,
    roleSource: 'none',
    accessibleName: null,
    accessibleNameSource: 'none',
    labelledByIds: undefined,
    isNativeLabelAssociation: undefined,
    blockedReason: null,
  };

  if (!rawTarget || rawTarget.nodeType !== Node.ELEMENT_NODE || rawTarget.isConnected === false) {
    return {
      ...base,
      blockedReason: 'detached-target',
    };
  }

  const candidates = uniqueTargets(rawTarget, effectiveTarget)
    .map((target) => ({
      target,
      summary: summarizeTarget(target),
      evidence: buildEvidenceForTarget(target),
    }))
    .sort((left, right) => {
      const scoreDiff = scoreEvidence(right.evidence) - scoreEvidence(left.evidence);
      if (scoreDiff !== 0) return scoreDiff;
      if (left.target === effectiveTarget && right.target !== effectiveTarget) return -1;
      if (right.target === effectiveTarget && left.target !== effectiveTarget) return 1;
      return 0;
    });

  const winner = candidates[0];
  if (!winner) {
    return {
      ...base,
      blockedReason: 'no-target',
    };
  }

  const documentRef = effectiveTarget.ownerDocument || document;
  const ariaMatches = getAriaMatches(
    documentRef, 
    winner.evidence.role, 
    winner.evidence.accessibleName
  );
  const ariaMatchCount = ariaMatches.length;
  // Only assert uniqueness when we found > 0 matches.
  // 0 matches means our DOM-based accessible-name computation diverged from
  // Playwright's (e.g. whitespace, inner-text trimming) — this is a false
  // negative, NOT a confirmed "multiple matches" scenario. Leaving it
  // undefined preserves the pre-getAriaMatches behaviour for Rule 0 and
  // avoids incorrectly blocking a valid semantic-identity selector.
  const uniqueByAriaName = ariaMatchCount > 0 ? ariaMatchCount === 1 : undefined;
  const ariaMatchIndex = ariaMatches.indexOf(effectiveTarget);

  return {
    ...base,
    proofTargetSummary: winner.summary,
    usedCanonicalTarget: winner.target === effectiveTarget && effectiveTarget !== rawTarget,
    role: winner.evidence.role,
    roleSource: winner.evidence.roleSource,
    accessibleName: winner.evidence.accessibleName,
    accessibleNameIsDynamic: isAccessibleNameDynamic(winner.evidence.accessibleName),
    accessibleNameSource: winner.evidence.accessibleNameSource || 'none',
    labelledByIds: winner.evidence.labelledByIds,
    isNativeLabelAssociation: winner.evidence.isNativeLabelAssociation,
    uniqueByAriaName,
    ariaMatchCount,
    ariaMatchIndex: ariaMatchIndex >= 0 ? ariaMatchIndex : null,
    blockedReason: null,
  };
}
