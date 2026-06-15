import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

export function generateLabelBoundIdentityShadow(proof) {
  if (proof?.proofType !== 'label') return null;

  if (
    proof.fieldRelation !== 'label-for' &&
    proof.fieldRelation !== 'wrapped-label' &&
    proof.fieldRelation !== 'aria-labelledby'
  ) {
    return null;
  }

  if (!proof.fieldLabelText) return null;

  const escapedText = proof.fieldLabelText.replace(/(['\\])/g, '\\$1');

  return createCandidate({
    classId: SelectorClassIds.LABEL_BOUND_IDENTITY,
    selector: `getByLabel('${escapedText}')`,
    engine: SelectorEngines.PLAYWRIGHT_ARIA,
    proof
  });
}
