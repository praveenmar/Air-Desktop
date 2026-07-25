import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';
import { analyzeClassToken, scoreClassCandidate } from './structural.js';
import { collectMatchMetadata } from '../evaluation.js';
import { safeCssEscape, escapeQuotedAttributeValue } from '../utils.js';

/**
 * Class 6 - Pragmatic CSS Fallback
 * Generates a valid Playwright CSS string using matchCount > 1 && visibleMatchCount === 1 
 * visibility filtering, acting as a final safety net for garbage DOMs (e.g. duplicated ng-hide containers).
 * 
 * @param {Element} element
 * @returns {import('../contracts/selector-class-contract.js').Candidate[]}
 */
export function collectPragmaticCssCandidates(element) {
  if (!element || element.nodeType !== 1) return [];

  const tagName = element.tagName.toLowerCase();
  if (['html', 'body', 'head'].includes(tagName)) return [];

  const rawClasses = [...element.classList];
  if (rawClasses.length === 0) return [];

  const rankedClasses = rawClasses
    .map((token) => ({
      token,
      analysis: analyzeClassToken(token),
      score: scoreClassCandidate(token).score
    }))
    .filter((entry) => !entry.analysis.usesDynamicClass)
    .sort((a, b) => b.score - a.score);

  if (rankedClasses.length === 0) return [];

  // Take the top up to 5 highest-scoring classes
  const selectedClasses = rankedClasses.slice(0, 5).map((entry) => entry.token);
  let baseSelector = `${tagName}.${selectedClasses.map(c => safeCssEscape(c)).join('.')}`;

  // Add highly differentiating stable attributes to give visibility rescue a better chance
  for (const attr of ['name', 'title', 'alt', 'placeholder', 'value', 'type']) {
    const val = element.getAttribute(attr);
    if (val) {
      baseSelector += `[${attr}="${escapeQuotedAttributeValue(val)}"]`;
    }
  }

  // Evaluate Native Matches
  const metadata = collectMatchMetadata(element, { selector: baseSelector });

  // The Visibility Rescue
  if (metadata.matchCount > 1 && metadata.visibleMatchCount === 1 && metadata.positionInVisibleMatches === 0) {
    return [
      createCandidate({
        classId: SelectorClassIds.PRAGMATIC_CSS_FALLBACK,
        selector: `${baseSelector}:visible`,
        engine: SelectorEngines.PLAYWRIGHT_CSS,
        // family drives preference-tiers scoring: 'parent-scoped-css' base=68 + uniqueness bonuses = 82 (preferred),
        // which outranks duplicate-id candidates like #bunny that score ~70.
        family: 'parent-scoped-css',
        proof: {
          strategy: 'pragmatic-visibility-rescue',
          baseSelector,
        },
        metadata: {
          requiresPlaywrightEngine: true, // Crucial for Strip & Verify protocol
          tier: 'fallback'
        },
      }),
    ];
  }

  // If it's naturally unique without visibility rescue, return it as a normal CSS fallback
  if (metadata.matchCount === 1) {
    return [
      createCandidate({
        classId: SelectorClassIds.PRAGMATIC_CSS_FALLBACK,
        selector: baseSelector,
        engine: SelectorEngines.PLAYWRIGHT_CSS,
        // family drives preference-tiers scoring: 'parent-scoped-css' base=68 + uniqueness bonuses = 82 (preferred)
        family: 'parent-scoped-css',
        proof: {
          strategy: 'pragmatic-css',
        },
        metadata: {
          tier: 'fallback'
        },
      }),
    ];
  }

  return [];
}
