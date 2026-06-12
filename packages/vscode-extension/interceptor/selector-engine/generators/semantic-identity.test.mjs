import assert from 'node:assert';
import { generateSemanticIdentityShadow } from './semantic-identity.js';

function check(name, proof, expectedSelector) {
  const result = generateSemanticIdentityShadow(proof);
  if (expectedSelector === null) {
    assert.strictEqual(result, null, `${name} failed`);
  } else {
    assert.notStrictEqual(result, null, `${name} returned null instead of ${expectedSelector}`);
    assert.strictEqual(result.selector, expectedSelector, `${name} failed: got ${result.selector}`);
  }
  console.log(`✓ ${name}`);
}

try {
  check('aria-label emits', {
    proofType: 'accessibility',
    role: 'button',
    accessibleName: 'Save',
    accessibleNameSource: 'aria-label'
  }, `getByRole('button', { name: 'Save', exact: true })`);

  check('button-text emits', {
    proofType: 'accessibility',
    role: 'button',
    accessibleName: 'Submit',
    accessibleNameSource: 'button-text'
  }, `getByRole('button', { name: 'Submit', exact: true })`);

  check('placeholder emits getByPlaceholder', {
    proofType: 'accessibility',
    role: 'textbox',
    accessibleName: 'Search',
    accessibleNameSource: 'placeholder'
  }, `getByPlaceholder('Search')`);

  check('title emits getByTitle', {
    proofType: 'accessibility',
    role: 'button',
    accessibleName: 'Close',
    accessibleNameSource: 'title'
  }, `getByTitle('Close')`);

  check('label-for skips', {
    proofType: 'accessibility',
    role: 'checkbox',
    accessibleName: 'Subscribe',
    accessibleNameSource: 'label-for'
  }, null);

  check('wrapped-label skips', {
    proofType: 'accessibility',
    role: 'radio',
    accessibleName: 'Yes',
    accessibleNameSource: 'wrapped-label'
  }, null);

  check('aria-labelledby skips', {
    proofType: 'accessibility',
    role: 'region',
    accessibleName: 'Settings',
    accessibleNameSource: 'aria-labelledby'
  }, null);

  check('missing role returns null', {
    proofType: 'accessibility',
    accessibleName: 'Save',
    accessibleNameSource: 'button-text'
  }, null);

  check('missing proofType returns null', {
    role: 'button',
    accessibleName: 'Save',
    accessibleNameSource: 'button-text'
  }, null);

  check('escaping works', {
    proofType: 'accessibility',
    role: 'button',
    accessibleName: "O'Reilly",
    accessibleNameSource: 'button-text'
  }, `getByRole('button', { name: 'O\\'Reilly', exact: true })`);

  console.log('All tests passed!');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
