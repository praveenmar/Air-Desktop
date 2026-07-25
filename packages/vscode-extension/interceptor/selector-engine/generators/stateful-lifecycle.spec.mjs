import assert from 'node:assert';
import { generateStatefulLifecycleShadow } from './stateful-lifecycle.js';

function _getByRole(role, options) {
  let s = `getByRole('${role}'`;
  if (options) {
    const opts = [];
    if (options.name) opts.push(`name: '${options.name}'`);
    if (options.exact) opts.push(`exact: true`);
    if (opts.length) s += `, { ${opts.join(', ')} }`;
  }
  s += `)`;
  return {
    getByRole: (r, o) => {
      let child = `getByRole('${r}'`;
      if (o) {
        const cOpts = [];
        if (o.name) cOpts.push(`name: '${o.name}'`);
        if (o.exact) cOpts.push(`exact: true`);
        if (cOpts.length) child += `, { ${cOpts.join(', ')} }`;
      }
      child += `)`;
      return `${s}.${child}`;
    }
  };
}

function _locator(selector) {
  let s = `locator('${selector}')`;
  return {
    getByRole: (r, o) => {
      let child = `getByRole('${r}'`;
      if (o) {
        const cOpts = [];
        if (o.name) cOpts.push(`name: '${o.name}'`);
        if (o.exact) cOpts.push(`exact: true`);
        if (cOpts.length) child += `, { ${cOpts.join(', ')} }`;
      }
      child += `)`;
      return `${s}.${child}`;
    },
    locator: (childSel) => {
      let child = `locator('${childSel}')`;
      return {
        nth: (n) => `${s}.${child}.nth(${n})`
      };
    }
  };
}

function check(name, proof, expectedSelectors) {
  const results = generateStatefulLifecycleShadow(proof);
  if (expectedSelectors === null) {
    assert.deepStrictEqual(results, [], `${name}: expected [] but got ${JSON.stringify(results.map(r => r?.selector))}`);
  } else if (typeof expectedSelectors === 'string') {
    assert.strictEqual(results.length, 1, `${name}: expected 1 candidate, got ${results.length}`);
    assert.strictEqual(results[0].selector, expectedSelectors, `${name}: selector mismatch`);
  } else {
    assert.strictEqual(results.length, expectedSelectors.length,
      `${name}: expected ${expectedSelectors.length} candidates, got ${results.length}: ${JSON.stringify(results.map(r => r.selector))}`);
    for (let i = 0; i < expectedSelectors.length; i++) {
      assert.strictEqual(results[i].selector, expectedSelectors[i],
        `${name}: candidate[${i}] mismatch`);
    }
  }
  console.log(`✓ ${name}`);
}

// --- SHAPE C TESTS ---

check('Shape C - standard aria-label scoped selector', {
  proofType: 'option-panel',
  isValid: true,
  itemRole: 'option',
  itemName: 'ESS',
  itemNameSource: 'accessibility',
  containerRole: 'listbox',
  containerLabelText: 'User Role',
  containerLabelSource: 'aria-label',
  containerLabelVolatile: false,
  uniqueByAriaName: true,
  uniqueByTrigger: false,
  containerId: null,
  isDynamicContainerId: false,
  triggerRelation: 'aria-controls',
  requiresPositionalDisambiguation: false,
  containerSelector: '[role="listbox"]',
  itemSelector: '[role="option"]',
  targetIndexWithinContainer: 0,
}, _getByRole('listbox', { name: 'User Role' }).getByRole('option', { name: 'ESS', exact: true }));

check('Shape C - escapes apostrophe in item name', {
    proofType: 'option-panel',
    isValid: true,
    itemRole: 'option',
    itemName: "Owner's Role",
    itemNameSource: 'accessibility',
    containerRole: 'listbox',
    containerLabelText: 'User',
    containerLabelSource: 'aria-label',
    containerLabelVolatile: false,
    uniqueByAriaName: true,
    uniqueByTrigger: false,
    containerId: null,
    isDynamicContainerId: false,
    triggerRelation: 'none',
    requiresPositionalDisambiguation: false,
    containerSelector: '[role="listbox"]',
    itemSelector: '[role="option"]',
    targetIndexWithinContainer: 0,
}, _getByRole('listbox', { name: 'User' }).getByRole('option', { name: 'Owner\\\'s Role', exact: true }));

check('Shape C - silenced when containerLabelSource is heading (not resolvable by Playwright ARIA)', {
    proofType: 'option-panel',
    isValid: true,
    itemRole: 'option',
    itemName: 'ESS',
    itemNameSource: 'accessibility',
    containerRole: 'listbox',
    containerLabelText: 'Pick a Role',
    containerLabelSource: 'heading',           // <- heading is NOT a valid ARIA accessible name source
    containerLabelVolatile: false,
    uniqueByAriaName: true,
    uniqueByTrigger: false,
    containerId: null,
    isDynamicContainerId: false,
    triggerRelation: 'none',
    requiresPositionalDisambiguation: false,
    containerSelector: '[role="listbox"]',
    itemSelector: '[role="option"]',
    targetIndexWithinContainer: 0,
}, null);

check('Shape C - silenced when containerLabelVolatile (aria-labelledby points to trigger with selected state text)', {
    proofType: 'option-panel',
    isValid: true,
    itemRole: 'option',
    itemName: 'ESS',
    itemNameSource: 'accessibility',
    containerRole: 'listbox',
    containerLabelText: 'User Role: Admin', // <- volatile: includes selected value
    containerLabelSource: 'aria-labelledby',
    containerLabelVolatile: true,           // <- set by producer when label source is trigger-like
    uniqueByAriaName: true,
    uniqueByTrigger: false,
    containerId: null,
    isDynamicContainerId: false,
    triggerRelation: 'aria-labelledby',
    requiresPositionalDisambiguation: false,
    containerSelector: '[role="listbox"]',
    itemSelector: '[role="option"]',
    targetIndexWithinContainer: 0,
}, null);

check('Shape C - silenced when itemNameSource is text-content (includes aria-hidden children like badge counts)', {
    proofType: 'option-panel',
    isValid: true,
    itemRole: 'option',
    itemName: 'Admin 3',                    // <- "3" came from aria-hidden badge; Playwright sees "Admin"
    itemNameSource: 'text-content',         // <- NOT trusted
    containerRole: 'listbox',
    containerLabelText: 'Role',
    containerLabelSource: 'aria-label',
    containerLabelVolatile: false,
    uniqueByAriaName: true,
    uniqueByTrigger: false,
    containerId: null,
    isDynamicContainerId: false,
    triggerRelation: 'none',
    requiresPositionalDisambiguation: false,
    containerSelector: '[role="listbox"]',
    itemSelector: '[role="option"]',
    targetIndexWithinContainer: 0,
}, null);

// --- SHAPE B TESTS ---

check('Shape B - stable container ID with formal aria-controls link', {
    proofType: 'option-panel',
    isValid: true,
    itemRole: 'option',
    itemName: 'ESS',
    itemNameSource: 'accessibility',
    containerRole: 'listbox',
    containerLabelText: null,
    containerLabelSource: 'none',
    containerLabelVolatile: false,
    uniqueByAriaName: false,
    uniqueByTrigger: true,
    containerId: 'country-dropdown',        // <- aria-controls + stable ID
    isDynamicContainerId: false,
    triggerRelation: 'aria-controls',
    requiresPositionalDisambiguation: false,
    containerSelector: '[role="listbox"]',
    itemSelector: '[role="option"]',
    targetIndexWithinContainer: 0,
}, _locator('[role="listbox"]#country-dropdown').getByRole('option', { name: 'ESS', exact: true }));

check('Shape B - silenced when containerId is dynamic (framework-generated)', {
    proofType: 'option-panel',
    isValid: true,
    itemRole: 'option',
    itemName: 'ESS',
    itemNameSource: 'accessibility',
    containerRole: 'listbox',
    containerLabelText: null,
    containerLabelSource: 'none',
    containerLabelVolatile: false,
    uniqueByAriaName: false,
    uniqueByTrigger: false,                 // <- dynamic ID gates uniqueByTrigger=false
    containerId: 'listbox-abc123xyz789',    // <- dynamic: would break between renders
    isDynamicContainerId: true,
    triggerRelation: 'aria-controls',
    requiresPositionalDisambiguation: false,
    containerSelector: '[role="listbox"]',
    itemSelector: '[role="option"]',
    targetIndexWithinContainer: 0,
}, null);

// --- SHAPE D TESTS ---

check('Shape D - detached/portaled panel (open-dropdown-context path)', {
    proofType: 'option-panel',
    isValid: true,
    itemRole: 'option',
    itemName: 'ESS',
    itemNameSource: 'event-context',        // <- from optionInteractionContext - trusted
    containerRole: 'listbox',
    containerLabelText: null,               // <- always null in detached path
    containerLabelSource: 'none',
    containerLabelVolatile: false,
    uniqueByAriaName: false,
    uniqueByTrigger: false,
    containerId: null,
    isDynamicContainerId: false,
    triggerRelation: 'open-dropdown-context', // <- key: triggers Shape D
    requiresPositionalDisambiguation: false,
    containerSelector: '*',
    itemSelector: '*',
    targetIndexWithinContainer: 0,
}, _getByRole('listbox').getByRole('option', { name: 'ESS', exact: true }));

// --- SHAPE P TESTS ---

check('Shape P - positional fallback for duplicate option text', {
    proofType: 'option-panel',
    isValid: true,
    itemRole: 'option',
    itemName: 'Admin',
    itemNameSource: 'accessibility',
    containerRole: 'listbox',
    containerLabelText: null,
    containerLabelSource: 'none',
    containerLabelVolatile: false,
    uniqueByAriaName: false,
    uniqueByTrigger: false,
    containerId: null,
    isDynamicContainerId: false,
    triggerRelation: 'none',
    requiresPositionalDisambiguation: true, // <- duplicate text: two options named "Admin"
    containerSelector: '[role="listbox"]',
    itemSelector: '[role="option"]',
    targetIndexWithinContainer: 1,          // <- 0-based; second "Admin" option
}, _locator('[role="listbox"]').locator('[role="option"]').nth(1));

// --- MULTI-SHAPE AND GUARD TESTS ---

check('multiple shapes from one proof - Shape C and Shape B both emit', {
    proofType: 'option-panel',
    isValid: true,
    itemRole: 'option',
    itemName: 'ESS',
    itemNameSource: 'accessibility',
    containerRole: 'listbox',
    containerLabelText: 'User Role',
    containerLabelSource: 'aria-label',
    containerLabelVolatile: false,
    uniqueByAriaName: true,
    uniqueByTrigger: true,
    containerId: 'user-role-list',
    isDynamicContainerId: false,
    triggerRelation: 'aria-controls',
    requiresPositionalDisambiguation: false,
    containerSelector: '[role="listbox"]#user-role-list',
    itemSelector: '[role="option"]',
    targetIndexWithinContainer: 0,
}, [
    _getByRole('listbox', { name: 'User Role' }).getByRole('option', { name: 'ESS', exact: true }),
    _locator('[role="listbox"]#user-role-list').getByRole('option', { name: 'ESS', exact: true })
]);

check('Non-option-panel proofType returns empty array', {
    proofType: 'accessibility',
    role: 'option',
    accessibleName: 'ESS',
}, null);

check('isValid=false returns empty array', {
    proofType: 'option-panel',
    isValid: false,
    blockedReason: 'option-panel-no-container',
    itemRole: 'option',
    itemName: 'ESS',
}, null);

check('containerRole not in allowed set (group) - all ARIA shapes silenced, Shape P still fires if positional', {
    proofType: 'option-panel',
    isValid: true,
    itemRole: 'menuitem',
    itemName: 'Save',
    itemNameSource: 'accessibility',
    containerRole: 'group',                 // <- too generic, not in ALLOWED_CONTAINER_ROLES
    containerLabelText: 'Actions',
    containerLabelSource: 'aria-label',
    containerLabelVolatile: false,
    uniqueByAriaName: true,
    uniqueByTrigger: false,
    containerId: null,
    isDynamicContainerId: false,
    triggerRelation: 'none',
    requiresPositionalDisambiguation: true,
    containerSelector: '[role="group"]',
    itemSelector: '[role="menuitem"]',
    targetIndexWithinContainer: 0,
}, _locator('[role="group"]').locator('[role="menuitem"]').nth(0));

try {
    console.log('All Class 7 tests passed!');
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
