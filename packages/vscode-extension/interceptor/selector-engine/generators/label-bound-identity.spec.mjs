import assert from 'node:assert';
import { generateLabelBoundIdentityShadow } from './label-bound-identity.js';

function check(name, proof, expectedSelector) {
  const result = generateLabelBoundIdentityShadow(proof);
  if (expectedSelector === null) {
    assert.strictEqual(result, null, `${name} failed`);
  } else {
    assert.notStrictEqual(result, null, `${name} returned null instead of ${expectedSelector}`);
    assert.strictEqual(result.selector, expectedSelector, `${name} failed: got ${result.selector}`);
  }
  console.log(`✓ ${name}`);
}

try {
  check('Positive Test A', {
    proofType: 'label',
    isValid: true,
    fieldRelation: 'label-for',
    fieldLabelText: 'Email'
  }, `getByLabel('Email')`);

  check('Positive Test B', {
    proofType: 'label',
    isValid: true,
    fieldRelation: 'label-for',
    fieldLabelText: "Owner's Name"
  }, `getByLabel('Owner\\'s Name')`);

  check('Negative Test A', {
    proofType: 'label',
    fieldRelation: 'sibling-label',
    fieldLabelText: 'Country'
  }, null);

  check('Negative Test B', {
    proofType: 'accessibility'
  }, null);

  console.log('All tests passed!');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
