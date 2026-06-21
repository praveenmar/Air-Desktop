import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

export function generateStatefulLifecycleShadow(proof) {
  if (!proof || proof.isValid !== true) return null;
  if (!proof.triggerSelector) return null; // A stateful lifecycle linkage fundamentally requires a trigger

  // The option selector MUST be scoped. If there is no scopedTextSelector, fall back to scopedItemSelector.
  // Note: We emit just the option selector (using PLAYWRIGHT_CSS). The fact that this selector is safe
  // is guaranteed by the record-time proof, which confirmed the unique panel binding tied to the trigger.
  const selector = proof.scopedTextSelector || proof.scopedItemSelector;
  
  if (!selector) return null;

  return createCandidate({
    classId: SelectorClassIds.STATEFUL_LIFECYCLE_LINKAGE,
    selector,
    engine: SelectorEngines.PLAYWRIGHT_CSS,
    proof, // Pass pristine proof so downstream consumers can still read proof.triggerSelector
  });
}
