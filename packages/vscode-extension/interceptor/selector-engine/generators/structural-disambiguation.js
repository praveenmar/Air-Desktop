import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

function safeCssEscape(str) {
  if (!str) return '';
  return str.replace(/(['\\])/g, '\\$1');
}

export function generateStructuralDisambiguationShadow(proof) {
  if (!proof) return null;

  const clusterAnchorSelector = proof.containerSelector;
  const ambiguousBaseSelector = proof.fieldLabelText;
  const targetIndex = proof.targetIndexWithinAmbiguity;

  if (
    proof.duplicateLabelCount > 1 &&
    typeof targetIndex === 'number' &&
    targetIndex >= 0 &&
    ambiguousBaseSelector &&
    clusterAnchorSelector
  ) {
    // SDET Approved Phase C Patch String
    const selector = `locator('${safeCssEscape(clusterAnchorSelector)}').getByLabel('${safeCssEscape(ambiguousBaseSelector)}').filter({ visible: true }).nth(${targetIndex})`;

    return createCandidate({
      classId: SelectorClassIds.STRUCTURAL_DISAMBIGUATION,
      selector,
      engine: SelectorEngines.PLAYWRIGHT_NATIVE,
      proof
    });
  }

  return null;
}
