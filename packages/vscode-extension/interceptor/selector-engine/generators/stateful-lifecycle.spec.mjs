import assert from 'node:assert';
import { generateStatefulLifecycleShadow } from './stateful-lifecycle.js';
import { SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

function check(name, proof, expectedSelector) {
  const result = generateStatefulLifecycleShadow(proof);
  if (expectedSelector === null) {
    assert.strictEqual(result, null, `${name} failed`);
  } else {
    assert.notStrictEqual(result, null, `${name} returned null instead of ${expectedSelector}`);
    assert.strictEqual(result.selector, expectedSelector, `${name} failed: got ${result.selector}`);
    assert.strictEqual(result.classId, SelectorClassIds.STATEFUL_LIFECYCLE_LINKAGE, `${name} failed: wrong classId`);
    assert.strictEqual(result.engine, SelectorEngines.PLAYWRIGHT_CSS, `${name} failed: wrong engine`);
  }
  console.log(`✓ ${name}`);
}

try {
  check('Valid proof with scopedTextSelector emits scoped text selector', {
    isValid: true,
    triggerSelector: 'div.trigger',
    scopedTextSelector: 'div[role="listbox"] div[role="option"]:has-text("ESS")',
    scopedItemSelector: 'div[role="listbox"] div[role="option"]'
  }, 'div[role="listbox"] div[role="option"]:has-text("ESS")');

  check('Valid proof without scopedTextSelector falls back to scopedItemSelector', {
    isValid: true,
    triggerSelector: 'div.trigger',
    scopedTextSelector: null,
    scopedItemSelector: 'div[role="listbox"] div[role="option"]'
  }, 'div[role="listbox"] div[role="option"]');

  check('Missing isValid returns null', {
    isValid: false,
    triggerSelector: 'div.trigger',
    scopedTextSelector: 'div[role="listbox"] div[role="option"]:has-text("ESS")'
  }, null);

  check('Missing triggerSelector returns null (ownership boundary enforcement)', {
    isValid: true,
    triggerSelector: null,
    scopedTextSelector: 'div[role="listbox"] div[role="option"]:has-text("ESS")'
  }, null);

  check('Missing option selector returns null', {
    isValid: true,
    triggerSelector: 'div.trigger',
    scopedTextSelector: null,
    scopedItemSelector: null
  }, null);

  console.log('All stateful-lifecycle tests passed!');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
