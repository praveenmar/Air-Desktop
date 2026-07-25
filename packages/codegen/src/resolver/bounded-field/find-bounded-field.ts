import type {
  BoundedFieldControlKind,
  BoundedFieldRelation,
  FlatSelectorSpec,
  LabelContextRenderStatus,
} from '../../types';
import { cssEscape, findStableClassFromAttributes, isLikelyCssSelector } from '../text-matching';
import {
  findExactVisibleLabelLikeDescendants,
  getVisibleInputLikeControls,
  getVisibleTriggerLikeControls,
  isGenericContainerSelector,
  normalizeStructuredSelectorText,
} from '../structured-selector-utils';
import { isVisibleElement } from '../visibility';
import type {
  BoundedFieldProofMatch,
  BoundedFieldProofResult,
  BoundedFieldSpecBuildParams,
} from './types';

type ContainerSelectorKind =
  | 'data-testid'
  | 'data-cy'
  | 'data-qa'
  | 'id'
  | 'semantic-class'
  | 'framework-class'
  | 'unsafe';

const BROAD_FIELD_STOP_TAGS = new Set([
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

function isVeryOpaqueMixedId(id: string): boolean {
  if (id.length < 18) return false;
  if (!/[a-z]/i.test(id) || !/\d/.test(id)) return false;
  if (!/^[a-z0-9_-]+$/i.test(id)) return false;
  const tokens = id.split(/[-_]/).filter(Boolean);
  if (tokens.length <= 1) {
    return /[a-z]{2,}\d{2,}[a-z0-9]{6,}/i.test(id);
  }
  return tokens.every(token => token.length >= 4 && /[a-z]/i.test(token) && /\d/.test(token));
}

function hasOpaqueHyphenatedSegments(id: string): boolean {
  const tokens = id.split(/[-_]/).filter(Boolean);
  if (tokens.length < 3) return false;
  const opaqueTokens = tokens.filter(token =>
    token.length >= 4 &&
    /[a-z]/i.test(token) &&
    (/\d/.test(token) || token.length >= 8) &&
    !/(user|admin|menu|nav|search|input|button|dialog|modal|form|table|row|col|step|line|email|name|leave|logout|login|address)/i.test(token),
  );
  return opaqueTokens.length >= 2;
}

function isUtilityClassToken(token: string): boolean {
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

function isStateClassToken(token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(?:is|has)-[a-z0-9:_-]+$/i.test(normalized)) return true;
  if (/--(?:focus|focused|active|selected|open|disabled|hover|loading|expanded|collapsed|current|checked|invalid|valid|dirty|touched|visited|state)$/i.test(normalized)) {
    return true;
  }
  if (normalized.includes('data-state') || normalized.includes('headlessui-state')) return true;
  return /(focus|focused|active|selected|open|disabled|hover|loading|expanded|collapsed|current|checked|invalid|valid|dirty|touched|visited|state)/.test(normalized);
}

function isFrameworkClassToken(token: string): boolean {
  return /^(?:oxd-|mui|ant-|chakra-|radix-|headlessui-)/i.test(token);
}

function isGenericShellClassToken(token: string): boolean {
  return /^(?:container|wrapper|row|item|content|layout|shell|panel|section|body|header|footer)$/i.test(token);
}

function isCssInJsClassToken(token: string): boolean {
  return /^(?:css-|sc-)/i.test(token);
}

function isHashedRandomClassToken(token: string): boolean {
  if (isCssInJsClassToken(token)) return true;
  if (token.length < 8) return false;
  if (!/[a-z]/i.test(token)) return false;
  if (/^(?:oxd-|mui|ant-|chakra-)/i.test(token)) return false;
  if (/^[a-z0-9_-]+$/i.test(token) && /\d/.test(token)) {
    const parts = token.split(/[-_]/).filter(Boolean);
    if (parts.length <= 1) {
      return /[a-z]{2,}\d{2,}[a-z0-9]{4,}/i.test(token);
    }
    return parts.every(part => part.length >= 3 && (/\d/.test(part) || /^[a-z]{6,}$/i.test(part)));
  }
  return false;
}

function isStableRecoverableId(id: string | null | undefined): id is string {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  return !isVeryOpaqueMixedId(trimmed) && !hasOpaqueHyphenatedSegments(trimmed);
}

function classifySemanticContainerClass(stableClass: string | null | undefined): boolean {
  if (!stableClass) return false;
  return !(
    isUtilityClassToken(stableClass) ||
    isCssInJsClassToken(stableClass) ||
    isHashedRandomClassToken(stableClass) ||
    isStateClassToken(stableClass) ||
    isFrameworkClassToken(stableClass) ||
    isGenericShellClassToken(stableClass)
  );
}

function buildIdSelectors(id: string): string[] {
  const attributeSelector = `[id="${cssEscape(id)}"]`;
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) {
    return [attributeSelector];
  }
  return [`#${cssEscape(id)}`, attributeSelector];
}

function deriveSafeContainerSelector(container: Element): { selector: string | null; kind: ContainerSelectorKind } {
  const attrs = {
    id: container.getAttribute('id') || (container as HTMLElement).id || undefined,
    dataTestId: container.getAttribute('data-testid') || undefined,
    dataCy: container.getAttribute('data-cy') || undefined,
    dataQa: container.getAttribute('data-qa') || undefined,
    class: container.getAttribute('class') || undefined,
  };
  const tagName = container.tagName?.toLowerCase() || 'div';
  if (attrs.dataTestId) return { selector: `[data-testid="${cssEscape(attrs.dataTestId)}"]`, kind: 'data-testid' };
  if (attrs.dataCy) return { selector: `[data-cy="${cssEscape(attrs.dataCy)}"]`, kind: 'data-cy' };
  if (attrs.dataQa) return { selector: `[data-qa="${cssEscape(attrs.dataQa)}"]`, kind: 'data-qa' };
  if (isStableRecoverableId(attrs.id)) return { selector: buildIdSelectors(attrs.id)[0] ?? null, kind: 'id' };
  const stableClass = findStableClassFromAttributes(attrs.class);
  if (stableClass) {
    return {
      selector: `${tagName}.${cssEscape(stableClass)}`,
      kind: classifySemanticContainerClass(stableClass) ? 'semantic-class' : 'framework-class',
    };
  }
  return { selector: null, kind: 'unsafe' };
}

function summarizeContainer(container: Element): string {
  const tagName = container.tagName?.toLowerCase() || 'div';
  const className = (container.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
  if (className) return `${tagName}.${className}`;
  const role = container.getAttribute('role');
  if (role) return `${tagName}[role="${role}"]`;
  return tagName;
}

function uniqueVisibleMatches(selector: string, root: ParentNode): Element[] {
  if (!selector || !isLikelyCssSelector(selector)) return [];
  try {
    return Array.from(root.querySelectorAll(selector)).filter(isVisibleElement);
  } catch {
    return [];
  }
}

function isTriggerLikeElement(element: Element): boolean {
  return getVisibleTriggerLikeControls(element.parentElement ?? element.ownerDocument).includes(element);
}

function matchesControlKind(element: Element, controlKind: BoundedFieldControlKind): boolean {
  const tagName = element.tagName?.toLowerCase() || '';
  const role = (element.getAttribute('role') || '').toLowerCase();
  const contentEditable = (element.getAttribute('contenteditable') || '').toLowerCase();
  const inputType = (element.getAttribute('type') || '').toLowerCase();

  switch (controlKind) {
    case 'input':
      return tagName === 'input' && inputType !== 'hidden';
    case 'textarea':
      return tagName === 'textarea';
    case 'select':
      return tagName === 'select';
    case 'custom-trigger':
      return isTriggerLikeElement(element);
    case 'combobox':
      return tagName === 'select' || role === 'combobox' || (element.getAttribute('aria-haspopup') || '').toLowerCase() === 'listbox';
    case 'searchbox':
      return role === 'searchbox' || (tagName === 'input' && inputType === 'search');
    case 'contenteditable':
      return contentEditable === 'true';
    case 'unknown':
    default:
      return true;
  }
}

function getVisibleControlLikeTargets(root: ParentNode): Element[] {
  const controls = new Set<Element>();
  for (const element of getVisibleInputLikeControls(root)) controls.add(element);
  for (const element of getVisibleTriggerLikeControls(root)) controls.add(element);
  return Array.from(controls).filter(isVisibleElement);
}

function getMatchingTargetElements(
  root: ParentNode,
  targetSpec: FlatSelectorSpec,
  controlKind: BoundedFieldControlKind,
): Element[] {
  const matches = uniqueVisibleMatches(targetSpec.selector, root);
  return matches.filter(match => matchesControlKind(match, controlKind));
}

function getEligibleControlKindTargets(
  root: ParentNode,
  controlKind: BoundedFieldControlKind,
): Element[] {
  return getVisibleControlLikeTargets(root).filter(match => matchesControlKind(match, controlKind));
}

function bindTargetWithinScope(
  root: ParentNode,
  targetSpec: FlatSelectorSpec,
  controlKind: BoundedFieldControlKind,
  preferredTarget?: Element | null,
): { target: Element | null; rejectReason?: string } {
  const matchingTargets = getMatchingTargetElements(root, targetSpec, controlKind);
  if (matchingTargets.length === 1) {
    return { target: matchingTargets[0] };
  }
  if (matchingTargets.length > 1) {
    return { target: null, rejectReason: 'target_selector_ambiguous' };
  }

  const eligibleTargets = getEligibleControlKindTargets(root, controlKind);
  if (preferredTarget && eligibleTargets.includes(preferredTarget)) {
    return { target: preferredTarget };
  }
  if (eligibleTargets.length === 1) {
    return { target: eligibleTargets[0] };
  }
  if (eligibleTargets.length > 1) {
    return { target: null, rejectReason: 'bounded-field-multiple-targets' };
  }
  return { target: null, rejectReason: 'bounded-field-target-binding-failed' };
}

function deriveRenderMetadata(
  container: Element,
  targetSpec: FlatSelectorSpec,
  relation: BoundedFieldRelation,
): Pick<
  BoundedFieldProofMatch,
  'renderStatus' | 'renderReason' | 'cleanParentSelector' | 'cleanChildSelector' | 'containerSelector' | 'boundedContainerSummary' | 'warningCodes'
> {
  const containerDescriptor = deriveSafeContainerSelector(container);
  const isGeneric = isGenericContainerSelector(containerDescriptor.selector);
  
  const cleanParentSelector =
    containerDescriptor.selector &&
    ['data-testid', 'data-cy', 'data-qa', 'id', 'semantic-class'].includes(containerDescriptor.kind) &&
    !isGeneric
      ? containerDescriptor.selector
      : undefined;
  
  const cleanChildSelector = targetSpec.selector;
  let renderStatus: LabelContextRenderStatus = cleanParentSelector ? 'clean-scoped-locator' : 'proven-structural-fallback';
  let renderReason = cleanParentSelector ? 'clean_parent_unique_visible' : 'no_clean_parent_selector';

  if (!cleanParentSelector && isGeneric) {
    renderStatus = 'proof-only-no-clean-render';
    renderReason = 'generic_container_proof_only';
  }

  const warningCodes = (cleanParentSelector || renderStatus === 'proof-only-no-clean-render') 
    ? [] 
    : ['bounded-field-structural-fallback'];

  return {
    renderStatus,
    renderReason,
    cleanParentSelector,
    cleanChildSelector,
    containerSelector: containerDescriptor.selector ?? undefined,
    boundedContainerSummary: summarizeContainer(container),
    warningCodes: relation === 'bounded-container' || relation === 'sibling-label' ? warningCodes : [],
  };
}

function findExplicitAssociationProof(
  label: Element,
  targetSpec: FlatSelectorSpec,
  controlKind: BoundedFieldControlKind,
): BoundedFieldProofMatch | null {
  const doc = label.ownerDocument;
  const labelText = label.textContent || '';
  const normalizedLabelText = normalizeStructuredSelectorText(labelText);

  const labelFor = label.getAttribute('for');
  if (label.tagName?.toLowerCase() === 'label' && labelFor) {
    const target = doc.getElementById(labelFor);
    if (target && isVisibleElement(target) && matchesControlKind(target, controlKind)) {
      const targetIdSelector = buildIdSelectors(labelFor)[0] ?? `[id="${cssEscape(labelFor)}"]`;
      return {
        labelElement: label,
        targetElement: target,
        containerElement: target.parentElement ?? label.parentElement ?? label,
        relation: 'label-for',
        renderStatus: 'clean-direct-selector',
        renderReason: 'label_for_exact',
        cleanChildSelector: targetIdSelector,
      };
    }
  }

  if (label.contains?.(label)) {
    // no-op; keeps TS happy on older DOM typings
  }

  const wrappedBinding = bindTargetWithinScope(label, targetSpec, controlKind);
  if (wrappedBinding.target) {
    return {
      labelElement: label,
      targetElement: wrappedBinding.target,
      containerElement: label,
      relation: 'wrapped-label',
      ...deriveRenderMetadata(label, targetSpec, 'wrapped-label'),
    };
  }

  const labelId = label.getAttribute('id');
  if (labelId && normalizedLabelText) {
    const ariaRoot = {
      querySelectorAll: (selector: string) => doc.querySelectorAll(selector),
    } as ParentNode;
    const ariaBinding = bindTargetWithinScope(
      ariaRoot,
      {
        ...targetSpec,
        selector: `[aria-labelledby~="${cssEscape(labelId)}"]`,
      },
      controlKind,
    );
    if (ariaBinding.target) {
      const tagName = ariaBinding.target.tagName?.toLowerCase() || targetSpec.selector;
      return {
        labelElement: label,
        targetElement: ariaBinding.target,
        containerElement: ariaBinding.target.parentElement ?? label.parentElement ?? label,
        relation: 'aria-labelledby',
        renderStatus: 'clean-direct-selector',
        renderReason: 'aria_labelledby_exact',
        cleanChildSelector: `${tagName}[aria-labelledby~="${cssEscape(labelId)}"]`,
      };
    }
  }

  return null;
}

function findBoundedContainerProof(
  label: Element,
  targetSpec: FlatSelectorSpec,
  controlKind: BoundedFieldControlKind,
): BoundedFieldProofResult {
  let current: Element | null = label;
  let depth = 0;

  while (current && depth < 5) {
    const tagName = current.tagName?.toLowerCase() || '';
    if (BROAD_FIELD_STOP_TAGS.has(tagName)) break;

    const exactLabels = findExactVisibleLabelLikeDescendants(current, label.textContent || '');
    if (exactLabels.length > 1) {
      return { match: null, rejectReason: 'bounded-field-duplicate-label' };
    }

    const allControls = getVisibleControlLikeTargets(current);
    const boundTarget = bindTargetWithinScope(current, targetSpec, controlKind);
    const matchingTarget = boundTarget.target;

    if (matchingTarget) {
      if (allControls.length !== 1 || allControls[0] !== matchingTarget) {
        return { match: null, rejectReason: 'bounded-field-multiple-targets' };
      }

      return {
        match: {
          labelElement: label,
          targetElement: matchingTarget,
          containerElement: current,
          relation: label.parentElement === current ? 'sibling-label' : 'bounded-container',
          ...deriveRenderMetadata(
            current,
            targetSpec,
            label.parentElement === current ? 'sibling-label' : 'bounded-container',
          ),
        },
        rejectReason: null,
      };
    }

    if (boundTarget.rejectReason === 'target_selector_ambiguous') {
      return { match: null, rejectReason: 'target_selector_ambiguous' };
    }

    current = current.parentElement;
    depth += 1;
  }

  return { match: null, rejectReason: 'bounded-field-broad-container' };
}

export function findExactVisibleFieldLabels(root: ParentNode, labelText: string): Element[] {
  const normalized = normalizeStructuredSelectorText(labelText);
  try {
    const rootAsNode = root as Node & { querySelectorAll?: ParentNode['querySelectorAll']; ownerDocument?: Document | null };
    const scope =
      rootAsNode.nodeType === 1
        ? (root as Element)
        : (rootAsNode.ownerDocument ?? root);
    const candidates = Array.from(scope.querySelectorAll('label,legend,span,div,p')).filter(element =>
      isVisibleElement(element) &&
      normalizeStructuredSelectorText(element.textContent || '') === normalized,
    );
    return candidates.filter(element =>
      !candidates.some(other => other !== element && element.contains(other)),
    );
  } catch {
    return [];
  }
}

export function findBoundedFieldProof(
  snapshot: Document,
  params: BoundedFieldSpecBuildParams,
): BoundedFieldProofResult {
  const targetSpec = params.target.engine === 'scoped' || params.target.engine === 'bounded-field'
    ? null
    : (params.target as FlatSelectorSpec);
  if (!targetSpec || !isLikelyCssSelector(targetSpec.selector)) {
    return { match: null, rejectReason: 'invalid-target-spec' };
  }

  const labels = findExactVisibleFieldLabels(snapshot, params.labelText);
  if (labels.length === 0) {
    return { match: null, rejectReason: 'bounded-field-no-label' };
  }

  for (const label of labels) {
    if (!params.relation || params.relation === 'label-for' || params.relation === 'wrapped-label' || params.relation === 'aria-labelledby') {
      const explicit = findExplicitAssociationProof(label, targetSpec, params.controlKind);
      if (explicit) {
        if (!params.relation || params.relation === explicit.relation) {
          if (labels.length > 1) {
            explicit.warningCodes = [...(explicit.warningCodes || []), 'bounded-field-global-duplicate-label'];
          }
          return { match: explicit, rejectReason: null };
        }
      }
    }

    if (
      !params.relation ||
      params.relation === 'sibling-label' ||
      params.relation === 'bounded-container'
    ) {
      const boundedResult = findBoundedContainerProof(label, targetSpec, params.controlKind);
      if (boundedResult.match) {
        if (labels.length > 1) {
          boundedResult.match.warningCodes = [...(boundedResult.match.warningCodes || []), 'bounded-field-global-duplicate-label'];
        }
        return boundedResult;
      }
    }
  }

  return { match: null, rejectReason: 'bounded-field-broad-container' };
}
