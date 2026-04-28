import type { CodegenStep } from '../types';
import type { StepSignalAttributes } from './types';

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

  attrs.id = fpAttrs?.id || extractId(selector) || undefined;
  attrs.name = fpAttrs?.name || extractAttributeValue(selector, 'name') || undefined;
  attrs.dataTestId =
    fpAttrs?.dataTestId ||
    fpAttrs?.['data-testid'] ||
    extractAttributeValue(selector, 'data-testid') ||
    undefined;
  attrs.ariaLabel =
    fpAttrs?.ariaLabel ||
    fpAttrs?.['aria-label'] ||
    extractAttributeValue(selector, 'aria-label') ||
    undefined;
  attrs.placeholder =
    fpAttrs?.placeholder || extractAttributeValue(selector, 'placeholder') || undefined;
  attrs.role = fpAttrs?.role || extractAttributeValue(selector, 'role') || undefined;
  attrs.class = extractClass(selector) ?? undefined;
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
