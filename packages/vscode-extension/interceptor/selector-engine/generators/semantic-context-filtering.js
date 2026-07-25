import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

const escapeText = (str) => str ? str.replace(/(['\\])/g, '\\$1') : '';
const safeCssEscape = (str) => typeof str === 'string' ? str.replace(/(['\\])/g, '\\$1') : str;
export function canGenerateClass4(proof) {
  if (!proof || proof.isValid !== true) return false;

  if (proof.proofType === 'bounded-field') {
    return proof.fieldRelation === 'bounded-container' &&
           !!proof.cleanParentSelector &&
           !!proof.cleanChildSelector &&
           !!proof.fieldLabelText &&
           typeof proof.duplicateLabelCount === 'number' &&
           proof.duplicateLabelCount <= 1;
  }

  if (proof.proofType === 'table-row') {
    return !!proof.tableSelector &&
           !!proof.actionSelector &&
           Array.isArray(proof.rowIdentityTexts) &&
           proof.rowIdentityTexts.length > 0 &&
           proof.uniqueRowBinding === true &&
           proof.uniqueActionBinding === true;
  }

  if (proof.proofType === 'generic-container') {
    return !!proof.containerSelectorKind &&
           !!proof.containerAnchorText &&
           !!proof.actionName &&
           (!!proof.actionRole || !!proof.actionTag) &&
           proof.uniqueContainerBinding === true &&
           proof.uniqueAnchorBinding === true &&
           proof.uniqueActionBinding === true;
  }

  if (proof.proofType === 'repeated-group-action') {
    return proof.repeatedContainer === true &&
      !!proof.containerSelectorKind &&
      (!!proof.cardUniqueText || typeof proof.cardPositionalIndex === 'number') &&
      !!proof.actionName &&
      (!!proof.actionRole || !proof.actionTag);
  }

  return false;
}

export function generateSemanticContextShadow(proofs) {
  const candidates = [];
  if (!Array.isArray(proofs)) return candidates;

  for (const proof of proofs) {
    if (!canGenerateClass4(proof)) continue;

    let selector = null;

    if (proof.proofType === 'bounded-field') {
      selector = `locator('${safeCssEscape(proof.cleanParentSelector)}').filter({ hasText: '${escapeText(proof.fieldLabelText)}' }).locator('${safeCssEscape(proof.cleanChildSelector)}')`;
    } else if (proof.proofType === 'table-row') {
      selector = `locator('${safeCssEscape(proof.tableSelector)}').locator('tr, [role="row"]').filter({ hasText: '${escapeText(proof.rowIdentityTexts[0])}' }).locator('${safeCssEscape(proof.actionSelector)}')`;
    } else if (proof.proofType === 'generic-container') {
      if (proof.actionRole) {
        selector = `locator('${safeCssEscape(proof.containerSelectorKind)}').filter({ hasText: '${escapeText(proof.containerAnchorText)}' }).getByRole('${safeCssEscape(proof.actionRole)}', { name: '${escapeText(proof.actionName)}' })`;
      } else {
        selector = `locator('${safeCssEscape(proof.containerSelectorKind)}').filter({ hasText: '${escapeText(proof.containerAnchorText)}' }).locator('${safeCssEscape(proof.actionTag)}').filter({ hasText: '${escapeText(proof.actionName)}' })`;
      }
    } else if (proof.proofType === 'repeated-group-action') {
      let rgaSelector = null;
      let usesIndex = false;

      if (proof.cardUniqueText) {
        if (proof.actionRole) {
          rgaSelector = `locator('${safeCssEscape(proof.containerSelectorKind)}').filter({ hasText: '${escapeText(proof.cardUniqueText)}' }).getByRole('${safeCssEscape(proof.actionRole)}', { name: '${escapeText(proof.actionName)}' })`;
        } else {
          rgaSelector = `locator('${safeCssEscape(proof.containerSelectorKind)}').filter({ hasText: '${escapeText(proof.cardUniqueText)}' }).locator('${safeCssEscape(proof.actionTag)}').filter({ hasText: '${escapeText(proof.actionName)}' })`;
        }
      } else if (typeof proof.cardPositionalIndex === 'number') {
        usesIndex = true;
        if (proof.actionRole) {
          rgaSelector = `locator('${safeCssEscape(proof.containerSelectorKind)}').nth(${proof.cardPositionalIndex}).getByRole('${safeCssEscape(proof.actionRole)}', { name: '${escapeText(proof.actionName)}' })`;
        } else {
          rgaSelector = `locator('${safeCssEscape(proof.containerSelectorKind)}').nth(${proof.cardPositionalIndex}).locator('${safeCssEscape(proof.actionTag)}').filter({ hasText: '${escapeText(proof.actionName)}' })`;
        }
      }

      if (rgaSelector) {
        candidates.push(createCandidate({
          classId: SelectorClassIds.SEMANTIC_CONTEXT_FILTERING,
          selector: rgaSelector,
          engine: SelectorEngines.PLAYWRIGHT_NATIVE,
          proof,
          ...(usesIndex ? { usesIndex: true, warningCodes: ['positional-first-fallback'] } : {}),
        }));
      }
      continue; // Skip shared push
    }

    if (selector) {
      candidates.push(createCandidate({
        classId: SelectorClassIds.SEMANTIC_CONTEXT_FILTERING,
        selector,
        engine: SelectorEngines.PLAYWRIGHT_NATIVE,
        proof
      }));
    }
  }

  return candidates;
}
