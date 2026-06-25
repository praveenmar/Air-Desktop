import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

// Escape single-quotes and backslashes for interpolation into '...' JS string literals.
const escapeText = (str) => (str ? str.replace(/(['\\])/g, '\\$1') : '');
const escapeCss = (str) => (str ? str.replace(/(['\\])/g, '\\$1') : '');

// Container roles that are semantically meaningful for scoping.
// 'group' and 'grid' intentionally excluded - too generic for reliable ARIA name lookup.
const ALLOWED_CONTAINER_ROLES = new Set(['listbox', 'menu', 'tree', 'tablist']);



// itemNameSource values that represent a real accessible name (not raw DOM text).
const TRUSTED_NAME_SOURCES = new Set(['accessibility', 'event-context']);

/**
 * Class 7 - Stateful Lifecycle Linkage
 *
 * Generates selectors for panel option items (listbox options, menu items, tree items, tabs).
 * Emits up to 4 candidates per proof, ordered from most to least reliable:
 *
 * Shape C - ARIA label scoped:      getByRole(container).getByRole(item, name)
 * Shape B - Container ID anchor:    locator('[role=X]#id').getByRole(item, name)
 * Shape D - Detached/portaled:      getByRole(container).getByRole(item, name)  (unscoped container)
 * Shape P - Positional fallback:    locator(container).locator(item).nth(N)
 *
 * Returns an array (never null). Empty array = all shapes gated out.
 *
 * @param {object} proof - A proof object with proofType === 'option-panel'
 * @returns {import('../contracts/selector-class-contract.js').Candidate[]}
 */
export function generateStatefulLifecycleShadow(proof) {
  // Hard gate: only process option-panel proofs
  if (!proof || proof.proofType !== 'option-panel') return [];
  if (proof.isValid !== true) return [];

  const {
    itemRole,
    itemName,
    itemNameSource,
    containerRole,
    containerLabelText,
    containerLabelSource,
    containerLabelVolatile,
    uniqueByAriaName,
    uniqueByTrigger,
    containerId,
    isDynamicContainerId,
    triggerRelation,
    requiresPositionalDisambiguation,
    targetIndexWithinContainer,
    containerSelector,
    itemSelector,
  } = proof;

  const candidates = [];

  // --- Shared gate: item must have a role AND a trusted name for ARIA shapes -------
  const hasItem       = !!itemRole;
  const hasTrustedName = !!itemName && TRUSTED_NAME_SOURCES.has(itemNameSource);
  const hasContainerRole = !!containerRole && ALLOWED_CONTAINER_ROLES.has(containerRole);

  // --- Shape C - ARIA label scoped --------------------------------------------------
  // Requires: trusted name, allowed container role, a valid ARIA label on the container
  // (only aria-label and aria-labelledby give Playwright a resolvable accessible name)
  // and uniqueness by ARIA name, and the label must not encode volatile state text.
  const shapeCAllowed =
    hasItem &&
    hasTrustedName &&
    hasContainerRole &&
    !!containerLabelText &&
    (containerLabelSource === 'aria-label' || containerLabelSource === 'aria-labelledby') &&
    containerLabelVolatile !== true &&
    uniqueByAriaName === true &&
    requiresPositionalDisambiguation !== true;

  if (shapeCAllowed) {
    const selector = `getByRole('${escapeText(containerRole)}', { name: '${escapeText(containerLabelText)}' }).getByRole('${escapeText(itemRole)}', { name: '${escapeText(itemName)}', exact: true })`;
    candidates.push(createCandidate({
      classId: SelectorClassIds.STATEFUL_LIFECYCLE_LINKAGE,
      selector,
      engine: SelectorEngines.PLAYWRIGHT_ARIA,
      proof,
      metadata: { shape: 'C', reason: 'aria-label-scoped' }
    }));
  }

  // --- Shape B - Container ID anchor ------------------------------------------------
  // Requires: trusted name, allowed container role, a stable (non-dynamic) container ID,
  // and a formal ARIA ownership link (aria-controls or aria-owns).
  // Shape B locates the panel DIRECTLY by its stable ID - NOT via trigger child-scope chaining.
  // This avoids the portaled-panel problem (React/Vue/Angular panels rendered in <body>).
  const shapeBAllowed =
    hasItem &&
    hasTrustedName &&
    hasContainerRole &&
    !!containerId &&
    isDynamicContainerId !== true &&
    uniqueByTrigger === true &&
    requiresPositionalDisambiguation !== true;

  if (shapeBAllowed) {
    const selector = `locator('[role="${escapeCss(containerRole)}"]#${escapeCss(containerId)}').getByRole('${escapeText(itemRole)}', { name: '${escapeText(itemName)}', exact: true })`;
    candidates.push(createCandidate({
      classId: SelectorClassIds.STATEFUL_LIFECYCLE_LINKAGE,
      selector,
      engine: SelectorEngines.PLAYWRIGHT_NATIVE,
      proof,
      metadata: { shape: 'B', reason: 'container-id-anchor' }
    }));
  }

  // --- Shape D - Detached/portaled path ---------------------------------------------
  // For panels that are detached at fingerprint time (SPA portals, teleports).
  // Uses event-context proof captured at interaction time.
  // Container is not uniquely anchored - emits a global scoped ARIA role lookup.
  // Must NOT fire when requiresPositionalDisambiguation is true (duplicate options - no position data in detached path).
  const shapeDAllowed =
    hasItem &&
    hasTrustedName &&
    hasContainerRole &&
    triggerRelation === 'open-dropdown-context' &&
    requiresPositionalDisambiguation !== true;

  if (shapeDAllowed) {
    const selector = `getByRole('${escapeText(containerRole)}').getByRole('${escapeText(itemRole)}', { name: '${escapeText(itemName)}', exact: true })`;
    candidates.push(createCandidate({
      classId: SelectorClassIds.STATEFUL_LIFECYCLE_LINKAGE,
      selector,
      engine: SelectorEngines.PLAYWRIGHT_ARIA,
      proof,
      metadata: { shape: 'D', reason: 'detached-context' }
    }));
  }

  // --- Shape P - Positional fallback (last-resort) ----------------------------------
  // Fires when the item text is duplicated inside the panel and no semantic unique path exists.
  // Uses CSS :nth-of-type is WRONG - use Playwright's .nth() which is 0-based.
  // Only fires when all of: positional disambiguation needed, valid index, valid container+item selectors.
  // Note: Class 6 is NOT delegated to. Class 7 owns positional fallback for option-panel proofs.
  const shapePAllowed =
    requiresPositionalDisambiguation === true &&
    typeof targetIndexWithinContainer === 'number' &&
    targetIndexWithinContainer >= 0 &&
    !!containerSelector &&
    !!itemSelector;

  if (shapePAllowed) {
    const selector = `locator('${escapeCss(containerSelector)}').locator('${escapeCss(itemSelector)}').nth(${targetIndexWithinContainer})`;
    candidates.push(createCandidate({
      classId: SelectorClassIds.STATEFUL_LIFECYCLE_LINKAGE,
      selector,
      engine: SelectorEngines.PLAYWRIGHT_NATIVE,
      proof,
      metadata: { shape: 'P', reason: 'positional-fallback' }
    }));
  }

  return candidates;
}
