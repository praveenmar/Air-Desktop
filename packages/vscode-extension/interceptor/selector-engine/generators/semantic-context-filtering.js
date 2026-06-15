import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

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

  return false;
}

export function generateSemanticContextShadow(proofs) {
  const candidates = [];
  if (!Array.isArray(proofs)) return candidates;

  for (const proof of proofs) {
    if (!canGenerateClass4(proof)) continue;

    let selector = null;

    if (proof.proofType === 'bounded-field') {
      selector = `locator('${proof.cleanParentSelector}').filter({ hasText: '${proof.fieldLabelText}' }).locator('${proof.cleanChildSelector}')`;
    } else if (proof.proofType === 'table-row') {
      selector = `locator('${proof.tableSelector}').locator('tr, [role="row"]').filter({ hasText: '${proof.rowIdentityTexts[0]}' }).locator('${proof.actionSelector}')`;
    } else if (proof.proofType === 'generic-container') {
      if (proof.actionRole) {
        selector = `locator('${proof.containerSelectorKind}').filter({ hasText: '${proof.containerAnchorText}' }).getByRole('${proof.actionRole}', { name: '${proof.actionName}' })`;
      } else {
        selector = `locator('${proof.containerSelectorKind}').filter({ hasText: '${proof.containerAnchorText}' }).locator('${proof.actionTag}').filter({ hasText: '${proof.actionName}' })`;
      }
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
