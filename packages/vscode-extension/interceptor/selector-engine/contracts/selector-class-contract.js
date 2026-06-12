export const SelectorClassIds = {
  DIRECT_IDENTITY: 'direct-identity',
  SEMANTIC_IDENTITY: 'semantic-identity',
  LABEL_BOUND_IDENTITY: 'label-bound-identity',
  SEMANTIC_CONTEXT_FILTERING: 'semantic-context-filtering',
  STRUCTURAL_ADJACENCY: 'structural-adjacency',
  NATIVE_DOM_NORMALIZATION: 'native-dom-normalization',
  STRUCTURAL_DISAMBIGUATION: 'structural-disambiguation'
};

export const SelectorEngines = {
  PLAYWRIGHT_CSS: 'playwright-css',
  PLAYWRIGHT_ARIA: 'playwright-aria'
};

/**
 * Creates an immutable Selector Candidate.
 * Modifiers must return new candidate objects rather than mutating existing ones.
 */
export function createCandidate({ classId, selector, engine, proof, metadata = {} }) {
  const candidate = {
    classId,
    selector,
    engine,
    appliedModifiers: Object.freeze([]),
    proof: Object.freeze({ ...proof }),
    metadata: Object.freeze({ ...metadata })
  };

  return Object.freeze(candidate);
}
