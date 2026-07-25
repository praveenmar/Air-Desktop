import assert from 'node:assert';
import { generateCollectionMembershipShadow } from './collection-membership.js';

function check(name, proof, expect) {
  const results = generateCollectionMembershipShadow(proof);
  if (expect === null) {
    assert.deepStrictEqual(results, [], `${name}: expected [] but got ${JSON.stringify(results.map(r => r?.selector))}`);
  } else if (typeof expect === 'string') {
    assert.strictEqual(results.length, 1, `${name}: expected 1 candidate, got ${results.length}: ${JSON.stringify(results.map(r => r?.selector))}`);
    assert.strictEqual(results[0].selector, expect, `${name}: selector mismatch`);
  } else if (Array.isArray(expect)) {
    assert.strictEqual(results.length, expect.length,
      `${name}: expected ${expect.length} candidates, got ${results.length}: ${JSON.stringify(results.map(r => r?.selector))}`);
    expect.forEach((sel, i) => {
      assert.strictEqual(results[i].selector, sel, `${name}: candidate[${i}] mismatch`);
    });
  }
  console.log(`✓ ${name}`);
}

// --- Shape S only - no row index available -------------------------------
check('Shape S only - unique row text + unique action, no positional index', {
  proofType: 'table-row',
  isValid: true,
  tableSelector: 'table',
  actionSelector: 'button[aria-label="Edit"]',
  actionName: 'Edit',
  rowScopedActionSelector: 'table tr:has(td:text-is("Alice Smith")) button[aria-label="Edit"]',
  uniqueRowBinding: true,
  uniqueActionBinding: true,
  targetRowIndexWithinTable: null,
  targetActionIndexWithinRow: null,
}, `table tr:has(td:text-is("Alice Smith")) button[aria-label="Edit"]`);

// --- Shape S + Shape I - both emitted when row index also present --------
check('Shape S + Shape I - both emitted when row index also present', {
  proofType: 'table-row',
  isValid: true,
  tableSelector: 'table',
  actionSelector: 'button[aria-label="Edit"]',
  actionName: 'Edit',
  rowScopedActionSelector: 'table tr:has(td:text-is("Alice Smith")) button[aria-label="Edit"]',
  uniqueRowBinding: true,
  uniqueActionBinding: true,
  targetRowIndexWithinTable: 2,
  targetActionIndexWithinRow: 0,
}, [
  `table tr:has(td:text-is("Alice Smith")) button[aria-label="Edit"]`,
  `locator('table').locator('tr, [role="row"]').nth(2).locator('button[aria-label="Edit"]')`,
]);

// --- Shape S with nth appended when uniqueActionBinding is false ---------
check('Shape S appends .nth() when uniqueActionBinding is false', {
  proofType: 'table-row',
  isValid: true,
  tableSelector: 'table',
  actionSelector: 'button[aria-label="Edit"]',
  actionName: 'Edit',
  rowScopedActionSelector: 'table tr:has(td:text-is("Alice Smith")) button[aria-label="Edit"]',
  uniqueRowBinding: true,
  uniqueActionBinding: false, // <- false, so append .nth(1)
  targetRowIndexWithinTable: null,
  targetActionIndexWithinRow: 1,
}, `table tr:has(td:text-is("Alice Smith")) button[aria-label="Edit"].nth(1)`);

// --- Shape I only - no row text identity (icon-only row) -----------------
check('Shape I only - rowScopedActionSelector null', {
  proofType: 'table-row',
  isValid: true,
  tableSelector: '[role="grid"]',
  actionSelector: 'button[aria-label="Delete"]',
  actionName: 'Delete',
  rowScopedActionSelector: null,
  uniqueRowBinding: false,
  uniqueActionBinding: true,
  targetRowIndexWithinTable: 4,
  targetActionIndexWithinRow: 0,
}, `locator('[role="grid"]').locator('tr, [role="row"]').nth(4).locator('button[aria-label="Delete"]')`);

// --- Shape I - action name fallback when no actionSelector ---------------
check('Shape I - action name fallback when actionSelector is null', {
  proofType: 'table-row',
  isValid: true,
  tableSelector: 'table',
  actionSelector: null,
  actionName: 'View',
  rowScopedActionSelector: null,
  uniqueRowBinding: false,
  uniqueActionBinding: true,
  targetRowIndexWithinTable: 1,
  targetActionIndexWithinRow: null,
}, `locator('table').locator('tr, [role="row"]').nth(1).locator(':text-is("View")')`);

// --- Shape I - non-unique action in row -> append .nth() -----------------
check('Shape I - appends action .nth() when uniqueActionBinding is false', {
  proofType: 'table-row',
  isValid: true,
  tableSelector: 'table',
  actionSelector: 'button[aria-label="Edit"]',
  actionName: 'Edit',
  rowScopedActionSelector: null,
  uniqueRowBinding: false,
  uniqueActionBinding: false,
  targetRowIndexWithinTable: 3,
  targetActionIndexWithinRow: 1,
}, `locator('table').locator('tr, [role="row"]').nth(3).locator('button[aria-label="Edit"]').nth(1)`);

// --- Shape S silenced when uniqueRowBinding=false (would multi-match) ----
check('Shape S silenced when uniqueRowBinding false - only Shape I emitted', {
  proofType: 'table-row',
  isValid: true,
  tableSelector: 'table',
  actionSelector: 'button[aria-label="Edit"]',
  actionName: 'Edit',
  // Two rows match "John" - producer correctly set uniqueRowBinding=false
  rowScopedActionSelector: 'table tr:has(td:text-is("John")) button[aria-label="Edit"]',
  uniqueRowBinding: false,
  uniqueActionBinding: true,
  targetRowIndexWithinTable: 5,
  targetActionIndexWithinRow: 0,
}, `locator('table').locator('tr, [role="row"]').nth(5).locator('button[aria-label="Edit"]')`);

// --- Guard tests -----------------------------------------------------------
check('Wrong proofType -> empty array', { proofType: 'accessibility', role: 'button' }, null);

check('isValid false -> empty array', {
  proofType: 'table-row',
  isValid: false,
  blockedReason: 'table-row-no-table',
}, null);

check('Missing tableSelector -> empty array', {
  proofType: 'table-row',
  isValid: true,
  tableSelector: null,
  actionSelector: 'button',
  actionName: 'Edit',
  rowScopedActionSelector: null,
  uniqueRowBinding: false,
  uniqueActionBinding: true,
  targetRowIndexWithinTable: 0,
  targetActionIndexWithinRow: 0,
}, null);

check('Missing both actionSelector and actionName -> empty array', {
  proofType: 'table-row',
  isValid: true,
  tableSelector: 'table',
  actionSelector: null,
  actionName: null,
  rowScopedActionSelector: null,
  uniqueRowBinding: false,
  uniqueActionBinding: false,
  targetRowIndexWithinTable: 2,
  targetActionIndexWithinRow: -1,
}, null);

check('targetRowIndexWithinTable null -> Shape I silenced, only Shape S if available', {
  proofType: 'table-row',
  isValid: true,
  tableSelector: 'table',
  actionSelector: 'button[aria-label="Edit"]',
  actionName: 'Edit',
  rowScopedActionSelector: 'table tr:has(td:text-is("Bob")) button[aria-label="Edit"]',
  uniqueRowBinding: true,
  uniqueActionBinding: true,
  targetRowIndexWithinTable: null,
  targetActionIndexWithinRow: null,
}, `table tr:has(td:text-is("Bob")) button[aria-label="Edit"]`);

console.log('\nAll Class 8 tests passed!');
