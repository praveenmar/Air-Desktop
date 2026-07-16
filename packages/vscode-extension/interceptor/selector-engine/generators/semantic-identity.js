import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

export function generateSemanticIdentityShadow(proof) {
  if (proof?.proofType === 'accessibility') {
    console.log('[AIR Debug] Semantic Generator received:', proof);
  }
  
  if (proof?.proofType !== 'accessibility') return null;
  if (!proof.role && proof.accessibleNameSource !== 'text-content') return null; // Semantic Identity requires a role or a generic text-content fallback

  // --- OWNERSHIP BOUNDARY ENFORCEMENT ---
  // Class 2 (Semantic Identity) owns Intrinsic Semantics.
  // Class 3 (Label Bound Identity) owns Relational Semantics.
  if (
    proof.accessibleNameSource === 'label-for' ||
    proof.accessibleNameSource === 'wrapped-label' ||
    proof.accessibleNameSource === 'aria-labelledby'
  ) {
    return null; // Delegate to Class 3
  }

  // Construct literal Playwright executable string
  let selector = '';
  if (proof.role) {
    selector = `getByRole('${proof.role}')`;
  }
  
  if (proof.accessibleName) {
    // Safely escape single quotes and backslashes
    const escapedName = proof.accessibleName.replace(/(['\\])/g, '\\$1');
    
    if (proof.accessibleNameSource === 'text-content') {
      selector = `getByText('${escapedName}', { exact: true })`;
    } else if (proof.accessibleNameSource === 'placeholder') {
      selector = `getByPlaceholder('${escapedName}')`;
    } else if (proof.accessibleNameSource === 'title') {
      selector = `getByTitle('${escapedName}')`;
    } else if (proof.role) {
      selector = `getByRole('${proof.role}', { name: '${escapedName}', exact: true })`;
    }
  }

  // Pure Generation: 
  // accessibleNameIsDynamic is preserved in the proof, but completely ignored during selector generation.
  // It acts strictly as telemetry for downstream Modifiers.

  return createCandidate({
    classId: SelectorClassIds.SEMANTIC_IDENTITY,
    selector,
    engine: SelectorEngines.PLAYWRIGHT_ARIA,
    proof, // Pass the pristine, unmutated proof object
  });
}
