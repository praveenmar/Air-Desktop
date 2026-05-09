import type {
  EquivalentRendering,
  SelectorEngine,
  SelectorPriority,
  SelectorProofLevel,
  SelectorSource,
  SelectorSpec,
} from './types';

function trimSelector(selector: string | null | undefined): string {
  return typeof selector === 'string' ? selector.trim() : '';
}

export function inferSelectorEngine(
  selector: string | null | undefined,
  selectorPriority?: SelectorPriority | string,
): SelectorEngine {
  const trimmed = trimSelector(selector);

  if (/^getByTestId\(/.test(trimmed)) return 'testid';
  if (/^getByRole\(/.test(trimmed)) return 'role';
  if (/^getByLabel\(/.test(trimmed)) return 'label';
  if (/^getByPlaceholder\(/.test(trimmed)) return 'placeholder';
  if (/^getByText\(/.test(trimmed)) return 'text';
  if (/^(?:locator|getBy)[A-Za-z]/.test(trimmed)) return 'playwright';
  if (trimmed.startsWith('text=') || /:has-text\((?:"[^"]*"|'[^']*')\)/i.test(trimmed)) return 'text';
  if (trimmed.startsWith('//') || trimmed.startsWith('xpath=') || /^id\(".*"\)$/i.test(trimmed)) return 'xpath';

  if (selectorPriority === 'xpath') return 'xpath';
  if (selectorPriority === 'text') return 'text';

  return 'css';
}

export function buildSelectorSpec(params: {
  selector: string;
  selectorPriority?: SelectorPriority | string;
  engine?: SelectorEngine;
  source: SelectorSource;
  proofLevel: SelectorProofLevel;
  rank?: number;
  confidence?: number;
  rejectReason?: string | null;
  warningCodes?: string[] | null;
}): SelectorSpec {
  const selector = trimSelector(params.selector);
  const warningCodes = Array.from(new Set((params.warningCodes ?? []).filter(Boolean)));

  return {
    selector,
    engine: params.engine ?? inferSelectorEngine(selector, params.selectorPriority),
    source: params.source,
    proofLevel: params.proofLevel,
    rank: typeof params.rank === 'number' ? params.rank : undefined,
    confidence: typeof params.confidence === 'number' ? params.confidence : undefined,
    rejectReason: params.rejectReason ?? undefined,
    warningCodes: warningCodes.length > 0 ? warningCodes : undefined,
  };
}

export function isSelectorSpecExactProofLevel(
  proofLevel: SelectorProofLevel | undefined,
): boolean {
  return (
    proofLevel === 'recorded' ||
    proofLevel === 'snapshot_validated' ||
    proofLevel === 'semantic_validated' ||
    proofLevel === 'live_smoke_validated' ||
    proofLevel === 'weak_but_usable'
  );
}

export function isSelectorSpecRenderableAsNative(
  spec: SelectorSpec | undefined,
): boolean {
  if (!spec) return false;
  const selector = spec.selector.trim();
  const hasNativeExpression =
    /^getBy(?:TestId|Role|Label|Placeholder|Text)\(/.test(selector) ||
    /^locator\(/.test(selector);
  if (!hasNativeExpression) return false;

  switch (spec.engine) {
    case 'role':
    case 'label':
      return spec.proofLevel === 'recorded' || spec.proofLevel === 'live_smoke_validated';
    case 'testid':
    case 'placeholder':
    case 'playwright':
      return (
        spec.proofLevel === 'proven_equivalent' ||
        spec.proofLevel === 'recorded' ||
        spec.proofLevel === 'live_smoke_validated'
      );
    case 'text':
      return (
        /^getByText\(/.test(selector) &&
        (
          spec.proofLevel === 'proven_equivalent' ||
          spec.proofLevel === 'recorded' ||
          spec.proofLevel === 'live_smoke_validated'
        )
      );
    default:
      return false;
  }
}

export function isEquivalentRenderingRenderable(
  rendering: EquivalentRendering | undefined,
): boolean {
  if (!rendering) return false;
  switch (rendering.engine) {
    case 'testid':
    case 'placeholder':
    case 'text':
    case 'playwright':
      return (
        rendering.proofLevel === 'proven_equivalent' ||
        rendering.proofLevel === 'recorded' ||
        rendering.proofLevel === 'live_smoke_validated'
      );
    case 'role':
    case 'label':
    default:
      return false;
  }
}

export function canRenderSelectorSpecConfidently(
  spec: SelectorSpec | undefined,
): boolean {
  if (!spec) return false;
  return !(
    spec.proofLevel === 'blocked' ||
    spec.proofLevel === 'unvalidated' ||
    spec.proofLevel === 'inferred_unproven'
  );
}

export function getSelectorSpecRenderingWarnings(
  spec: SelectorSpec | undefined,
): string[] {
  if (!spec) return [];

  const warnings = new Set(spec.warningCodes ?? []);
  switch (spec.proofLevel) {
    case 'recorded':
      warnings.add('recorded-not-revalidated');
      break;
    case 'weak_but_usable':
      warnings.add('weak-selector');
      break;
    case 'inferred_unproven':
      warnings.add('inferred-unproven');
      break;
    case 'blocked':
      warnings.add('blocked-selector');
      break;
    case 'unvalidated':
      warnings.add('unvalidated-selector');
      break;
    default:
      break;
  }
  return Array.from(warnings);
}

export function pickPreferredEquivalentRendering(
  renderings: EquivalentRendering[] | undefined,
): EquivalentRendering | null {
  if (!Array.isArray(renderings) || renderings.length === 0) return null;
  return renderings.find(rendering => isEquivalentRenderingRenderable(rendering)) ?? null;
}

export function renderLocatorExpressionFromSelectorSpec(
  spec: SelectorSpec | undefined,
): string | null {
  if (!spec) return null;
  if (isSelectorSpecRenderableAsNative(spec)) {
    return spec.selector.trim();
  }
  return `locator(${JSON.stringify(spec.selector)})`;
}

export function renderLocatorExpressionFromEquivalentRendering(
  rendering: EquivalentRendering | undefined,
): string | null {
  if (!rendering || !isEquivalentRenderingRenderable(rendering)) return null;
  return rendering.locator.trim();
}
