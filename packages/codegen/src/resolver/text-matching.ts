import type { CodegenStep } from '../types';
import type { StepSignalAttributes } from './types';

export interface SemanticTextSignal {
  value: string;
  source: string;
}

function logFingerprintInference(
  attribute: string,
  selector: string,
): void {
  console.warn('FINGERPRINT_ATTRIBUTE_INFERRED_DOWNSTREAM', {
    attribute,
    selector,
  });
}

export function cssEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '\\D ')
    .replace(/\t/g, '\\9 ');
}

export function isLikelyCssSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('text=')) return false;
  if (trimmed.startsWith('//')) return false;
  if (trimmed.startsWith('xpath=')) return false;
  if (/^id\(".*"\)$/i.test(trimmed)) return false;
  return true;
}

export function isTextSelector(selector: string): boolean {
  const trimmed = selector.trim();
  return trimmed.startsWith('text=') || /:has-text\((?:"[^"]*"|'[^']*')\)/i.test(trimmed);
}

export function extractAttributeValue(selector: string, attribute: string): string | null {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = selector.match(new RegExp(`\\[${escaped}=(?:"([^"]*)"|'([^']*)')\\]`, 'i'));
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

export function extractId(selector: string): string | null {
  const attrId = extractAttributeValue(selector, 'id');
  if (attrId) return attrId;
  if (!selector.startsWith('#')) return null;
  const match = selector.slice(1).match(/^[a-zA-Z0-9_-]+/);
  return match?.[0] ?? null;
}

export function extractClass(selector: string): string | null {
  const match = selector.match(/\.([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

export function extractTextExcerpt(step: CodegenStep): string | null {
  const hasTextMatch = step.selector.match(/:has-text\((?:"([^"]*)"|'([^']*)')\)/i);
  if (hasTextMatch) {
    return hasTextMatch[1] ?? hasTextMatch[2] ?? null;
  }
  if (step.selector.startsWith('text=')) {
    return step.selector.slice(5).trim() || null;
  }
  const intentParts = step.intent.split('_').slice(1).join(' ').trim();
  return intentParts.length > 1 ? intentParts : null;
}

export function inferStepSignalAttributes(step: CodegenStep): StepSignalAttributes {
  const attrs: StepSignalAttributes = {};
  const selector = step.selector || '';
  const fingerprint = step.fingerprint;
  const fpAttrs = fingerprint?.attributes;

  const preferFingerprint = (
    field: string,
    fingerprintValue: string | undefined,
    inferredValue: string | null,
  ): string | undefined => {
    if (typeof fingerprintValue === 'string' && fingerprintValue.length > 0) {
      return fingerprintValue;
    }
    if (typeof inferredValue === 'string' && inferredValue.length > 0) {
      logFingerprintInference(field, selector);
      return inferredValue;
    }
    return undefined;
  };

  attrs.id = preferFingerprint('id', fpAttrs?.id, extractId(selector));
  attrs.name = preferFingerprint('name', fpAttrs?.name, extractAttributeValue(selector, 'name'));
  attrs.dataTestId = preferFingerprint(
    'data-testid',
    fpAttrs?.dataTestId || fpAttrs?.['data-testid'],
    extractAttributeValue(selector, 'data-testid'),
  );
  attrs.dataCy = preferFingerprint(
    'data-cy',
    fpAttrs?.dataCy || fpAttrs?.['data-cy'],
    extractAttributeValue(selector, 'data-cy'),
  );
  attrs.dataQa = preferFingerprint(
    'data-qa',
    fpAttrs?.dataQa || fpAttrs?.['data-qa'],
    extractAttributeValue(selector, 'data-qa'),
  );
  attrs.ariaLabel = preferFingerprint(
    'aria-label',
    fpAttrs?.ariaLabel || fpAttrs?.['aria-label'],
    extractAttributeValue(selector, 'aria-label'),
  );
  attrs.ariaLabelledBy = preferFingerprint(
    'aria-labelledby',
    fpAttrs?.ariaLabelledBy || fpAttrs?.['aria-labelledby'],
    extractAttributeValue(selector, 'aria-labelledby'),
  );
  attrs.ariaDescribedBy = preferFingerprint(
    'aria-describedby',
    fpAttrs?.ariaDescribedBy || fpAttrs?.['aria-describedby'],
    extractAttributeValue(selector, 'aria-describedby'),
  );
  attrs.placeholder = preferFingerprint(
    'placeholder',
    fpAttrs?.placeholder,
    extractAttributeValue(selector, 'placeholder'),
  );
  attrs.autocomplete = preferFingerprint(
    'autocomplete',
    fpAttrs?.autocomplete,
    extractAttributeValue(selector, 'autocomplete'),
  );
  attrs.role = preferFingerprint('role', fpAttrs?.role, extractAttributeValue(selector, 'role'));
  attrs.href = preferFingerprint('href', fpAttrs?.href, extractAttributeValue(selector, 'href'));
  attrs.type = preferFingerprint('type', fpAttrs?.type, extractAttributeValue(selector, 'type'));
  attrs.title = preferFingerprint('title', fpAttrs?.title, extractAttributeValue(selector, 'title'));
  attrs.alt = preferFingerprint('alt', fpAttrs?.alt, extractAttributeValue(selector, 'alt'));
  attrs.value = preferFingerprint('value', fpAttrs?.value, extractAttributeValue(selector, 'value'));
  attrs.associatedLabelText = typeof fpAttrs?.associatedLabelText === 'string' ? fpAttrs.associatedLabelText : undefined;
  attrs.wrappedLabelText = typeof fpAttrs?.wrappedLabelText === 'string' ? fpAttrs.wrappedLabelText : undefined;
  attrs.labelledByText = typeof fpAttrs?.labelledByText === 'string' ? fpAttrs.labelledByText : undefined;
  attrs.describedByText = typeof fpAttrs?.describedByText === 'string' ? fpAttrs.describedByText : undefined;
  attrs.fieldLabelText =
    typeof fpAttrs?.fieldLabelText === 'string'
      ? fpAttrs.fieldLabelText
      : (typeof fingerprint?.boundedFieldContext?.fieldLabelText === 'string'
          ? fingerprint.boundedFieldContext.fieldLabelText
          : undefined);
  attrs.class = (fpAttrs as Record<string, string | undefined> | undefined)?.class || extractClass(selector) || undefined;
  attrs.tagName = fingerprint?.tagName?.toLowerCase();
  attrs.parentSelector = fingerprint?.parentSelector ?? undefined;

  return attrs;
}

export function normalizeStaticText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function getElementTextSignals(element: Element): string[] {
  const values: string[] = [];
  const push = (value: string | null | undefined): void => {
    if (typeof value !== 'string') return;
    const normalized = normalizeStaticText(value);
    if (!normalized) return;
    if (values.includes(normalized)) return;
    values.push(normalized);
  };

  const htmlElement = element as HTMLElement & { value?: string };
  const tagName = (htmlElement.tagName || '').toLowerCase();

  push(htmlElement.getAttribute('value'));
  if (tagName === 'input' || tagName === 'textarea') {
    if (typeof htmlElement.value === 'string') push(htmlElement.value);
  }

  push(htmlElement.getAttribute('aria-label'));
  push(htmlElement.getAttribute('placeholder'));
  push(htmlElement.textContent || '');

  return values;
}

function pushSemanticSignal(
  signals: SemanticTextSignal[],
  value: string | null | undefined,
  source: string,
): void {
  if (typeof value !== 'string') return;
  const normalized = normalizeStaticText(value);
  if (!normalized) return;
  if (signals.some(signal => signal.value === normalized && signal.source === source)) return;
  signals.push({ value: normalized, source });
}

function getDirectChildren(element: Element): Element[] {
  const rawChildren = (element as HTMLElement & { children?: ArrayLike<Element> }).children;
  if (!rawChildren) return [];
  return Array.from(rawChildren as ArrayLike<Element>);
}

function getChildSemanticTextSignals(element: Element): SemanticTextSignal[] {
  const signals: SemanticTextSignal[] = [];
  for (const child of getDirectChildren(element)) {
    const tagName = (((child as HTMLElement).tagName) || '').toLowerCase();
    if (tagName === 'svg') {
      for (const grandChild of getDirectChildren(child)) {
        const grandTag = (((grandChild as HTMLElement).tagName) || '').toLowerCase();
        if (grandTag === 'title') {
          pushSemanticSignal(signals, grandChild.textContent || '', 'icon_child_svg_title');
        }
      }
      continue;
    }
    if (tagName === 'img') {
      pushSemanticSignal(signals, child.getAttribute('alt'), 'icon_child_alt');
    }
    pushSemanticSignal(signals, child.getAttribute('aria-label'), 'icon_child_aria_label');
    pushSemanticSignal(signals, child.getAttribute('title'), 'icon_child_title');
  }
  return signals;
}

function getAssociatedLabelSignals(element: Element, snapshot: Document): SemanticTextSignal[] {
  const signals: SemanticTextSignal[] = [];
  const htmlElement = element as HTMLElement;
  const id = htmlElement.getAttribute('id') || htmlElement.id || '';
  if (id) {
    try {
      for (const label of Array.from(snapshot.querySelectorAll('label'))) {
        if (label.getAttribute('for') !== id) continue;
        pushSemanticSignal(signals, label.textContent || '', 'label_for');
      }
    } catch {
      // Ignore selector support issues in synthetic test docs.
    }
  }

  const labelledBy = htmlElement.getAttribute('aria-labelledby') || '';
  if (labelledBy) {
    for (const refId of labelledBy.split(/\s+/).filter(Boolean)) {
      try {
        const ref = snapshot.querySelector(`#${cssEscape(refId)}`);
        if (ref) {
          pushSemanticSignal(signals, ref.textContent || '', 'aria_labelledby');
        }
      } catch {
        // Ignore selector support issues in synthetic test docs.
      }
    }
  }

  const parent = htmlElement.parentElement;
  const parentTag = (((parent as HTMLElement | null)?.tagName) || '').toLowerCase();
  if (parent && parentTag === 'label') {
    pushSemanticSignal(signals, parent.textContent || '', 'wrapped_label');
  }

  return signals;
}

function getStrictParentWrapperSignals(element: Element): SemanticTextSignal[] {
  const signals: SemanticTextSignal[] = [];
  const parent = (element as HTMLElement).parentElement as (HTMLElement & { children?: ArrayLike<Element> }) | null;
  if (!parent) return signals;

  const parentTag = (parent.tagName || '').toLowerCase();
  const disallowed = new Set(['html', 'body', 'main', 'section', 'article', 'form', 'table', 'tbody', 'thead']);
  if (disallowed.has(parentTag)) return signals;

  const children = parent.children ? Array.from(parent.children as ArrayLike<Element>) : [];
  const compatibleControls = children.filter(child => {
    const tagName = (((child as HTMLElement).tagName) || '').toLowerCase();
    return ['input', 'textarea', 'select', 'button', 'a', 'label'].includes(tagName);
  });
  if (compatibleControls.length !== 1) return signals;

  const text = normalizeStaticText(parent.textContent || '');
  if (!text || text.length > 80) return signals;
  pushSemanticSignal(signals, text, 'parent_wrapper_text');
  return signals;
}

export function getElementSemanticTextSignals(element: Element, snapshot?: Document): SemanticTextSignal[] {
  const signals: SemanticTextSignal[] = [];
  const htmlElement = element as HTMLElement & { value?: string };
  const tagName = (htmlElement.tagName || '').toLowerCase();

  pushSemanticSignal(signals, htmlElement.textContent || '', 'visible_text');
  pushSemanticSignal(signals, htmlElement.getAttribute('aria-label'), 'aria_label');
  pushSemanticSignal(signals, htmlElement.getAttribute('placeholder'), 'placeholder');
  pushSemanticSignal(signals, htmlElement.getAttribute('title'), 'title');
  pushSemanticSignal(signals, htmlElement.getAttribute('alt'), 'alt');

  const type = (htmlElement.getAttribute('type') || '').toLowerCase();
  const attrValue = htmlElement.getAttribute('value');
  if (
    attrValue &&
    tagName !== 'input' &&
    tagName !== 'textarea'
  ) {
    pushSemanticSignal(signals, attrValue, 'value');
  } else if (
    attrValue &&
    ['checkbox', 'radio', 'option'].includes(type)
  ) {
    pushSemanticSignal(signals, attrValue, 'value');
  }

  if (snapshot) {
    for (const signal of getAssociatedLabelSignals(element, snapshot)) {
      pushSemanticSignal(signals, signal.value, signal.source);
    }
  }

  for (const signal of getStrictParentWrapperSignals(element)) {
    pushSemanticSignal(signals, signal.value, signal.source);
  }

  if (tagName === 'button' || tagName === 'a') {
    for (const signal of getChildSemanticTextSignals(element)) {
      pushSemanticSignal(signals, signal.value, signal.source);
    }
  }

  return signals;
}

export function getElementContextHints(element: Element): {
  parentTag?: string;
  nearestContainerTag?: string;
} {
  const parent = (element as HTMLElement).parentElement;
  const parentTag = parent ? ((parent.tagName || '').toLowerCase() || undefined) : undefined;

  let nearestContainerTag: string | undefined;
  let current = parent as HTMLElement | null;
  const containerTags = new Set(['form', 'dialog', 'nav', 'menu', 'table', 'tr']);
  while (current) {
    const tagName = (current.tagName || '').toLowerCase();
    if (containerTags.has(tagName)) {
      nearestContainerTag = tagName;
      break;
    }
    current = current.parentElement as HTMLElement | null;
  }

  return { parentTag, nearestContainerTag };
}

export function textFromElement(element: Element): string | null {
  const values = getElementTextSignals(element);
  if (values.length === 0) return null;
  return values.join(' ').slice(0, 80);
}

export function findStableClassFromAttributes(classAttr?: string): string | null {
  if (!classAttr) return null;
  const classes = classAttr.split(/\s+/).filter(Boolean);
  if (classes.length === 0) return null;

  const bannedPatterns = [
    /\d{4,}/,
    /^css-/,
    /^sc-/,
    /^Mui/,
    /^ant-/,
    /^chakra-/,
  ];
  const utilityPrefixes = ['mt-', 'mb-', 'pt-', 'pb-', 'flex', 'text-', 'bg-'];

  const filtered = classes.filter(cls => !bannedPatterns.some(re => re.test(cls)));
  if (filtered.length === 0) return null;

  filtered.sort((a, b) => {
    const aUtility = utilityPrefixes.some(prefix => a.startsWith(prefix));
    const bUtility = utilityPrefixes.some(prefix => b.startsWith(prefix));
    if (aUtility && !bUtility) return 1;
    if (!aUtility && bUtility) return -1;
    return a.length - b.length;
  });

  return filtered[0] ?? null;
}

export function isDynamicText(text: string, options?: { allowNumericText?: boolean }): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length > 80) return true;
  if (options?.allowNumericText) {
    if (/\d{6,}/.test(trimmed)) return true;
  } else if (/\d{4,}/.test(trimmed)) {
    return true;
  }
  if (/(?:uuid|guid|session|token|timestamp)/i.test(trimmed)) return true;
  return false;
}

export function normalizeTextForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function unquoteTextLiteral(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function escapeTextSelectorValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractStableParentSelector(step: CodegenStep, attrs?: StepSignalAttributes): string | null {
  if (attrs?.parentSelector && isLikelyCssSelector(attrs.parentSelector)) {
    return attrs.parentSelector;
  }

  const selector = step.selector;
  if (!selector) return null;

  const splitByChild = selector.split(' > ');
  if (splitByChild.length > 1) {
    return splitByChild.slice(0, -1).join(' > ').trim() || null;
  }

  const splitByDescendant = selector.split(/\s+/);
  if (splitByDescendant.length > 1) {
    return splitByDescendant.slice(0, -1).join(' ').trim() || null;
  }

  return null;
}
