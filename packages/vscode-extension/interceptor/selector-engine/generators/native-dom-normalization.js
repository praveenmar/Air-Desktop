/**
 * Class 11 - Native DOM Normalization
 *
 * A proof normalizer, not a selector generator.
 * Applied once per proof before routing to any generator in assembleSelectorProofPacketV0.
 *
 * Normalizes invisible/variant Unicode characters in human-readable text fields only.
 * Never touches identity attributes (id, data-testid, name, href) - those are developer-set
 * values, not rendered text, and must be preserved byte-for-byte.
 *
 * Character normalization applied:
 * \u00a0, \u202f, \u2007, \u2009 -> regular space (U+0020) - various Unicode space variants
 * \u200b, \u200c, \u200d, \ufeff -> removed entirely       - zero-width chars
 *
 * After substitution: collapse multiple spaces -> single space, trim.
 *
 * Proof fields normalized by proofType:
 *
 * accessibility:      accessibleName
 * label:              fieldLabelText
 * bounded-field:      fieldLabelText
 * option-panel:       itemName, containerLabelText
 * table-row:          rowIdentityTexts (each element), columnHeaderText, actionName
 * tree-node:          nodeName, ancestorPath[*].ariaLabel
 * generic-container:  containerAnchorText, actionName
 *
 * Returns a new proof object (never mutates the original).
 */

const UNICODE_SPACES = /[\u00a0\u202f\u2007\u2009]/g;
const ZERO_WIDTH     = /[\u200b\u200c\u200d\ufeff]/g;
const MULTI_SPACE    = /\s+/g;
const FAST_FAIL_REGEX = /[\u00a0\u202f\u2007\u2009\u200b\u200c\u200d\ufeff]|\s{2,}/;

/**
 * Normalize a single text string.
 * Returns null if input is not a non-empty string.
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
export function normalizeProofText(text) {
  if (typeof text !== 'string') return text ?? null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!FAST_FAIL_REGEX.test(trimmed)) return trimmed;

  const result = trimmed
    .replace(UNICODE_SPACES, ' ')
    .replace(ZERO_WIDTH, '')
    .replace(MULTI_SPACE, ' ')
    .trim();
  return result.length > 0 ? result : null;
}

/**
 * Normalize all human-readable text fields in a proof object.
 * Returns a shallow copy with text fields replaced - never mutates.
 * Non-text fields (selectors, roles, booleans, numbers, IDs) are preserved exactly.
 *
 * @param {object} proof
 * @returns {object}
 */
export function applyNativeDomNormalization(proof) {
  if (!proof || typeof proof !== 'object') return proof;

  const type = proof.proofType;

  // --- accessibility proof (Class 2 + Class 3 input) ---
  if (type === 'accessibility') {
    const accessibleName = normalizeProofText(proof.accessibleName);
    if (accessibleName === proof.accessibleName) return proof; // no change
    return { ...proof, accessibleName };
  }

  // --- label proof (Class 3 input) ---
  if (type === 'label') {
    const fieldLabelText = normalizeProofText(proof.fieldLabelText);
    if (fieldLabelText === proof.fieldLabelText) return proof;
    return { ...proof, fieldLabelText };
  }

  // --- bounded-field proof (Class 4 input) ---
  if (type === 'bounded-field') {
    const fieldLabelText = normalizeProofText(proof.fieldLabelText);
    if (fieldLabelText === proof.fieldLabelText) return proof;
    return { ...proof, fieldLabelText };
  }

  // --- option-panel proof (Class 7 input) ---
  if (type === 'option-panel') {
    const itemName           = normalizeProofText(proof.itemName);
    const containerLabelText = normalizeProofText(proof.containerLabelText);
    if (
      itemName           === proof.itemName &&
      containerLabelText === proof.containerLabelText
    ) return proof;
    return { ...proof, itemName, containerLabelText };
  }

  // --- table-row proof (Class 8 + Class 4 input) ---
  if (type === 'table-row') {
    const columnHeaderText = normalizeProofText(proof.columnHeaderText);
    const actionName       = normalizeProofText(proof.actionName);
    const rowIdentityTexts = Array.isArray(proof.rowIdentityTexts)
      ? proof.rowIdentityTexts.map(t => normalizeProofText(t) ?? t)
      : proof.rowIdentityTexts;

    const rowChanged = Array.isArray(proof.rowIdentityTexts) &&
      proof.rowIdentityTexts.some((t, i) => rowIdentityTexts[i] !== t);

    if (
      columnHeaderText === proof.columnHeaderText &&
      actionName       === proof.actionName &&
      !rowChanged
    ) return proof;

    return { ...proof, columnHeaderText, actionName, rowIdentityTexts };
  }

  // --- tree-node proof (Class 9 input) ---
  if (type === 'tree-node') {
    const nodeName = normalizeProofText(proof.nodeName);
    const ancestorPath = Array.isArray(proof.ancestorPath)
      ? proof.ancestorPath.map(ancestor => {
          if (!ancestor || typeof ancestor !== 'object') return ancestor;
          const ariaLabel = normalizeProofText(ancestor.ariaLabel);
          if (ariaLabel === ancestor.ariaLabel) return ancestor;
          return { ...ancestor, ariaLabel };
        })
      : proof.ancestorPath;

    const ancestorChanged = Array.isArray(proof.ancestorPath) &&
      proof.ancestorPath.some((a, i) => ancestorPath[i] !== a);

    if (nodeName === proof.nodeName && !ancestorChanged) return proof;
    return { ...proof, nodeName, ancestorPath };
  }

  // --- generic-container proof (Class 4 input) ---
  if (type === 'generic-container') {
    const containerAnchorText = normalizeProofText(proof.containerAnchorText);
    const actionName          = normalizeProofText(proof.actionName);
    if (
      containerAnchorText === proof.containerAnchorText &&
      actionName          === proof.actionName
    ) return proof;
    return { ...proof, containerAnchorText, actionName };
  }

  // All other proof types (direct identity, raw identity proofs) - no text normalization
  return proof;
}
