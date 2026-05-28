export const POSITIONAL_FALLBACK_WARNING = 'positional-fallback-only';

function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeTextLiteral(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

export function buildScopedSelector(parentSelector, childSelector) {
  const parent = safeTrim(parentSelector);
  const child = safeTrim(childSelector);
  if (!parent || !child) return null;
  return `${parent} ${child}`;
}

export function buildScopedTextSelector(scopeSelector, text) {
  const scope = safeTrim(scopeSelector);
  const normalizedText = safeTrim(text);
  if (!scope || !normalizedText) return null;
  return `${scope}:has-text("${escapeTextLiteral(normalizedText)}")`;
}

export function buildProposalCandidateInput({
  selector,
  family,
  proposalSource,
  queryTarget,
  engine = 'css',
  warningCodes = [],
  textQuery,
  proposalTierHint = null,
  usesIndex = false,
  requiresPositionalDisambiguation = false,
} = {}) {
  const normalizedSelector = safeTrim(selector);
  const normalizedFamily = safeTrim(family);
  const normalizedProposalSource = safeTrim(proposalSource);
  if (!normalizedSelector || !normalizedFamily || !normalizedProposalSource) return null;

  const mergedWarningCodes = Array.isArray(warningCodes)
    ? warningCodes.filter((code) => typeof code === 'string' && code.trim())
    : [];
  const positional = usesIndex === true || requiresPositionalDisambiguation === true;
  if (positional && !mergedWarningCodes.includes(POSITIONAL_FALLBACK_WARNING)) {
    mergedWarningCodes.push(POSITIONAL_FALLBACK_WARNING);
  }

  return {
    selector: normalizedSelector,
    family: normalizedFamily,
    engine: safeTrim(engine) || 'css',
    proposalSource: normalizedProposalSource,
    queryTarget: queryTarget || null,
    warningCodes: mergedWarningCodes,
    proposalTierHint: safeTrim(proposalTierHint) || null,
    textQuery: textQuery && typeof textQuery === 'object'
      ? {
        scopeSelector: safeTrim(textQuery.scopeSelector),
        text: safeTrim(textQuery.text),
        matchMode: textQuery.matchMode === 'contains' ? 'contains' : 'contains',
      }
      : undefined,
    usesIndex: positional,
    requiresPositionalDisambiguation: positional,
  };
}
