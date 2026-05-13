import { isVisibleElement } from './visibility';

export function normalizeStructuredSelectorText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:*]\s*$/, '') // Remove trailing colons or asterisks (common in forms)
    .trim()
    .toLowerCase();
}

export function getVisibleInputLikeControls(root: ParentNode): Element[] {
  try {
    return Array.from(
      root.querySelectorAll(
        'input,textarea,select,[role="textbox"],[role="combobox"],[role="searchbox"],[role="spinbutton"],[contenteditable="true"],[aria-haspopup="listbox"],[aria-haspopup="combobox"]',
      ),
    ).filter(isVisibleElement);
  } catch {
    return [];
  }
}

export function getVisibleTriggerLikeControls(root: ParentNode): Element[] {
  try {
    return Array.from(
      root.querySelectorAll(
        'select,[role="combobox"],[role="button"][aria-haspopup],[aria-haspopup="listbox"],[aria-haspopup="combobox"],button[aria-haspopup],input[role="combobox"],[contenteditable="true"]',
      ),
    ).filter(isVisibleElement);
  } catch {
    return [];
  }
}

export function findExactVisibleLabelLikeDescendants(root: Element, labelText: string): Element[] {
  const normalizedLabel = normalizeStructuredSelectorText(labelText);
  try {
    const candidates = Array.from(root.querySelectorAll('label,legend,span,div,p')).filter(element =>
      isVisibleElement(element) &&
      normalizeStructuredSelectorText(element.textContent || '') === normalizedLabel,
    );
    return candidates.filter(element =>
      !candidates.some(other => other !== element && element.contains(other)),
    );
  } catch {
    return [];
  }
}

export function findTightFieldContainer(
  label: Element,
  target: Element,
): { container: Element | null; blockedReason?: string } {
  let current: Element | null = label;
  let depth = 0;
  while (current && depth < 5) {
    const tagName = current.tagName?.toLowerCase() || '';
    if (['body', 'html', 'main', 'section', 'article', 'table', 'tbody', 'thead', 'form'].includes(tagName)) {
      break;
    }

    const controls = getVisibleInputLikeControls(current);
    if (controls.length === 1 && controls[0] === target) {
      return { container: current };
    }

    if (controls.length > 1 && controls.includes(target)) {
      return { container: null, blockedReason: 'multiple_input_like_targets' };
    }

    current = current.parentElement;
    depth += 1;
  }

  return { container: null, blockedReason: 'broad_container_only' };
}

export function findTightTriggerContainer(
  target: Element,
  labelText: string,
): { container: Element | null; labelElement?: Element | null; blockedReason?: string } {
  let current: Element | null = target;
  let depth = 0;
  while (current && depth < 5) {
    const tagName = current.tagName?.toLowerCase() || '';
    if (['body', 'html', 'main', 'section', 'article', 'table', 'tbody', 'thead', 'form'].includes(tagName)) {
      break;
    }

    const labels = findExactVisibleLabelLikeDescendants(current, labelText);
    if (labels.length > 1) {
      return { container: null, labelElement: null, blockedReason: 'duplicate_label_text' };
    }

    const controls = getVisibleTriggerLikeControls(current);
    if (labels.length === 1 && controls.length === 1 && controls[0] === target) {
      return { container: current, labelElement: labels[0] };
    }

    if (labels.length === 1 && controls.length > 1 && controls.includes(target)) {
      return { container: null, labelElement: labels[0], blockedReason: 'multiple_input_like_targets' };
    }

    current = current.parentElement;
    depth += 1;
  }

  return { container: null, labelElement: null, blockedReason: 'broad_container_only' };
}
export function isGenericContainerSelector(selector: string | null | undefined): boolean {
  if (!selector) return true;
  const normalized = selector.trim().toLowerCase();
  
  // Tag-only generic selectors
  if (['div', 'span', 'body', 'html', 'main', 'section', 'article', 'form', 'table'].includes(normalized)) {
    return true;
  }

  // Common broad class names (case-insensitive)
  const genericClassPatterns = [
    /\.container\b/i,
    /\.wrapper\b/i,
    /\.content\b/i,
    /\.row\b/i,
    /\.form\b/i,
  ];

  if (genericClassPatterns.some(pattern => pattern.test(normalized))) {
    return true;
  }

  return false;
}
