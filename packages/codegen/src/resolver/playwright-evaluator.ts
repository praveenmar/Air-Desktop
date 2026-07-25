import type {
  EvaluatedPlaywrightNativeCandidate,
  PlaywrightLocatorNode,
  PlaywrightNativeCandidate,
} from '../types';
import { isVisibleElement } from './visibility';
import { normalizeTextForMatch } from './text-matching';

/**
 * Evaluates Playwright native locator hypotheses against a snapshot.
 * This is an approximation of Playwright's locator engine for resolution purposes.
 */
export function evaluatePlaywrightCandidates(
  candidates: PlaywrightNativeCandidate[],
  context: {
    root: Document | Element;
  }
): EvaluatedPlaywrightNativeCandidate[] {
  return candidates.map(candidate => evaluateCandidate(candidate, context.root));
}

function evaluateCandidate(
  candidate: PlaywrightNativeCandidate,
  root: Document | Element
): EvaluatedPlaywrightNativeCandidate {
  const spec = candidate.spec;
  const warningCodes = [...candidate.warningCodes];

  // Task 3: Only support single-node locator specs in this ticket.
  if (spec.chain.length !== 1) {
    return {
      candidate,
      status: 'approximate',
      matchCount: 0,
      visibleMatchCount: 0,
      isUnique: false,
      isAmbiguous: false,
      isGloballyAmbiguous: false,
      rejectReason: 'chained-playwright-locator-not-supported-yet',
      warningCodes,
      validationSource: 'snapshot-approximation',
    };
  }

  const node = spec.chain[0];
  let matches: Element[] = [];

  try {
    matches = findApproximatedMatches(node, root);
  } catch (err) {
    return {
      candidate,
      status: 'approximate',
      matchCount: 0,
      visibleMatchCount: 0,
      isUnique: false,
      isAmbiguous: false,
      isGloballyAmbiguous: false,
      rejectReason: `evaluation-failed: ${err}`,
      warningCodes,
      validationSource: 'snapshot-approximation',
    };
  }

  const visibleMatches = matches.filter(isVisibleElement);

  // Task 2: Resolve Ambiguity Metadata
  const matchCount = matches.length;
  const visibleMatchCount = visibleMatches.length;
  const isUnique = visibleMatchCount === 1;
  const isAmbiguous = visibleMatchCount > 1;
  const isGloballyAmbiguous = matchCount > 1;

  let status: EvaluatedPlaywrightNativeCandidate['status'] = 'blocked';
  let rejectReason: string | undefined;

  if (matchCount === 0) {
    status = 'blocked';
    rejectReason = 'no-matches';
  } else if (visibleMatchCount === 0) {
    status = 'blocked';
    rejectReason = 'no-visible-matches';
  } else if (visibleMatchCount > 1) {
    status = 'blocked';
    rejectReason = 'multiple-visible-matches';
  } else if (visibleMatchCount === 1) {
    status = 'valid';
    if (matchCount > 1) {
      warningCodes.push('playwright-native-global-ambiguity');
    }
  }

  return {
    candidate,
    status,
    matchCount,
    visibleMatchCount,
    isUnique,
    isAmbiguous,
    isGloballyAmbiguous,
    rejectReason,
    warningCodes,
    validationSource: 'snapshot-approximation',
  };
}

function findApproximatedMatches(node: PlaywrightLocatorNode, root: Document | Element): Element[] {
  const { kind, value, options } = node;
  const allElements = Array.from(root.querySelectorAll('*'));

  switch (kind) {
    case 'getByTestId':
      return allElements.filter(el =>
        el.getAttribute('data-testid') === value ||
        el.getAttribute('data-cy') === value ||
        el.getAttribute('data-qa') === value
      );

    case 'getByPlaceholder':
      return allElements.filter(el => {
        const tagName = el.tagName.toLowerCase();
        if (tagName !== 'input' && tagName !== 'textarea') return false;
        return el.getAttribute('placeholder') === value;
      });

    case 'getByLabel':
      return findByLabelApproximation(value, options?.exact ?? true, root);

    case 'getByRole':
      return findByRoleApproximation(value, options?.name, options?.exact ?? false, root);

    default:
      throw new Error(`Unsupported locator kind: ${kind}`);
  }
}

function findByLabelApproximation(labelValue: string, exact: boolean, root: Document | Element): Element[] {
  const matches: Element[] = [];
  const normalizedValue = normalizeTextForMatch(labelValue);
  if (!normalizedValue) return [];

  const labels = Array.from(root.querySelectorAll('label'));
  const allElements = Array.from(root.querySelectorAll('*'));

  // 1. label[for]
  for (const label of labels) {
    const text = normalizeTextForMatch(label.textContent || '');
    if (matchText(text, normalizedValue, exact)) {
      const forId = label.getAttribute('for');
      if (forId) {
        const target = root.ownerDocument?.getElementById(forId) || (root as Document).getElementById?.(forId);
        if (target) matches.push(target);
      }
      
      // 2. wrapped label
      const wrappedControl = label.querySelector('input, textarea, select, [role="combobox"], [role="checkbox"], [role="radio"]');
      if (wrappedControl) matches.push(wrappedControl);
    }
  }

  // 3. aria-labelledby
  for (const el of allElements) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/).filter(Boolean);
      const combinedText = ids.map(id => {
        const ref = root.ownerDocument?.getElementById(id) || (root as Document).getElementById?.(id);
        return ref?.textContent || '';
      }).join(' ');
      
      if (matchText(normalizeTextForMatch(combinedText), normalizedValue, exact)) {
        matches.push(el);
      }
    }
  }

  return Array.from(new Set(matches));
}

function findByRoleApproximation(role: string, name: string | any, exact: boolean, root: Document | Element): Element[] {
  const allElements = Array.from(root.querySelectorAll('*'));
  const normalizedName = name ? normalizeTextForMatch(String(name)) : null;

  return allElements.filter(el => {
    const elRole = getApproximatedRole(el);
    if (elRole !== role) return false;

    if (normalizedName) {
      const elName = getApproximatedAccessibleName(el, root);
      return matchText(normalizeTextForMatch(elName), normalizedName, exact);
    }

    return true;
  });
}

function getApproximatedRole(el: Element): string | null {
  const explicitRole = el.getAttribute('role');
  if (explicitRole) return explicitRole;

  const tagName = el.tagName.toLowerCase();
  if (tagName === 'button') return 'button';
  if (tagName === 'a' && el.hasAttribute('href')) return 'link';
  if (tagName === 'textarea') return 'textbox';
  if (tagName === 'select') return 'combobox';
  if (tagName === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (['text', 'search', 'email', 'password', 'tel', 'url'].includes(type)) return 'textbox';
  }
  return null;
}

function getApproximatedAccessibleName(el: Element, root: Document | Element): string {
  // 1. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // 2. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    return ids.map(id => {
      const ref = root.ownerDocument?.getElementById(id) || (root as Document).getElementById?.(id);
      return ref?.textContent || '';
    }).join(' ');
  }

  // 3. label association (for form controls)
  if (el.id) {
    const label = (root.ownerDocument || root as Document).querySelector(`label[for="${el.id}"]`);
    if (label) return label.textContent || '';
  }
  const parentLabel = el.closest('label');
  if (parentLabel) return parentLabel.textContent || '';

  // 4. Content (for buttons, links, and explicit role-text roles)
  const role = getApproximatedRole(el);
  const roleTextRoles = ['option', 'menuitem', 'button', 'link', 'tab', 'treeitem', 'checkbox', 'radio', 'row', 'gridcell'];
  if (role && roleTextRoles.includes(role)) {
    return el.textContent || '';
  }

  // 5. Placeholder (fallback for inputs)
  const tagName = el.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') {
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;
  }

  return '';
}

function matchText(actual: string | null, expected: string, exact: boolean): boolean {
  if (!actual) return false;
  if (exact) return actual === expected;
  return actual.includes(expected);
}
