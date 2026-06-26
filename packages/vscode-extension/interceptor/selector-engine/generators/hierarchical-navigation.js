import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

// Escape single-quotes and backslashes for JS string literal interpolation.
const esc = (str) => (str ? str.replace(/(['\\])/g, '\\$1') : '');

// Escape for use inside a CSS attribute value: [aria-label="..."]
// Needs to escape double-quotes and backslashes.
const escCssAttr = (str) => (str ? str.replace(/(["\\])/g, '\\$1') : '');

/**
 * Class 9 - Hierarchical Navigation
 *
 * Generates selectors for treeitem elements inside ARIA tree containers.
 * Emits up to three candidates per proof, ordered from most to least reliable:
 *
 * Shape N  - Name-only:      locator(tree).getByRole('treeitem', { name, exact:true })
 * Engine: PLAYWRIGHT_ARIA
 * When: nodeName is present (always attempted - globally unique or not)
 *
 * Shape P-aria - CSS aria-label chain:
 * locator(tree).locator('[aria-label="A"] [role="treeitem"][aria-label="B"]')
 * Engine: PLAYWRIGHT_CSS   (pure CSS descendant, collapse-independent)
 * When: ancestorPath is non-empty AND every ancestor has ariaLabel set
 *
 * Shape P-chain - Chained getByRole:
 * locator(tree).getByRole('treeitem', {name:'A'}).getByRole('treeitem', {name:'B'})
 * Engine: PLAYWRIGHT_ARIA
 * When: ancestorPath is non-empty AND any ancestor lacks ariaLabel
 * Note: collapse-state dependent. The src node must be expanded at replay
 * for its children to be reachable via scoped .getByRole().
 * Doctrine: Refusing to emit anything for a non-aria-labeled nested tree
 * is worse than emitting a lower-confidence collapse-dependent candidate.
 * Shape P-chain is a documented-limitation fallback, not brute-forcing.
 *
 * Returns an array (never null). Empty array = all shapes gated out.
 *
 * @param {object} proof - A proof object with proofType === 'tree-node'
 * @returns {import('../contracts/selector-class-contract.js').Candidate[]}
 */
export function generateHierarchicalNavigationShadow(proof) {
  // Hard gate: only process tree-node proofs
  if (!proof || proof.proofType !== 'tree-node') return [];
  if (proof.isValid !== true) return [];

  const { treeSelector, nodeName, ancestorPath } = proof;

  // Minimum requirement: must have a tree anchor AND a leaf name
  if (!treeSelector || !nodeName) return [];

  const candidates = [];

  // --- Shape N - Name-only ARIA lookup -------------------------------------
  // Always emitted when we have a name. The ranking phase and Playwright strict-mode
  // will determine at replay time whether this is unique or not. If non-unique,
  // Shape P-aria or Shape P-chain (also in the packet) will be used as fallback.
  {
    const selector = `locator('${esc(treeSelector)}').getByRole('treeitem', { name: '${esc(nodeName)}', exact: true })`;
    candidates.push(createCandidate({
      classId: SelectorClassIds.HIERARCHICAL_NAVIGATION,
      selector,
      engine: SelectorEngines.PLAYWRIGHT_ARIA,
      proof,
      metadata: { shape: 'N', reason: 'name-only', nodeLevel: proof.depth }
    }));
  }

  // --- Shape P-aria - CSS aria-label descendant chain (collapse-independent) ---
  // Only viable when EVERY ancestor in the path has an ariaLabel recorded.
  // This form uses a pure CSS descendant selector, which works whether the
  // parent node is expanded or collapsed at replay time.
  const hasAncestors = Array.isArray(ancestorPath) && ancestorPath.length > 0;
  const allAncestorsHaveAriaLabel = hasAncestors && ancestorPath.every(a => !!a.ariaLabel);

  if (hasAncestors && allAncestorsHaveAriaLabel) {
    // Build: [aria-label="A"] [role="treeitem"][aria-label="B"] ... [role="treeitem"][aria-label="leaf"]
    const ancestorCss = ancestorPath
      .map((a, i) => i === 0
        ? `[aria-label="${escCssAttr(a.ariaLabel)}"]`
        : `[role="treeitem"][aria-label="${escCssAttr(a.ariaLabel)}"]`
      )
      .join(' ');
    const leafCss = `[role="treeitem"][aria-label="${escCssAttr(nodeName)}"]`;
    const fullCss = `${ancestorCss} ${leafCss}`;
    const selector = `locator('${esc(treeSelector)}').locator('${esc(fullCss)}')`;
    candidates.push(createCandidate({
      classId: SelectorClassIds.HIERARCHICAL_NAVIGATION,
      selector,
      engine: SelectorEngines.PLAYWRIGHT_CSS,
      proof,
      metadata: { shape: 'P-aria', reason: 'aria-label-css-chain', nodeLevel: proof.depth }
    }));
  }

  // --- Shape P-chain - Chained .getByRole() (collapse-state dependent) ----------------
  // Used when ancestorPath exists but any ancestor lacks an aria-label.
  // Each step scopes within the previous treeitem's DOM subtree.
  // IMPORTANT: This selector will fail at replay if any ancestor node is collapsed
  // (children removed from DOM or set display:none). This is a documented limitation,
  // not brute-forcing. The alternative - emitting nothing - would leave the test with
  // only Shape N, which may be non-unique. A fragile candidate with documented behaviour
  // is more useful than silence.
  if (hasAncestors && !allAncestorsHaveAriaLabel) {
    let chain = `locator('${esc(treeSelector)}')`;
    for (const ancestor of ancestorPath) {
      chain += `.getByRole('treeitem', { name: '${esc(ancestor.name)}', exact: true })`;
    }
    chain += `.getByRole('treeitem', { name: '${esc(nodeName)}', exact: true })`;
    candidates.push(createCandidate({
      classId: SelectorClassIds.HIERARCHICAL_NAVIGATION,
      selector: chain,
      engine: SelectorEngines.PLAYWRIGHT_ARIA,
      proof,
      metadata: {
        shape: 'P-chain',
        reason: 'chained-filter-fallback',
        collapseDependent: true,
        nodeLevel: proof.depth
      }
    }));
  }

  return candidates;
}
