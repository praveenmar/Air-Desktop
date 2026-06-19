import assert from 'node:assert';
import { generateStructuralDisambiguationShadow } from './structural-disambiguation.js';

function check(name, proof, expectedSelector) {
  const result = generateStructuralDisambiguationShadow(proof);
  if (expectedSelector === null) {
    assert.strictEqual(result, null, `${name} failed`);
  } else {
    assert.notStrictEqual(result, null, `${name} returned null instead of ${expectedSelector}`);
    assert.strictEqual(result.selector, expectedSelector, `${name} failed: got ${result.selector}`);
  }
  console.log(`✓ ${name}`);
}

try {
  check('Valid label proof emits chained selector with visible filter', {
    proofType: 'label',
    duplicateLabelCount: 3,
    targetIndexWithinAmbiguity: 1,
    fieldLabelText: 'Phone',
    containerSelector: '#form-container',
  }, `locator('#form-container').getByLabel('Phone').filter({ visible: true }).nth(1)`);

  check('Hidden element desync protection (visibility filter present)', {
    proofType: 'label',
    duplicateLabelCount: 2,
    // Scenario: Input 0 is hidden React template, Input 1 is visible target.
    // Our indexOf on queryVisibleElements counted it as 0. 
    // Playwright natively counts hidden + visible = 2.
    // The filter({ visible: true }) guarantees .nth(0) matches the 0th VISIBLE element!
    targetIndexWithinAmbiguity: 0, 
    fieldLabelText: 'Phone',
    containerSelector: 'form',
  }, `locator('form').getByLabel('Phone').filter({ visible: true }).nth(0)`);

  check('Escapes quotes in anchor and label', {
    proofType: 'label',
    duplicateLabelCount: 2,
    targetIndexWithinAmbiguity: 0,
    fieldLabelText: "User's Phone",
    containerSelector: ".container[data-id='123']",
  }, `locator('.container[data-id=\\'123\\']').getByLabel('User\\'s Phone').filter({ visible: true }).nth(0)`);

  check('Missing anchor returns null', {
    proofType: 'label',
    duplicateLabelCount: 2,
    targetIndexWithinAmbiguity: 0,
    fieldLabelText: "Phone",
  }, null);

  check('Zero index is valid', {
    proofType: 'label',
    duplicateLabelCount: 2,
    targetIndexWithinAmbiguity: 0,
    fieldLabelText: "Phone",
    containerSelector: "div",
  }, `locator('div').getByLabel('Phone').filter({ visible: true }).nth(0)`);

  check('Only supports ambiguity arrays (duplicateLabelCount > 1)', {
    proofType: 'label',
    duplicateLabelCount: 1, // Not ambiguous!
    targetIndexWithinAmbiguity: 0,
    fieldLabelText: "Phone",
    containerSelector: "div",
  }, null);

  console.log('All tests passed!');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
