import { getSafeClassTokens, normalizeText, safeTrim } from './utils.js';

const MAX_CANONICAL_DESCENDANT_DEPTH = 3;
const MAX_CANONICAL_INSPECTED_DESCENDANTS = 12;
const CUSTOM_CONTROL_EVENT_TYPES = new Set([
  'custom-control-open',
  'custom-select',
  'custom-menu-select',
]);
const INPUT_LIKE_ROLES = new Set([
  'combobox',
  'textbox',
  'searchbox',
  'spinbutton',
]);
const CONTROL_LIKE_ROLES = new Set([
  'button',
  'link',
  'combobox',
  'textbox',
  'searchbox',
  'spinbutton',
]);

function isCustomControlEvent(eventContext) {
  const eventType = typeof eventContext?.eventType === 'string'
    ? eventContext.eventType.trim()
    : '';
  return CUSTOM_CONTROL_EVENT_TYPES.has(eventType);
}

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

function isInputLike(element) {
  const tagName = element?.tagName?.toLowerCase?.() || '';
  const role = (element?.getAttribute?.('role') || '').toLowerCase();
  const type = (element?.getAttribute?.('type') || '').toLowerCase();
  const contentEditable = (element?.getAttribute?.('contenteditable') || '').toLowerCase();

  if (tagName === 'input' && type === 'hidden') return false;
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
  if (INPUT_LIKE_ROLES.has(role)) return true;
  return !!element?.isContentEditable || (element?.hasAttribute?.('contenteditable') && contentEditable !== 'false');
}

function isFocusable(element) {
  const tagName = element?.tagName?.toLowerCase?.() || '';
  const tabIndexAttr = element?.getAttribute?.('tabindex');
  const tabIndex = typeof element?.tabIndex === 'number' ? element.tabIndex : null;

  if (tabIndexAttr !== null && !Number.isNaN(Number(tabIndexAttr)) && Number(tabIndexAttr) >= 0) return true;
  if (tabIndex !== null && tabIndex >= 0) return true;
  if (['input', 'textarea', 'select', 'button'].includes(tagName) && element?.disabled !== true) return true;
  if (tagName === 'a' && element?.hasAttribute?.('href')) return true;
  return !!element?.isContentEditable;
}

function getElementText(element) {
  return normalizeText(element?.innerText || element?.textContent || '');
}

function hasMeaningfulText(element) {
  const text = getElementText(element);
  if (!text) return false;
  if (text.length > 80) return false;
  return true;
}

function isLeafLike(element) {
  if (!element?.children || element.children.length === 0) return true;
  return Array.from(element.children).every((child) => {
    const text = getElementText(child);
    return !text && !isInputLike(child) && !isFocusable(child);
  });
}

function getRole(element) {
  return safeTrim(element?.getAttribute?.('role') || '').toLowerCase();
}

function summarizeTarget(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;

  const classes = getSafeClassTokens(element).slice(0, 3);
  const textExcerpt = getElementText(element).slice(0, 80) || null;
  const tabIndexAttr = element.getAttribute?.('tabindex');

  return {
    tagName: element.tagName?.toLowerCase?.() || null,
    role: getRole(element) || null,
    classList: classes.length > 0 ? classes.join(' ') : null,
    textExcerpt,
    tabIndex: tabIndexAttr !== null ? tabIndexAttr : null,
  };
}

function getDescendantEntries(root) {
  const queue = Array.from(root?.children || []).map((child) => ({
    element: child,
    depth: 1,
  }));
  const entries = [];
  let inspected = 0;

  while (queue.length > 0 && inspected < MAX_CANONICAL_INSPECTED_DESCENDANTS) {
    const current = queue.shift();
    if (!current?.element) continue;

    entries.push(current);
    inspected += 1;

    if (current.depth >= MAX_CANONICAL_DESCENDANT_DEPTH) continue;
    for (const child of Array.from(current.element.children || [])) {
      queue.push({
        element: child,
        depth: current.depth + 1,
      });
    }
  }

  return {
    entries,
    inspectedCount: inspected,
    hitInspectionLimit: queue.length > 0,
  };
}

function determineReason(score) {
  if (score.readonlyInput) return 'readonly-input-descendant';
  if (score.focusable && score.hasText) return 'focusable-text-descendant';
  if (score.inputLike) return 'input-like-descendant';
  if (score.roleBearing && score.hasText) return 'role-text-descendant';
  if (score.focusable) return 'focusable-descendant';
  if (score.hasText && score.leafLike) return 'text-leaf-descendant';
  return 'canonical-descendant';
}

function computeConfidence(score, depth) {
  if (score.readonlyInput) return 0.94;
  if (score.focusable && score.hasText) return depth <= 1 ? 0.86 : 0.8;
  if (score.inputLike) return 0.78;
  if (score.roleBearing && score.hasText) return 0.74;
  if (score.focusable) return 0.7;
  if (score.hasText && score.leafLike) return 0.66;
  return 0.55;
}

function scoreCandidate(rawTarget, candidate, depth) {
  if (!isFastVisible(candidate)) return null;

  const candidateText = getElementText(candidate);
  const rawText = getElementText(rawTarget);
  const role = getRole(candidate);
  const readonly = candidate.matches?.('input[readonly], textarea[readonly]') === true;
  const inputLike = isInputLike(candidate);
  const focusable = isFocusable(candidate);
  const hasText = !!candidateText && candidateText.length <= 80;
  const leafLike = isLeafLike(candidate);
  const roleBearing = CONTROL_LIKE_ROLES.has(role);
  const rawSummary = summarizeTarget(rawTarget);
  const candidateSummary = summarizeTarget(candidate);

  if (!inputLike && !focusable && !roleBearing && !hasText) {
    return null;
  }

  if (
    rawSummary?.tagName === candidateSummary?.tagName &&
    rawSummary?.classList === candidateSummary?.classList &&
    rawSummary?.textExcerpt === candidateSummary?.textExcerpt
  ) {
    return null;
  }

  let points = 0;
  if (readonly) points += 7;
  if (inputLike) points += 6;
  if (focusable) points += 5;
  if (roleBearing) points += 4;
  if (hasText) points += 3;
  if (leafLike) points += 2;
  if (candidate.hasAttribute?.('aria-label') || candidate.hasAttribute?.('aria-labelledby')) points += 2;
  if (candidate.hasAttribute?.('name') || candidate.hasAttribute?.('placeholder')) points += 1;
  if (candidateText && rawText && candidateText === rawText) points += 1;
  points -= Math.max(0, depth - 1);

  if (points < 8) return null;

  const score = {
    readonlyInput: readonly,
    inputLike,
    focusable,
    roleBearing,
    hasText,
    leafLike,
  };

  return {
    element: candidate,
    depth,
    points,
    reason: determineReason(score),
    confidence: computeConfidence(score, depth),
    summary: candidateSummary,
  };
}

function chooseCanonicalCandidate(rawTarget, entries) {
  const scored = entries
    .map(({ element, depth }) => scoreCandidate(rawTarget, element, depth))
    .filter(Boolean)
    .sort((left, right) => {
      if (right.points !== left.points) return right.points - left.points;
      if (left.depth !== right.depth) return left.depth - right.depth;
      const leftText = left.summary?.textExcerpt?.length || 0;
      const rightText = right.summary?.textExcerpt?.length || 0;
      return rightText - leftText;
    });

  if (scored.length === 0) {
    return {
      winner: null,
      blockedReason: 'no-meaningful-descendant',
    };
  }

  if (scored.length > 1) {
    const [first, second] = scored;
    if (second && first.points === second.points && first.depth === second.depth) {
      return {
        winner: null,
        blockedReason: 'ambiguous-descendants',
      };
    }
  }

  return {
    winner: scored[0],
    blockedReason: null,
  };
}

function stripInternalTargets(result) {
  return {
    rawTargetSummary: result.rawTargetSummary,
    canonicalTargetSummary: result.canonicalTargetSummary,
    canonicalReason: result.canonicalReason,
    canonicalConfidence: result.canonicalConfidence,
    canonicalDiffers: result.canonicalDiffers,
    blockedReason: result.blockedReason,
  };
}

export function resolveCanonicalCustomControlTargetInternal(rawTarget, eventContext) {
  const rawTargetSummary = summarizeTarget(rawTarget);
  const base = {
    rawTarget,
    canonicalTarget: null,
    rawTargetSummary,
    canonicalTargetSummary: null,
    canonicalReason: null,
    canonicalConfidence: null,
    canonicalDiffers: false,
    blockedReason: null,
  };

  if (!rawTarget || rawTarget.nodeType !== Node.ELEMENT_NODE || rawTarget.isConnected === false) {
    return {
      ...base,
      blockedReason: 'detached-target',
    };
  }

  if (!isCustomControlEvent(eventContext)) {
    return {
      ...base,
      blockedReason: 'non-custom-control-event',
    };
  }

  const { entries, hitInspectionLimit } = getDescendantEntries(rawTarget);
  if (entries.length === 0) {
    return {
      ...base,
      blockedReason: 'no-descendants',
    };
  }

  const selection = chooseCanonicalCandidate(rawTarget, entries);
  if (!selection.winner) {
    return {
      ...base,
      blockedReason: selection.blockedReason || (hitInspectionLimit ? 'inspection-limit-hit' : 'no-meaningful-descendant'),
    };
  }

  return {
    ...base,
    canonicalTarget: selection.winner.element,
    canonicalTargetSummary: selection.winner.summary,
    canonicalReason: selection.winner.reason,
    canonicalConfidence: selection.winner.confidence,
    canonicalDiffers: selection.winner.element !== rawTarget,
    blockedReason: null,
  };
}

export function resolveCanonicalCustomControlTarget(rawTarget, eventContext) {
  return stripInternalTargets(resolveCanonicalCustomControlTargetInternal(rawTarget, eventContext));
}
