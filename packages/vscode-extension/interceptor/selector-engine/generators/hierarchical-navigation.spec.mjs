import assert from 'node:assert';
import { generateHierarchicalNavigationShadow } from './hierarchical-navigation.js';

function check(name, proof, expect) {
  const results = generateHierarchicalNavigationShadow(proof);
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

// --- Shape N - name-only, no ancestors -------------------------------------

check('Shape N - basic unique treeitem', {
  proofType: 'tree-node',
  isValid: true,
  treeSelector: 'ul[role="tree"]',
  nodeName: 'Documents',
  ancestorPath: [],
  depth: 1,
  isExpanded: false,
}, `locator('ul[role="tree"]').getByRole('treeitem', { name: 'Documents', exact: true })`);

check('Shape N - escapes apostrophe in name', {
  proofType: 'tree-node',
  isValid: true,
  treeSelector: '[role="tree"]',
  nodeName: "Owner's Folder",
  ancestorPath: [],
  depth: 1,
  isExpanded: false,
}, `locator('[role="tree"]').getByRole('treeitem', { name: 'Owner\\\'s Folder', exact: true })`);

// --- Shape P-aria - all ancestors have ariaLabel ---------------------------

check('Shape P-aria - two-level path, all aria-labels present', {
  proofType: 'tree-node',
  isValid: true,
  treeSelector: 'ul[role="tree"]',
  nodeName: 'index.js',
  ancestorPath: [
    { name: 'src', ariaLabel: 'src' },
    { name: 'utils', ariaLabel: 'utils' },
  ],
  depth: 3,
  isExpanded: false,
}, [
  // Shape N always first
  `locator('ul[role="tree"]').getByRole('treeitem', { name: 'index.js', exact: true })`,
  // Shape P-aria second
  `locator('ul[role="tree"]').locator('[aria-label="src"] [role="treeitem"][aria-label="utils"] [role="treeitem"][aria-label="index.js"]')`,
]);

check('Shape P-aria - escapes double-quote in aria-label value', {
  proofType: 'tree-node',
  isValid: true,
  treeSelector: '[role="tree"]',
  nodeName: 'file "special".ts',
  ancestorPath: [
    { name: 'src', ariaLabel: 'src' },
  ],
  depth: 2,
  isExpanded: false,
}, [
  `locator('[role="tree"]').getByRole('treeitem', { name: 'file "special".ts', exact: true })`,
  `locator('[role="tree"]').locator('[aria-label="src"] [role="treeitem"][aria-label="file \\\\"special\\\\".ts"]')`,
]);

// --- Shape P-chain - any ancestor lacks ariaLabel --------------------------

check('Shape P-chain - ancestor has no ariaLabel, fallback to getByRole chain', {
  proofType: 'tree-node',
  isValid: true,
  treeSelector: 'ul[role="tree"]',
  nodeName: 'index.js',
  ancestorPath: [
    { name: 'src', ariaLabel: null },    // <- no ariaLabel -> forces P-chain
    { name: 'utils', ariaLabel: null },
  ],
  depth: 3,
  isExpanded: false,
}, [
  // Shape N always first
  `locator('ul[role="tree"]').getByRole('treeitem', { name: 'index.js', exact: true })`,
  // Shape P-chain (NOT P-aria - ancestor lacks ariaLabel)
  `locator('ul[role="tree"]').getByRole('treeitem', { name: 'src', exact: true }).getByRole('treeitem', { name: 'utils', exact: true }).getByRole('treeitem', { name: 'index.js', exact: true })`,
]);

check('Shape P-chain - regex prevents substring false-positive (src vs src-utils)', {
  proofType: 'tree-node',
  isValid: true,
  treeSelector: '[role="tree"]',
  nodeName: 'Button.tsx',
  ancestorPath: [
    { name: 'src', ariaLabel: null },
    { name: 'components', ariaLabel: null },
  ],
  depth: 3,
  isExpanded: false,
}, [
  `locator('[role="tree"]').getByRole('treeitem', { name: 'Button.tsx', exact: true })`,
  // must NOT match 'src-utils' or 'src/components'
  `locator('[role="tree"]').getByRole('treeitem', { name: 'src', exact: true }).getByRole('treeitem', { name: 'components', exact: true }).getByRole('treeitem', { name: 'Button.tsx', exact: true })`,
]);

// --- Guard tests -----------------------------------------------------------

check('Wrong proofType returns empty array', {
  proofType: 'accessibility',
  role: 'treeitem',
  accessibleName: 'Documents',
}, null);

check('isValid false returns empty array', {
  proofType: 'tree-node',
  isValid: false,
  blockedReason: 'tree-node-detached',
}, null);

check('Missing treeSelector returns empty array', {
  proofType: 'tree-node',
  isValid: true,
  treeSelector: null,
  nodeName: 'Documents',
  ancestorPath: [],
}, null);

check('Missing nodeName returns empty array', {
  proofType: 'tree-node',
  isValid: true,
  treeSelector: '[role="tree"]',
  nodeName: null,
  ancestorPath: [],
}, null);

check('Single ancestor with ariaLabel emits N + P-aria (not P-chain)', {
  proofType: 'tree-node',
  isValid: true,
  treeSelector: '[role="tree"]',
  nodeName: 'file.ts',
  ancestorPath: [{ name: 'src', ariaLabel: 'src' }],
  depth: 2,
  isExpanded: false,
}, [
  `locator('[role="tree"]').getByRole('treeitem', { name: 'file.ts', exact: true })`,
  `locator('[role="tree"]').locator('[aria-label="src"] [role="treeitem"][aria-label="file.ts"]')`,
]);

check('Mixed ancestors (some have ariaLabel, some do not) -> P-chain only, not P-aria', {
  proofType: 'tree-node',
  isValid: true,
  treeSelector: '[role="tree"]',
  nodeName: 'file.ts',
  ancestorPath: [
    { name: 'src', ariaLabel: 'src' },
    { name: 'utils', ariaLabel: null },  // <- one missing -> P-aria blocked
  ],
  depth: 3,
  isExpanded: false,
}, [
  `locator('[role="tree"]').getByRole('treeitem', { name: 'file.ts', exact: true })`,
  `locator('[role="tree"]').getByRole('treeitem', { name: 'src', exact: true }).getByRole('treeitem', { name: 'utils', exact: true }).getByRole('treeitem', { name: 'file.ts', exact: true })`,
]);

console.log('\nAll Class 9 tests passed!');
