import type {
  EquivalentRendering,
  SelectorCategory,
  SelectorEvaluation,
  SelectorProofLevel,
  SelectorProofSource,
  SelectorSource,
  SelectorSpec,
} from './types';
import type { CandidateValidation, RawCandidate } from './resolver/types';

function isXPathSelector(selector: string): boolean {
  const normalized = selector.trim();
  return normalized.startsWith('//') || normalized.startsWith('xpath=');
}

function descendantDepth(selector: string): number {
  return Math.max(0, (selector.match(/\s+/g)?.length ?? 0) + (selector.match(/>/g)?.length ?? 0));
}

function isStructuralSelector(selector: string): boolean {
  if (isXPathSelector(selector)) return false;
  return (
    /nth-child|nth-of-type/i.test(selector) ||
    descendantDepth(selector) >= 3 ||
    selector.length >= 80
  );
}

export function classifySelectorCategory(
  selector: string,
  source?: RawCandidate['source'] | SelectorSource,
): SelectorCategory {
  const normalized = selector.trim();
  if (!normalized) return source === 'llm' ? 'llm' : 'unknown';
  if (source === 'label-context' || source === 'trigger-context') return 'label-context';
  if (isXPathSelector(normalized)) return 'xpath';
  if (source === 'parent-scope') return 'parent-scoped';
  if (/\[data-testid=(?:"[^"]+"|'[^']+')\]/i.test(normalized)) return 'testid';
  if (/\[data-cy=(?:"[^"]+"|'[^']+')\]/i.test(normalized)) return 'data-cy';
  if (/\[data-qa=(?:"[^"]+"|'[^']+')\]/i.test(normalized)) return 'data-qa';
  if (/^#/.test(normalized) || /\[id=(?:"[^"]+"|'[^']+')\]/i.test(normalized)) return 'id';
  if (/\[name=(?:"[^"]+"|'[^']+')\]/i.test(normalized)) return 'name';
  if (/\[href[*^$]?=(?:"[^"]+"|'[^']+')\]/i.test(normalized)) return 'href';
  if (/\[placeholder=(?:"[^"]+"|'[^']+')\]/i.test(normalized)) return 'placeholder';
  if (/\[aria-label=(?:"[^"]+"|'[^']+')\]/i.test(normalized)) return 'aria-label';
  if (/\[role=(?:"[^"]+"|'[^']+')\]/i.test(normalized)) return 'role-attr';
  if (/^text=|:has-text\(/i.test(normalized)) return 'text';
  if (source === 'class' || /(?:^|[\s>])(?:[a-z0-9_-]+)?\.[a-z0-9:_-]+/i.test(normalized)) {
    return isStructuralSelector(normalized) ? 'structural' : 'class';
  }
  if (source === 'llm') return 'llm';
  if (isStructuralSelector(normalized) || source === 'path' || source === 'chained') return 'structural';
  if (normalized.includes('[')) return 'semantic-css';
  return 'unknown';
}

export function mapSelectorProofSource(params: {
  source: SelectorSource;
  proofLevel: SelectorProofLevel;
}): SelectorProofSource {
  if (params.proofLevel === 'recorded') return 'recorded';
  if (params.proofLevel === 'blocked' || params.proofLevel === 'unvalidated') return 'none';
  if (params.proofLevel === 'live_smoke_validated') return 'smoke';
  if (params.source === 'llm') return 'llm-validator';
  if (params.proofLevel === 'semantic_validated') return 'semantic';
  if (params.proofLevel === 'snapshot_validated' || params.proofLevel === 'proven_equivalent') return 'snapshot';
  return 'none';
}

export function proofScoreForValidation(validation: CandidateValidation): number {
  switch (validation.reason) {
    case 'unique-visible':
      return 1;
    case 'resolved-multi-match':
      return 0.82;
    case 'too-broad':
      return 0.38;
    case 'non-unique':
      return 0.32;
    case 'no-visible-match':
      return 0.08;
    case 'invalid-selector':
    default:
      return 0;
  }
}

export function stabilityBaseScoreForCategory(category: SelectorCategory): number {
  switch (category) {
    case 'testid':
    case 'data-cy':
    case 'data-qa':
      return 0.78;
    case 'id':
      return 0.62;
    case 'name':
      return 0.72;
    case 'href':
      return 0.7;
    case 'placeholder':
      return 0.69;
    case 'aria-label':
      return 0.67;
    case 'role-attr':
      return 0.66;
    case 'label-context':
      return 0.64;
    case 'semantic-css':
      return 0.65;
    case 'text':
      return 0.62;
    case 'parent-scoped':
      return 0.61;
    case 'class':
      return 0.55;
    case 'structural':
      return 0.42;
    case 'xpath':
      return 0.35;
    case 'llm':
      return 0.4;
    case 'unknown':
    default:
      return 0.46;
  }
}

export function summarizeSelectorEvaluation(
  selectorSpec: SelectorSpec,
  params: {
    category: SelectorCategory;
    validation: SelectorEvaluation['validation'];
    proofSource: SelectorProofSource;
    snapshotTargetEvidence?: boolean;
    proofScore: number;
    stabilityScore: number;
    semanticScore: number;
    brittlenessPenalty: number;
    entropyPenalty: number;
    finalScore: number;
    reasons: string[];
    warningCodes?: string[];
    rejectReason?: string | null;
    preferredRenderings?: EquivalentRendering[];
  },
): SelectorEvaluation {
  return {
    selectorSpec,
    category: params.category,
    validation: params.validation,
    proof: {
      proofLevel: selectorSpec.proofLevel,
      proofSource: params.proofSource,
      snapshotTargetEvidence: params.snapshotTargetEvidence,
    },
    scoring: {
      proofScore: params.proofScore,
      stabilityScore: params.stabilityScore,
      semanticScore: params.semanticScore,
      brittlenessPenalty: params.brittlenessPenalty,
    entropyPenalty: params.entropyPenalty,
    finalScore: params.finalScore,
    },
    reasons: params.reasons,
    warningCodes: params.warningCodes ?? selectorSpec.warningCodes ?? [],
    rejectReason: params.rejectReason ?? selectorSpec.rejectReason,
    preferredRenderings: params.preferredRenderings,
  };
}
