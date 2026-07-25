import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

const esc = (str) => (str ? str.replace(/(['\\])/g, '\\$1') : '');

/**
 * Class 8 - Collection Membership
 *
 * Generates selectors for action elements (buttons, links, checkboxes) inside table/grid rows.
 * Emits up to two candidates per proof, ordered from most to least reliable:
 *
 * Shape S - Semantic (preferred):
 * Uses proof.rowScopedActionSelector - a pre-computed selector combining:
 * tableSelector + buildRowSelector(row) + :has(cell:text-is("exact")) per identity text + actionSelector
 * Engine: PLAYWRIGHT_NATIVE
 * Condition: rowScopedActionSelector non-null AND uniqueRowBinding === true
 * Stable across row reordering because it uses textual row identity, not positional index.
 * Note: If the action itself is not unique in the row, it appends .nth() to the action.
 *
 * Shape I - Index (positional fallback):
 * locator(table).locator('tr, [role="row"]').nth(N).locator(action)
 * Engine: PLAYWRIGHT_NATIVE
 * Condition: targetRowIndexWithinTable is a valid non-negative number
 * N is DOM-order (all rows including hidden) so it correctly matches Playwright's .nth() semantics.
 * Fragile to row insertion, deletion, sorting, and pagination.
 * Only preferred when Shape S is unavailable (no row identity text, icon-only rows, etc.).
 *
 * Returns Candidate[] always. Empty array = all shapes gated out. Never returns null.
 */
export function generateCollectionMembershipShadow(proof) {
  if (!proof || proof.proofType !== 'table-row') return [];
  if (proof.isValid !== true) return [];
  if (!proof.tableSelector) return [];
  if (!proof.actionSelector && !proof.actionName) return [];

  const candidates = [];

  // --- Shape S - Semantic (preferred) --------------------------------------
  // rowScopedActionSelector is pre-computed by the producer using :has(cell:text-is("exact"))
  // exact-match selectors. It is only populated when rowIdentityTexts is non-empty AND
  // actionSelector is non-null.
  // We gate on uniqueRowBinding to avoid emitting a selector that would resolve to multiple
  // elements and trigger Playwright strict-mode violations.
  const shapeSAllowed =
    !!proof.rowScopedActionSelector &&
    proof.uniqueRowBinding === true;

  if (shapeSAllowed) {
    let selector = proof.rowScopedActionSelector;
    
    // If multiple actions of this type exist in the row, append action-level .nth()
    if (
      proof.uniqueActionBinding !== true &&
      typeof proof.targetActionIndexWithinRow === 'number' &&
      proof.targetActionIndexWithinRow >= 0
    ) {
      selector += `.nth(${proof.targetActionIndexWithinRow})`;
    }

    candidates.push(createCandidate({
      classId: SelectorClassIds.COLLECTION_MEMBERSHIP,
      selector,
      engine: SelectorEngines.PLAYWRIGHT_NATIVE,
      proof,
      metadata: { shape: 'S', reason: 'semantic-row-identity' }
    }));
  }

  // --- Shape I - Index (positional fallback) -------------------------------
  // targetRowIndexWithinTable is computed from allTableRows.indexOf(row) in the producer
  // (DOM-order, all rows including hidden) - correctly matches Playwright's .nth(N) semantics.
  // Shape I is always attempted as a fallback whenever a valid row index exists.
  const shapeIAllowed =
    typeof proof.targetRowIndexWithinTable === 'number' &&
    proof.targetRowIndexWithinTable >= 0;

  if (shapeIAllowed) {
    const rowBase = `locator('${esc(proof.tableSelector)}').locator('tr, [role="row"]').nth(${proof.targetRowIndexWithinTable})`;

    let actionPart;
    if (proof.actionSelector) {
      actionPart = `.locator('${esc(proof.actionSelector)}')`;
    } else {
      // No CSS action selector available - use action name as text filter inside the row
      // using exact matching :text-is instead of substring :has-text (Gap 3 Fix)
      actionPart = `.locator(':text-is("${esc(proof.actionName)}")')`;
    }

    let selector = `${rowBase}${actionPart}`;

    // If multiple actions of this type exist in the row, append action-level .nth()
    if (
      proof.uniqueActionBinding !== true &&
      typeof proof.targetActionIndexWithinRow === 'number' &&
      proof.targetActionIndexWithinRow >= 0
    ) {
      selector += `.nth(${proof.targetActionIndexWithinRow})`;
    }

    candidates.push(createCandidate({
      classId: SelectorClassIds.COLLECTION_MEMBERSHIP,
      selector,
      engine: SelectorEngines.PLAYWRIGHT_NATIVE,
      proof,
      metadata: { shape: 'I', reason: 'positional-row-index' }
    }));
  }

  return candidates;
}
