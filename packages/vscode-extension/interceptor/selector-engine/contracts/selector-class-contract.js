export const SelectorClassIds = {
  DIRECT_IDENTITY: 'direct-identity',
  SEMANTIC_IDENTITY: 'semantic-identity',
  LABEL_BOUND_IDENTITY: 'label-bound-identity',
  SEMANTIC_CONTEXT_FILTERING: 'semantic-context-filtering',
  STRUCTURAL_ADJACENCY: 'structural-adjacency',        // TOMBSTONE - Class 5 retired, merged into Class 4
  NATIVE_DOM_NORMALIZATION: 'native-dom-normalization',
  STRUCTURAL_DISAMBIGUATION: 'structural-disambiguation',
  STATEFUL_LIFECYCLE_LINKAGE: 'stateful-lifecycle-linkage',
  COLLECTION_MEMBERSHIP: 'collection-membership',
  HIERARCHICAL_NAVIGATION: 'hierarchical-navigation'
};

export const SelectorEngines = {
  PLAYWRIGHT_CSS: 'playwright-css',
  PLAYWRIGHT_ARIA: 'playwright-aria',
  PLAYWRIGHT_NATIVE: 'playwright-native'
};

/**
 * Creates an immutable Selector Candidate.
 * Modifiers must return new candidate objects rather than mutating existing ones.
 */
export function createCandidate({ classId, selector, engine, proof, realizationSteps, metadata = {} }) {
  const candidate = {
    classId,
    selector,
    engine,
    realizationSteps: realizationSteps ? Object.freeze([...realizationSteps]) : undefined,
    appliedModifiers: Object.freeze([]),
    proof: Object.freeze({ ...proof }),
    metadata: Object.freeze({ ...metadata })
  };

  return Object.freeze(candidate);
}
