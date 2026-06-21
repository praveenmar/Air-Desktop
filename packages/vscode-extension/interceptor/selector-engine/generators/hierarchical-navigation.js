import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

const escapeText = (str) => str ? str.replace(/(['\\])/g, '\\$1') : '';
const safeCssEscape = (str) => typeof str === 'string' ? str.replace(/(['\\])/g, '\\$1') : str;

export function canGenerateHierarchicalNavigation(proof) {
  if (!proof || proof.isValid !== true) return false;

  if (proof.proofType === 'tree-node') {
    return !!proof.treeSelector && !!proof.nodeSelector && !!proof.nodeName;
  }

  return false;
}

export function generateHierarchicalNavigationShadow(proof) {
  if (!canGenerateHierarchicalNavigation(proof)) return null;

  let selector = null;

  if (proof.proofType === 'tree-node') {
    selector = `locator('${safeCssEscape(proof.treeSelector)}').locator('${safeCssEscape(proof.nodeSelector)}').filter({ hasText: '${escapeText(proof.nodeName)}' })`;
  }

  if (!selector) return null;

  return createCandidate({
    classId: SelectorClassIds.HIERARCHICAL_NAVIGATION,
    selector,
    engine: SelectorEngines.PLAYWRIGHT_NATIVE,
    proof,
    metadata: {
      nodeLevel: proof.depth,
      ancestorPath: proof.ancestorPath || []
    }
  });
}
