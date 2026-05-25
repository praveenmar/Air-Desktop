import { debugLog, debugLogOnce } from '../debug.js';
import {
  getSafeClassTokens,
  isLikelyDynamicId,
  safeCssEscape,
  safeTrim,
} from '../utils.js';

const MAX_TIGHT_CONTAINER_DEPTH = 8;
const MAX_TIGHT_CONTAINER_CONTROL_LIKE_DESCENDANTS = 4;
const TIGHT_CONTAINER_INPUT_LIKE_SELECTOR = [
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[role="spinbutton"]',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');
const TIGHT_CONTAINER_TRIGGER_LIKE_SELECTOR = [
  'select',
  '[role="combobox"]',
  'button[aria-haspopup]',
  '[role="button"][aria-haspopup]',
  '[aria-haspopup="listbox"]',
  '[aria-haspopup="combobox"]',
  '[tabindex][aria-haspopup]',
].join(', ');
const TIGHT_CONTAINER_BROAD_TAGS = new Set([
  'html',
  'body',
  'main',
  'section',
  'article',
  'nav',
  'table',
  'tbody',
  'thead',
]);

function escapeAttributeValue(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function buildLogContext(element, eventContext, extra = {}) {
  return {
    eventType: typeof eventContext?.eventType === 'string' ? eventContext.eventType : null,
    trigger: typeof eventContext?.trigger === 'string' ? eventContext.trigger : null,
    targetTag: element?.tagName?.toLowerCase?.() || null,
    ...extra,
  };
}

function buildSkipResult(blockedReason, warningCodes = [], extra = {}) {
  return {
    candidate: null,
    blockedReason,
    warningCodes,
    ...extra,
  };
}

function tokenizeClassSemanticParts(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function isUtilityClassToken(token) {
  return (
    /^(?:flex|grid|block|hidden)$/i.test(token) ||
    /^(?:items|justify|content|self|place)-/i.test(token) ||
    /^(?:p|m)(?:[trblxy])?-\d+/i.test(token) ||
    /^(?:text|bg|border|rounded)-/i.test(token) ||
    /^(?:w|h|min|max)-/i.test(token) ||
    /^(?:gap|space-[xy]|inset|top|left|right|bottom)-/i.test(token) ||
    /^(?:hover|focus|active|disabled|group-hover|focus-within|focus-visible):/i.test(token)
  );
}

function isStateClassToken(token) {
  const normalized = String(token || '').toLowerCase();
  if (!normalized) return false;
  if (/^(?:is|has)-[a-z0-9:_-]+$/i.test(normalized)) return true;
  if (/--(?:focus|focused|active|selected|open|disabled|hover|loading|expanded|collapsed|current|checked|invalid|valid|dirty|touched|visited|state)$/i.test(normalized)) {
    return true;
  }
  if (normalized.includes('data-state') || normalized.includes('headlessui-state')) return true;
  return tokenizeClassSemanticParts(normalized).some((part) => (
    /^(?:focus|focused|active|selected|open|disabled|hover|loading|expanded|collapsed|current|checked|invalid|valid|dirty|touched|visited|state)$/.test(part)
  ));
}

function isFrameworkClassToken(token) {
  return /^(?:oxd-|mui|ant-|chakra-|radix-|headlessui-)/i.test(token);
}

function isGenericShellClassToken(token) {
  return /^(?:container|wrapper|row|item|content|layout|shell|panel|section|body|header|footer)$/i.test(token);
}

function isCssInJsClassToken(token) {
  return /^(?:css-|sc-)/i.test(token);
}

function isHashedRandomClassToken(token) {
  if (isCssInJsClassToken(token)) return true;
  if (token.length < 8) return false;
  if (!/[a-z]/i.test(token)) return false;
  if (isFrameworkClassToken(token)) return false;
  if (/^[a-z0-9:_-]+$/i.test(token) && /\d/.test(token)) {
    const parts = token.split(/[-_]/).filter(Boolean);
    if (parts.length <= 1) {
      return /[a-z]{2,}\d{2,}[a-z0-9]{4,}/i.test(token);
    }
    return parts.every((part) => part.length >= 3 && (/\d/.test(part) || /^[a-z]{6,}$/i.test(part)));
  }
  return false;
}

function scoreClassCandidate(token) {
  let penalty = 0;
  let bonus = 0;

  if (isUtilityClassToken(token)) penalty += 5;
  if (isCssInJsClassToken(token)) penalty += 5;
  if (isHashedRandomClassToken(token)) penalty += 4;
  if (isStateClassToken(token)) penalty += 6;
  if (isFrameworkClassToken(token)) penalty += 3;
  if (isGenericShellClassToken(token)) penalty += 3;

  const parts = tokenizeClassSemanticParts(token);
  if (/(?:__|--)/.test(token) && !isStateClassToken(token)) bonus += 1;
  if (parts.length >= 2 && !parts.every((part) => isGenericShellClassToken(part))) bonus += 2;
  else if (parts.length === 1 && parts[0].length >= 4 && !isGenericShellClassToken(parts[0])) bonus += 1;

  return {
    token,
    score: bonus - penalty,
    penalty,
    bonus,
  };
}

function analyzeClassToken(token) {
  const normalized = safeTrim(token);
  return {
    isFramework: isFrameworkClassToken(normalized),
    isGenericShell: isGenericShellClassToken(normalized),
    usesDynamicClass:
      isUtilityClassToken(normalized) ||
      isStateClassToken(normalized) ||
      isHashedRandomClassToken(normalized) ||
      isCssInJsClassToken(normalized),
  };
}

function getBestStableClassCandidate(element) {
  const ranked = getSafeClassTokens(element)
    .map((token) => ({
      token,
      analysis: analyzeClassToken(token),
      score: scoreClassCandidate(token),
    }))
    .filter((entry) => !/^MuiInputBase-input$/i.test(entry.token))
    .filter((entry) => !entry.analysis.usesDynamicClass)
    .filter((entry) => !entry.analysis.isGenericShell)
    .sort((left, right) => {
      if (right.score.score !== left.score.score) return right.score.score - left.score.score;
      if (left.score.penalty !== right.score.penalty) return left.score.penalty - right.score.penalty;
      if (right.score.bonus !== left.score.bonus) return right.score.bonus - left.score.bonus;
      return left.token.length - right.token.length;
    });

  if (ranked.length === 0) return null;
  if (ranked[0].score.score < -6) return null;

  const warningCodes = [];
  if (ranked[0].analysis.isFramework) warningCodes.push('framework-class');
  return {
    token: ranked[0].token,
    warningCodes,
  };
}

function resolveLabelAssociatedControl(labelElement) {
  if (!labelElement || labelElement.nodeType !== Node.ELEMENT_NODE) return null;
  if (labelElement.control && labelElement.control.nodeType === Node.ELEMENT_NODE) {
    return labelElement.control;
  }

  const forId = labelElement.getAttribute('for');
  if (!forId) return null;

  const root = typeof labelElement.getRootNode === 'function'
    ? labelElement.getRootNode()
    : null;
  if (root && typeof root.getElementById === 'function') {
    const rootMatch = root.getElementById(forId);
    if (rootMatch) return rootMatch;
  }

  return labelElement.ownerDocument?.getElementById?.(forId) || null;
}

function resolveTightContainerMode(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;

  const tagName = element.tagName?.toLowerCase?.() || '';
  const role = (element.getAttribute?.('role') || '').toLowerCase();
  const inputType = (element.getAttribute?.('type') || '').toLowerCase();
  const ariaHasPopup = (element.getAttribute?.('aria-haspopup') || '').toLowerCase();
  const contentEditableAttr = (element.getAttribute?.('contenteditable') || '').toLowerCase();
  const hasContentEditableAttr = !!element.hasAttribute?.('contenteditable');
  const isContentEditable = !!element.isContentEditable || (hasContentEditableAttr && contentEditableAttr !== 'false');

  if (tagName === 'input' && inputType === 'hidden') return null;
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return 'input-like';
  if (role === 'textbox' || role === 'combobox' || role === 'searchbox' || role === 'spinbutton') return 'input-like';
  if (isContentEditable) return 'input-like';

  if (
    tagName === 'select' ||
    role === 'combobox' ||
    (role === 'button' && !!ariaHasPopup) ||
    ariaHasPopup === 'listbox' ||
    ariaHasPopup === 'combobox' ||
    ((tagName === 'button' || element.hasAttribute?.('tabindex')) && !!ariaHasPopup)
  ) {
    return 'trigger-like';
  }

  return null;
}

function resolveTightContainerTargetAndMode(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;

  const directMode = resolveTightContainerMode(element);
  if (directMode) {
    return {
      target: element,
      mode: directMode,
      originalTarget: element,
    };
  }

  if (element.tagName?.toLowerCase?.() !== 'label') return null;

  const associatedControl = resolveLabelAssociatedControl(element);
  const associatedMode = resolveTightContainerMode(associatedControl);
  if (!associatedControl || !associatedMode) return null;

  return {
    target: associatedControl,
    mode: associatedMode,
    originalTarget: element,
  };
}

function getComposedParentElement(node) {
  if (!node || typeof node !== 'object') return null;

  if (node.assignedSlot) {
    return {
      parentElement: node.assignedSlot,
      shadowBoundaryCrossed: true,
    };
  }

  if (node.parentElement) {
    return {
      parentElement: node.parentElement,
      shadowBoundaryCrossed: false,
    };
  }

  const root = typeof node.getRootNode === 'function'
    ? node.getRootNode()
    : null;
  const shadowRootCtor = (typeof ShadowRoot !== 'undefined' && ShadowRoot)
    || node?.ownerDocument?.defaultView?.ShadowRoot
    || null;

  if (root && shadowRootCtor && root instanceof shadowRootCtor) {
    if (root.mode === 'open' && root.host) {
      return {
        parentElement: root.host,
        shadowBoundaryCrossed: true,
      };
    }

    return {
      parentElement: null,
      shadowBoundaryCrossed: true,
    };
  }

  return null;
}

function isFastVisibleForCandidateDiscovery(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  if (element.isConnected === false) return false;
  if (element.hidden) return false;
  if (element.getAttribute?.('aria-hidden') === 'true') return false;

  const tagName = element.tagName?.toLowerCase?.() || '';
  const inputType = (element.getAttribute?.('type') || '').toLowerCase();
  if (tagName === 'input' && inputType === 'hidden') return false;

  const inlineStyle = element.style || null;
  if (inlineStyle && (inlineStyle.display === 'none' || inlineStyle.visibility === 'hidden')) {
    return false;
  }

  return true;
}

function getFastVisibleControlLikeDescendants(container, mode) {
  if (!container || container.nodeType !== Node.ELEMENT_NODE) return [];

  const selector = mode === 'trigger-like'
    ? TIGHT_CONTAINER_TRIGGER_LIKE_SELECTOR
    : TIGHT_CONTAINER_INPUT_LIKE_SELECTOR;

  try {
    return Array.from(container.querySelectorAll(selector))
      .filter((candidate) => isFastVisibleForCandidateDiscovery(candidate))
      .slice(0, MAX_TIGHT_CONTAINER_CONTROL_LIKE_DESCENDANTS + 1);
  } catch {
    return [];
  }
}

function buildParentSelector(container) {
  const tagName = container?.tagName?.toLowerCase?.() || '';
  if (!tagName) return null;

  const dataTestId = container.getAttribute('data-testid');
  if (dataTestId) {
    return `[data-testid="${escapeAttributeValue(dataTestId)}"]`;
  }

  for (const attrName of ['data-cy', 'data-qa']) {
    const attrValue = container.getAttribute(attrName);
    if (!attrValue) continue;
    return `${tagName}[${attrName}="${escapeAttributeValue(attrValue)}"]`;
  }

  if (container.id && !isLikelyDynamicId(container.id)) {
    return `#${safeCssEscape(container.id)}`;
  }

  const classCandidate = getBestStableClassCandidate(container);
  if (classCandidate?.token) {
    return `.${safeCssEscape(classCandidate.token)}`;
  }

  return null;
}

function isSimpleCssSelector(selector) {
  const normalized = safeTrim(selector);
  if (!normalized) return false;
  if (normalized.includes(',')) return false;
  if (normalized.startsWith('text=') || normalized.startsWith('xpath=') || normalized.startsWith('//')) return false;
  return !/[>+~](?![^\[]*\])/.test(normalized) && !/\s{1,}/.test(normalized);
}

function buildAttributeChildSelector(element, tagName) {
  const dataTestId = element.getAttribute('data-testid');
  if (dataTestId) return `${tagName}[data-testid="${escapeAttributeValue(dataTestId)}"]`;

  for (const attrName of ['data-cy', 'data-qa']) {
    const attrValue = element.getAttribute(attrName);
    if (attrValue) return `${tagName}[${attrName}="${escapeAttributeValue(attrValue)}"]`;
  }

  const name = element.getAttribute('name');
  if (name) return `${tagName}[name="${escapeAttributeValue(name)}"]`;

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return `${tagName}[aria-label="${escapeAttributeValue(ariaLabel)}"]`;

  const placeholder = element.getAttribute('placeholder');
  if (placeholder && ['input', 'textarea'].includes(tagName)) {
    return `${tagName}[placeholder="${escapeAttributeValue(placeholder)}"]`;
  }

  return null;
}

function buildModeSpecificChildSelector(element, tagName, mode) {
  const role = (element.getAttribute('role') || '').toLowerCase();
  const ariaHasPopup = (element.getAttribute('aria-haspopup') || '').toLowerCase();
  const contentEditableAttr = (element.getAttribute('contenteditable') || '').toLowerCase();
  const hasContentEditableAttr = element.hasAttribute('contenteditable');
  const isContentEditable = !!element.isContentEditable || (hasContentEditableAttr && contentEditableAttr !== 'false');
  const inputType = (element.getAttribute('type') || '').toLowerCase();

  if (tagName === 'input' && inputType === 'search') return 'input[type="search"]';
  if (mode === 'input-like' && ['textbox', 'combobox', 'searchbox', 'spinbutton'].includes(role)) {
    return `${tagName}[role="${escapeAttributeValue(role)}"]`;
  }
  if (mode === 'input-like' && isContentEditable) return `${tagName}[contenteditable="true"]`;

  if (mode !== 'trigger-like') return null;
  if (role === 'combobox') return `${tagName}[role="combobox"]`;
  if (role === 'button' && ariaHasPopup) {
    return `${tagName}[role="button"][aria-haspopup="${escapeAttributeValue(ariaHasPopup)}"]`;
  }
  if (ariaHasPopup === 'listbox' || ariaHasPopup === 'combobox') {
    return `${tagName}[aria-haspopup="${escapeAttributeValue(ariaHasPopup)}"]`;
  }
  if (tagName === 'select') return 'select';

  return null;
}

function buildFallbackChildSelector(element, tagName, selectorResult, canReusePrimarySelector) {
  const classCandidate = getBestStableClassCandidate(element);
  if (classCandidate?.token) {
    return `${tagName}.${safeCssEscape(classCandidate.token)}`;
  }

  if (
    canReusePrimarySelector &&
    typeof selectorResult?.selector === 'string' &&
    selectorResult.priority !== 'text' &&
    selectorResult.priority !== 'xpath' &&
    isSimpleCssSelector(selectorResult.selector)
  ) {
    return selectorResult.selector;
  }

  if (['input', 'textarea', 'select', 'button'].includes(tagName)) {
    return tagName;
  }

  return null;
}

function buildChildSelector(element, selectorResult, mode, canReusePrimarySelector) {
  const tagName = element?.tagName?.toLowerCase?.() || '';
  if (!tagName) return null;

  return buildAttributeChildSelector(element, tagName)
    || buildModeSpecificChildSelector(element, tagName, mode)
    || buildFallbackChildSelector(element, tagName, selectorResult, canReusePrimarySelector);
}

function buildParentScopedChildSelector(element, selectorResult) {
  const tagName = element?.tagName?.toLowerCase?.() || '';
  if (!tagName) return null;

  return buildAttributeChildSelector(element, tagName)
    || (() => {
      const classCandidate = getBestStableClassCandidate(element);
      return classCandidate?.token ? `${tagName}.${safeCssEscape(classCandidate.token)}` : null;
    })()
    || (
      typeof selectorResult?.selector === 'string' &&
      selectorResult.priority !== 'text' &&
      selectorResult.priority !== 'xpath' &&
      isSimpleCssSelector(selectorResult.selector)
        ? selectorResult.selector
        : null
    )
    || tagName;
}

function createBlockedDiscovery(mode, blockedReason, extra = {}) {
  return {
    status: 'blocked',
    mode,
    blockedReason,
    ...extra,
  };
}

function evaluateAncestorContainer(target, container, mode, depth, shadowBoundaryCrossed, warningCodes) {
  const tagName = container.tagName?.toLowerCase?.() || '';
  const controls = getFastVisibleControlLikeDescendants(container, mode);
  const controlCount = controls.length;

  if (tagName === 'html' || tagName === 'body' || TIGHT_CONTAINER_BROAD_TAGS.has(tagName)) {
    return createBlockedDiscovery(mode, 'broad-container', {
      container,
      controlCount,
      depth,
      shadowBoundaryCrossed,
      warningCodes,
    });
  }

  if (tagName === 'form' && !(controlCount === 1 && controls[0] === target)) {
    return createBlockedDiscovery(mode, 'broad-container', {
      container,
      controlCount,
      depth,
      shadowBoundaryCrossed,
      warningCodes,
    });
  }

  if (controlCount === 1 && controls[0] === target) {
    const parentSelector = buildParentSelector(container);
    if (!parentSelector) {
      return {
        status: 'continue',
      };
    }

    const finalWarningCodes = depth >= MAX_TIGHT_CONTAINER_DEPTH
      ? [...warningCodes, 'structural-depth-limit']
      : warningCodes;

    return {
      status: 'found',
      mode,
      container,
      parentSelector,
      controlCount,
      depth,
      shadowBoundaryCrossed,
      warningCodes: finalWarningCodes,
      targetRoot: typeof target.getRootNode === 'function' ? target.getRootNode() : null,
      containerRoot: typeof container.getRootNode === 'function' ? container.getRootNode() : null,
    };
  }

  if (controlCount > MAX_TIGHT_CONTAINER_CONTROL_LIKE_DESCENDANTS) {
    return createBlockedDiscovery(mode, 'container-too-broad', {
      container,
      controlCount,
      depth,
      shadowBoundaryCrossed,
      warningCodes,
    });
  }

  if (controls.includes(target) && controlCount > 1) {
    return createBlockedDiscovery(mode, 'multiple-control-like-targets', {
      container,
      controlCount,
      depth,
      shadowBoundaryCrossed,
      warningCodes,
    });
  }

  return {
    status: 'continue',
  };
}

function findTightContainer(target, mode) {
  if (!target || target.nodeType !== Node.ELEMENT_NODE || target.isConnected === false) {
    return createBlockedDiscovery(mode, 'detached-target', {
      warningCodes: ['detached-target'],
      depth: null,
      shadowBoundaryCrossed: false,
    });
  }

  const targetRoot = typeof target.getRootNode === 'function' ? target.getRootNode() : null;
  const shadowRootCtor = (typeof ShadowRoot !== 'undefined' && ShadowRoot)
    || target?.ownerDocument?.defaultView?.ShadowRoot
    || null;
  const insideShadowDom = !!(shadowRootCtor && targetRoot instanceof shadowRootCtor);
  if (insideShadowDom && targetRoot?.mode !== 'open') {
    return createBlockedDiscovery(mode, 'unsupported-shadow-root', {
      warningCodes: ['inside-shadow-dom'],
      depth: null,
      shadowBoundaryCrossed: false,
    });
  }

  let current = getComposedParentElement(target);
  let depth = 0;
  let shadowBoundaryCrossed = false;
  const warningCodes = insideShadowDom ? ['inside-shadow-dom'] : [];

  while (current && depth <= MAX_TIGHT_CONTAINER_DEPTH) {
    if (current.shadowBoundaryCrossed) {
      shadowBoundaryCrossed = true;
      if (!warningCodes.includes('shadow-boundary-crossed')) {
        warningCodes.push('shadow-boundary-crossed');
      }
    }

    const currentElement = current.parentElement;
    if (!currentElement || currentElement.nodeType !== Node.ELEMENT_NODE) break;

    const evaluated = evaluateAncestorContainer(
      target,
      currentElement,
      mode,
      depth,
      shadowBoundaryCrossed,
      [...warningCodes],
    );
    if (evaluated.status !== 'continue') return evaluated;

    current = getComposedParentElement(currentElement);
    depth += 1;
  }

  if (depth > MAX_TIGHT_CONTAINER_DEPTH) {
    return createBlockedDiscovery(mode, 'structural-depth-limit', {
      warningCodes: insideShadowDom
        ? ['inside-shadow-dom', 'structural-depth-limit']
        : ['structural-depth-limit'],
      depth,
      shadowBoundaryCrossed,
    });
  }

  return {
    status: 'not-found',
    mode,
    blockedReason: 'no-tight-container',
    warningCodes,
    depth,
    shadowBoundaryCrossed,
  };
}

function buildTightContainerCandidate(target, selectorResult, discovery, canReusePrimarySelector) {
  if (!target || discovery?.status !== 'found' || !discovery.container) {
    return buildSkipResult(discovery?.blockedReason || 'no-tight-container');
  }

  const targetRoot = discovery.targetRoot || (typeof target.getRootNode === 'function' ? target.getRootNode() : null);
  const containerRoot = discovery.containerRoot || (typeof discovery.container.getRootNode === 'function' ? discovery.container.getRootNode() : null);
  if (discovery.shadowBoundaryCrossed && targetRoot && containerRoot && targetRoot !== containerRoot) {
    return buildSkipResult('shadow-boundary-crossed', discovery.warningCodes || []);
  }

  const parentSelector = discovery.parentSelector || buildParentSelector(discovery.container);
  if (!parentSelector) {
    return buildSkipResult('generic-parent-selector', discovery.warningCodes || []);
  }

  const childSelector = buildChildSelector(target, selectorResult, discovery.mode, canReusePrimarySelector);
  if (!childSelector) {
    return buildSkipResult('no-clean-child-selector', discovery.warningCodes || []);
  }

  return {
    candidate: {
      selector: `${parentSelector} ${childSelector}`,
      engine: 'css',
      family: 'tight-container-css',
      queryTarget: target,
      warningCodes: Array.isArray(discovery.warningCodes) ? discovery.warningCodes : [],
    },
    blockedReason: null,
  };
}

function collectParentScopedCandidate({ element, selectorResult, eventContext }) {
  const parent = element?.parentElement;
  if (!parent) return [];

  const parentSelector = buildParentSelector(parent);
  const childSelector = buildParentScopedChildSelector(element, selectorResult);
  if (!parentSelector || !childSelector) {
    return [];
  }

  return [{
    selector: `${parentSelector} > ${childSelector}`,
    engine: 'css',
    family: 'parent-scoped-css',
    queryTarget: element,
  }];
}

function logSkipOnceIfNeeded(blockedReason, logContext) {
  if (blockedReason === 'structural-depth-limit') {
    debugLogOnce(
      'structural-depth-limit',
      'Skipped structural candidate generation',
      { ...logContext, reason: blockedReason },
    );
    return true;
  }
  return false;
}

function collectTightContainerCandidate({ element, selectorResult, eventContext }) {
  const modeResult = resolveTightContainerTargetAndMode(element);
  const logContext = buildLogContext(element, eventContext);

  if (!modeResult?.target || !modeResult?.mode) {
    return [];
  }

  const discovery = findTightContainer(modeResult.target, modeResult.mode);
  if (discovery.status !== 'found') {
    if (!logSkipOnceIfNeeded(discovery.blockedReason, { ...logContext, family: 'tight-container-css' })) {
      debugLog('Skipped structural candidate generation', {
        ...logContext,
        family: 'tight-container-css',
        reason: discovery.blockedReason || discovery.status,
      });
    }
    return [];
  }

  const candidateResult = buildTightContainerCandidate(
    modeResult.target,
    selectorResult,
    discovery,
    modeResult.originalTarget === modeResult.target,
  );

  if (!candidateResult.candidate) {
    debugLog('Skipped structural candidate generation', {
      ...logContext,
      family: 'tight-container-css',
      reason: candidateResult.blockedReason || 'candidate-build-failed',
    });
    return [];
  }

  return [candidateResult.candidate];
}

export function collectStructuralCandidates({ element, selectorResult, eventContext }) {
  try {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return [];
    return [
      ...collectTightContainerCandidate({ element, selectorResult, eventContext }),
      ...collectParentScopedCandidate({ element, selectorResult, eventContext }),
    ];
  } catch (error) {
    debugLogOnce('structural-generator-error', 'Structural generator failed closed', {
      family: 'tight-container-css',
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
