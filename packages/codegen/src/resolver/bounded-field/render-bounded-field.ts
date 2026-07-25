import type { BoundedFieldSelectorSpec, LabelContextRenderStatus } from '../../types';

function escapeRegexLiteral(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

function buildExactHasTextRegexLiteral(text: string): string {
  return `/^${escapeRegexLiteral(text)}$/`;
}

export function classifyBoundedFieldRenderStatus(
  boundedField?: BoundedFieldSelectorSpec | null,
): LabelContextRenderStatus | undefined {
  if (!boundedField) return undefined;
  if (boundedField.renderStatus) return boundedField.renderStatus;
  if (boundedField.relation === 'label-for' || boundedField.relation === 'aria-labelledby') {
    return 'clean-direct-selector';
  }
  if (boundedField.cleanParentSelector) return 'clean-scoped-locator';
  return 'proven-structural-fallback';
}

export function renderBoundedFieldLocator(
  boundedField?: BoundedFieldSelectorSpec | null,
): string | null {
  if (!boundedField) return null;

  const renderStatus = classifyBoundedFieldRenderStatus(boundedField);
  const childSelector = boundedField.cleanChildSelector || boundedField.target.selector;
  if (!childSelector) return null;

  if (renderStatus === 'clean-direct-selector') {
    return `locator(${JSON.stringify(childSelector)})`;
  }

  if (renderStatus === 'clean-scoped-locator') {
    if (!boundedField.cleanParentSelector) return null;
    return `locator(${JSON.stringify(boundedField.cleanParentSelector)}).locator(${JSON.stringify(childSelector)})`;
  }

  if (renderStatus === 'proven-structural-fallback') {
    const containerSelector = boundedField.containerSelector || boundedField.cleanParentSelector;
    if (!containerSelector) return null;
    const labelTag = boundedField.labelElementTag || 'label';
    const labelRegex = buildExactHasTextRegexLiteral(boundedField.labelText);
    return `locator(${JSON.stringify(containerSelector)}).filter({ has: this.page.locator(${JSON.stringify(labelTag)}).filter({ hasText: ${labelRegex} }) }).locator(${JSON.stringify(childSelector)})`;
  }

  return null;
}

export function getBoundedFieldRenderingWarnings(
  boundedField?: BoundedFieldSelectorSpec | null,
): string[] {
  if (!boundedField) return [];
  const warnings = new Set<string>(boundedField.warningCodes ?? []);
  const renderStatus = classifyBoundedFieldRenderStatus(boundedField);
  if (renderStatus === 'proven-structural-fallback') warnings.add('bounded-field-structural-fallback');
  if (renderStatus === 'proof-only-no-clean-render') warnings.add('bounded-field-proof-only');
  if (renderStatus === 'blocked-unsafe-render') warnings.add('bounded-field-blocked-unsafe-render');
  return Array.from(warnings);
}

export function buildBoundedFieldWarningComments(
  boundedField?: BoundedFieldSelectorSpec | null,
): string[] {
  if (!boundedField) return [];
  if (classifyBoundedFieldRenderStatus(boundedField) !== 'proven-structural-fallback') return [];
  return [
    `// AIR WARNING: Structural bounded-field fallback.`,
    `// Reason: ${boundedField.renderReason || `no stable direct selector existed for field "${boundedField.labelText}".`}`,
    `// Proof: exact label + one visible target control inside bounded field container.`,
    `// Consider adding data-testid/name/aria-label for a cleaner locator.`,
  ];
}
