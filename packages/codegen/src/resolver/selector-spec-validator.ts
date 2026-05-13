import type {
  BoundedFieldStructuredSelectorSpec,
  CodegenStep,
  FlatSelectorSpec,
  LabelContextSelectorSpec,
  ScopedSelectorSpec,
  SelectorSpec,
  TriggerContextSelectorSpec,
} from '../types';
import type { CandidateValidation, RawCandidate } from './types';
import { BROAD_SELECTOR_MATCH_LIMIT } from './types';
import { validateBoundedFieldSelectorSpec } from './bounded-field/validate-bounded-field';
import {
  getElementTextSignals,
  isLikelyCssSelector,
  isTextSelector,
  normalizeTextForMatch,
  unquoteTextLiteral,
} from './text-matching';
import {
  elementLooksInputLike,
  elementLooksInteractive,
  hasFieldIntent,
} from './visibility';
import {
  findExactVisibleLabelLikeDescendants,
  getVisibleInputLikeControls,
  getVisibleTriggerLikeControls,
  normalizeStructuredSelectorText,
} from './structured-selector-utils';
import {
  isVisibleElement,
  validateCSSCandidate,
  validateTextCandidate,
} from './visibility';

export interface SelectorSpecValidationContext {
  step?: CodegenStep;
  root?: ParentNode;
}

interface MatchCollection {
  matches: Element[];
  totalMatchCount: number;
  visibleMatchCount: number;
  blockedReason?: CandidateValidation['reason'];
}

function getValidationRoot(
  snapshot: Document,
  root?: ParentNode,
): ParentNode {
  return root ?? snapshot;
}

function summarizeMatches(
  collection: MatchCollection,
): CandidateValidation {
  if (collection.blockedReason === 'invalid-selector') {
    return {
      totalMatchCount: 0,
      visibleMatchCount: 0,
      effectiveMatchCount: 0,
      reason: 'invalid-selector',
      confidenceScore: 0,
    };
  }

  if (collection.visibleMatchCount === 0) {
    return {
      totalMatchCount: collection.totalMatchCount,
      visibleMatchCount: 0,
      effectiveMatchCount: 0,
      reason: collection.blockedReason === 'too-broad' ? 'too-broad' : 'no-visible-match',
      matchCount: 0,
      confidenceScore: 0,
      resolvedElement: null,
    };
  }

  if (collection.visibleMatchCount === 1) {
    return {
      totalMatchCount: collection.totalMatchCount,
      visibleMatchCount: 1,
      effectiveMatchCount: 1,
      reason: 'unique-visible',
      matchCount: 1,
      confidenceScore: 1,
      resolvedElement: collection.matches[0] ?? null,
    };
  }

  return {
    totalMatchCount: collection.totalMatchCount,
    visibleMatchCount: collection.visibleMatchCount,
    effectiveMatchCount: collection.visibleMatchCount > 1 ? 2 : 0,
    reason: collection.totalMatchCount > BROAD_SELECTOR_MATCH_LIMIT ? 'too-broad' : 'non-unique',
    matchCount: collection.visibleMatchCount,
    confidenceScore: 0.3,
    resolvedElement: null,
  };
}

function isWithinRoot(root: ParentNode, element: Element): boolean {
  if (root === element || root === element.ownerDocument) return true;
  if ('contains' in root && typeof root.contains === 'function') {
    return root.contains(element);
  }
  return false;
}

function collectFlatMatches(
  spec: FlatSelectorSpec,
  snapshot: Document,
  context: SelectorSpecValidationContext,
): MatchCollection {
  const root = getValidationRoot(snapshot, context.root);
  const selector = spec.selector.trim();

  if (isTextSelector(selector)) {
    const rawSelector = selector.trim();
    let scopeSelector: string | null = null;
    let textNeedle = '';

    if (rawSelector.startsWith('text=')) {
      textNeedle = unquoteTextLiteral(rawSelector.slice(5).trim());
    } else {
      const hasTextMatch = rawSelector.match(/^(.*):has-text\((.*)\)$/);
      if (!hasTextMatch) {
        return {
          matches: [],
          totalMatchCount: 0,
          visibleMatchCount: 0,
          blockedReason: 'invalid-selector',
        };
      }
      scopeSelector = hasTextMatch[1]?.trim() || null;
      textNeedle = unquoteTextLiteral(hasTextMatch[2]?.trim() || '');
    }

    const normalizedNeedle = normalizeTextForMatch(textNeedle);
    if (!normalizedNeedle) {
      return {
        matches: [],
        totalMatchCount: 0,
        visibleMatchCount: 0,
        blockedReason: 'invalid-selector',
      };
    }

    let scopeMatches: Element[];
    try {
      scopeMatches = scopeSelector
        ? Array.from(root.querySelectorAll(scopeSelector))
        : Array.from(root.querySelectorAll('*'));
    } catch {
      return {
        matches: [],
        totalMatchCount: 0,
        visibleMatchCount: 0,
        blockedReason: 'invalid-selector',
      };
    }

    let matchedElements = scopeMatches.filter(element => {
      const signals = getElementTextSignals(element).map(normalizeTextForMatch).filter(Boolean);
      return signals.some(signal => signal.includes(normalizedNeedle));
    });

    if (context.step && hasFieldIntent(context.step)) {
      matchedElements = matchedElements.filter(element =>
        elementLooksInputLike(element) || elementLooksInteractive(element),
      );
    }

    const visibleMatches = matchedElements.filter(isVisibleElement);
    return {
      matches: visibleMatches,
      totalMatchCount: matchedElements.length,
      visibleMatchCount: visibleMatches.length,
      blockedReason: visibleMatches.length > BROAD_SELECTOR_MATCH_LIMIT ? 'too-broad' : undefined,
    };
  }

  if (!isLikelyCssSelector(selector)) {
    return {
      matches: [],
      totalMatchCount: 0,
      visibleMatchCount: 0,
      blockedReason: 'invalid-selector',
    };
  }

  try {
    const allMatches = Array.from(root.querySelectorAll(selector));
    const visibleMatches = allMatches.filter(isVisibleElement);
    return {
      matches: visibleMatches,
      totalMatchCount: allMatches.length,
      visibleMatchCount: visibleMatches.length,
      blockedReason: allMatches.length > BROAD_SELECTOR_MATCH_LIMIT ? 'too-broad' : undefined,
    };
  } catch {
    return {
      matches: [],
      totalMatchCount: 0,
      visibleMatchCount: 0,
      blockedReason: 'invalid-selector',
    };
  }
}

function collectLabelContextMatches(
  labelContext: LabelContextSelectorSpec,
  snapshot: Document,
  context: SelectorSpecValidationContext,
): MatchCollection {
  const root = getValidationRoot(snapshot, context.root);
  const matches: Element[] = [];

  if (labelContext.association === 'wrapped-label') {
    try {
      const labels = Array.from(root.querySelectorAll('label')).filter(label =>
        normalizeStructuredSelectorText(label.textContent || '') === normalizeStructuredSelectorText(labelContext.labelText),
      );
      for (const label of labels) {
        const controls = getVisibleInputLikeControls(label).filter(control =>
          control.tagName?.toLowerCase() === labelContext.targetTag,
        );
        if (controls.length === 1) {
          matches.push(controls[0]);
        }
      }
    } catch {
      return {
        matches: [],
        totalMatchCount: 0,
        visibleMatchCount: 0,
        blockedReason: 'invalid-selector',
      };
    }
    return {
      matches,
      totalMatchCount: matches.length,
      visibleMatchCount: matches.length,
    };
  }

  if (labelContext.association === 'bounded-field' && labelContext.containerSelector) {
    try {
      const containers = Array.from(root.querySelectorAll(labelContext.containerSelector)).filter(isVisibleElement);
      for (const container of containers) {
        const labels = Array.from(container.querySelectorAll('label')).filter(label =>
          normalizeStructuredSelectorText(label.textContent || '') === normalizeStructuredSelectorText(labelContext.labelText),
        );
        if (labels.length !== 1) continue;
        const controls = getVisibleInputLikeControls(container).filter(control =>
          control.tagName?.toLowerCase() === labelContext.targetTag,
        );
        if (controls.length === 1) {
          matches.push(controls[0]);
        }
      }
    } catch {
      return {
        matches: [],
        totalMatchCount: 0,
        visibleMatchCount: 0,
        blockedReason: 'invalid-selector',
      };
    }
    return {
      matches,
      totalMatchCount: matches.length,
      visibleMatchCount: matches.length,
    };
  }

  if (labelContext.association === 'label-for' && labelContext.targetId) {
    const target = snapshot.getElementById(labelContext.targetId);
    if (!target || !isWithinRoot(root, target) || !isVisibleElement(target)) {
      return {
        matches: [],
        totalMatchCount: target ? 1 : 0,
        visibleMatchCount: 0,
        blockedReason: target ? 'no-visible-match' : 'no-visible-match',
      };
    }
    return {
      matches: [target],
      totalMatchCount: 1,
      visibleMatchCount: 1,
    };
  }

  if (labelContext.association === 'aria-labelledby' && labelContext.ariaLabelledBy) {
    const selector = `${labelContext.targetTag}[aria-labelledby="${labelContext.ariaLabelledBy.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    return collectFlatMatches(
      {
        engine: 'css',
        selector,
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      },
      snapshot,
      context,
    );
  }

  return {
    matches: [],
    totalMatchCount: 0,
    visibleMatchCount: 0,
    blockedReason: 'invalid-selector',
  };
}

function collectTriggerContextMatches(
  triggerContext: TriggerContextSelectorSpec,
  snapshot: Document,
  context: SelectorSpecValidationContext,
): MatchCollection {
  const root = getValidationRoot(snapshot, context.root);
  if (triggerContext.association !== 'bounded-field' || !triggerContext.containerSelector) {
    return {
      matches: [],
      totalMatchCount: 0,
      visibleMatchCount: 0,
      blockedReason: 'invalid-selector',
    };
  }

  const matches: Element[] = [];
  try {
    const containers = Array.from(root.querySelectorAll(triggerContext.containerSelector)).filter(isVisibleElement);
    for (const container of containers) {
      const labelMatches = findExactVisibleLabelLikeDescendants(container, triggerContext.labelText)
        .filter(element => (element.tagName?.toLowerCase() || '') === (triggerContext.labelElementTag || 'label'));
      if (labelMatches.length !== 1) continue;
      const controls = getVisibleTriggerLikeControls(container).filter(control => {
        const childSelector = triggerContext.cleanChildSelector || triggerContext.triggerSelector;
        if (!childSelector) return false;
        try {
          return Array.from(container.querySelectorAll(childSelector)).includes(control);
        } catch {
          return false;
        }
      });
      if (controls.length === 1) {
        matches.push(controls[0]);
      }
    }
  } catch {
    return {
      matches: [],
      totalMatchCount: 0,
      visibleMatchCount: 0,
      blockedReason: 'invalid-selector',
    };
  }

  return {
    matches,
    totalMatchCount: matches.length,
    visibleMatchCount: matches.length,
  };
}

function collectScopedMatches(
  spec: ScopedSelectorSpec,
  snapshot: Document,
  context: SelectorSpecValidationContext,
): MatchCollection {
  const scopeCollection = collectMatchesForSelectorSpec(spec.scope, snapshot, context);
  if (scopeCollection.visibleMatchCount === 0) {
    return {
      matches: [],
      totalMatchCount: 0,
      visibleMatchCount: 0,
      blockedReason: scopeCollection.blockedReason ?? 'no-visible-match',
    };
  }

  const matches: Element[] = [];
  for (const scopeElement of scopeCollection.matches) {
    const targetCollection = collectMatchesForSelectorSpec(spec.target, snapshot, {
      ...context,
      root: scopeElement,
    });
    for (const match of targetCollection.matches) {
      if (isVisibleElement(match)) {
        matches.push(match);
      }
    }
  }

  return {
    matches,
    totalMatchCount: matches.length,
    visibleMatchCount: matches.length,
    blockedReason: matches.length > BROAD_SELECTOR_MATCH_LIMIT ? 'too-broad' : undefined,
  };
}

function collectMatchesForSelectorSpec(
  spec: SelectorSpec,
  snapshot: Document,
  context: SelectorSpecValidationContext,
): MatchCollection {
  switch (spec.engine) {
    case 'scoped':
      return collectScopedMatches(spec, snapshot, context);
    case 'bounded-field': {
      const validation = validateBoundedFieldStructuredSelectorSpec(spec, snapshot, context);
      return {
        matches: validation.resolvedElement ? [validation.resolvedElement] : [],
        totalMatchCount: validation.totalMatchCount,
        visibleMatchCount: validation.visibleMatchCount,
        blockedReason: validation.reason === 'unique-visible' ? undefined : validation.reason,
      };
    }
    case 'label-context':
      return spec.labelContext
        ? collectLabelContextMatches(spec.labelContext, snapshot, context)
        : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' };
    case 'trigger-context':
      return spec.triggerContext
        ? collectTriggerContextMatches(spec.triggerContext, snapshot, context)
        : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' };
    default:
      return collectFlatMatches(spec, snapshot, context);
  }
}

export function validateScopedSelectorSpec(
  spec: ScopedSelectorSpec,
  snapshot: Document,
  context: SelectorSpecValidationContext = {},
): CandidateValidation {
  return summarizeMatches(collectScopedMatches(spec, snapshot, context));
}

export function validateBoundedFieldStructuredSelectorSpec(
  spec: BoundedFieldStructuredSelectorSpec,
  snapshot: Document,
  context: SelectorSpecValidationContext = {},
): CandidateValidation {
  return validateBoundedFieldSelectorSpec(spec, snapshot, context);
}

export function validateSelectorSpec(
  spec: SelectorSpec,
  snapshot: Document,
  context: SelectorSpecValidationContext = {},
): CandidateValidation {
  switch (spec.engine) {
    case 'scoped':
      return validateScopedSelectorSpec(spec, snapshot, context);
    case 'bounded-field':
      return validateBoundedFieldStructuredSelectorSpec(spec, snapshot, context);
    case 'label-context':
      return summarizeMatches(
        spec.labelContext
          ? collectLabelContextMatches(spec.labelContext, snapshot, context)
          : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' },
      );
    case 'trigger-context':
      return summarizeMatches(
        spec.triggerContext
          ? collectTriggerContextMatches(spec.triggerContext, snapshot, context)
          : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' },
      );
    default:
      return isTextSelector(spec.selector)
        ? validateTextCandidate(spec.selector, snapshot, context.step, context.root)
        : validateCSSCandidate(spec.selector, snapshot, context.step, context.root);
  }
}

export function validateRawCandidate(
  candidate: RawCandidate,
  snapshot: Document,
  step?: CodegenStep,
): CandidateValidation {
  if (candidate.engine === 'bounded-field' && candidate.boundedField) {
    return validateBoundedFieldSelectorSpec(
      {
        selector: candidate.selector,
        engine: 'bounded-field',
        boundedField: candidate.boundedField,
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      },
      snapshot,
      { step },
    );
  }

  if (candidate.engine === 'label-context') {
    return summarizeMatches(
      candidate.labelContext
        ? collectLabelContextMatches(candidate.labelContext, snapshot, { step })
        : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' },
    );
  }

  if (candidate.engine === 'trigger-context') {
    return summarizeMatches(
      candidate.triggerContext
        ? collectTriggerContextMatches(candidate.triggerContext, snapshot, { step })
        : { matches: [], totalMatchCount: 0, visibleMatchCount: 0, blockedReason: 'invalid-selector' },
    );
  }

  const selector = candidate.selector;
  return isTextSelector(selector)
    ? validateTextCandidate(selector, snapshot, step)
    : validateCSSCandidate(selector, snapshot, step);
}
