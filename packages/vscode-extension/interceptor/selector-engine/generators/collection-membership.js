import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

const escapeText = (str) => str ? str.replace(/(['\\])/g, '\\$1') : '';
const safeCssEscape = (str) => typeof str === 'string' ? str.replace(/(['\\])/g, '\\$1') : str;

export function canGenerateCollectionMembership(proof) {
  if (!proof || proof.isValid !== true) return false;

  // Collection Membership requires a table/grid and positional indices
  if (proof.proofType === 'table-row') {
    return !!proof.tableSelector &&
           (!!proof.actionSelector || !!proof.actionName) &&
           typeof proof.targetRowIndexWithinTable === 'number' &&
           proof.targetRowIndexWithinTable >= 0;
  }

  return false;
}

export function generateCollectionMembershipShadow(proof) {
  if (!canGenerateCollectionMembership(proof)) return null;

  let selector = null;

  if (proof.proofType === 'table-row') {
    const rowBase = `locator('${safeCssEscape(proof.tableSelector)}').locator('tr, [role="row"]').nth(${proof.targetRowIndexWithinTable})`;
    
    if (proof.actionSelector) {
      selector = `${rowBase}.locator('${safeCssEscape(proof.actionSelector)}')`;
    } else {
      // Fallback: If no custom action selector could be bound, but we have an action name (e.g. text cell click),
      // we filter the row for that text, or simply use the raw text if it's unique enough for fallback purposes.
      selector = `${rowBase}.filter({ hasText: '${escapeText(proof.actionName)}' })`;
    }
    
    // If the action is also not unique within the row, append action positional disambiguation
    if (!proof.uniqueActionBinding && typeof proof.targetActionIndexWithinRow === 'number' && proof.targetActionIndexWithinRow >= 0) {
      selector += `.nth(${proof.targetActionIndexWithinRow})`;
    }
  }

  if (!selector) return null;

  return createCandidate({
    classId: SelectorClassIds.COLLECTION_MEMBERSHIP,
    selector,
    engine: SelectorEngines.PLAYWRIGHT_NATIVE,
    proof
  });
}
