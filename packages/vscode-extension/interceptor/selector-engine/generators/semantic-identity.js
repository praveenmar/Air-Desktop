import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

export function generateSemanticIdentityShadow(proof) {
  if (proof?.proofType === 'accessibility') {
    console.log('[AIR Debug] Semantic Generator received:', proof);
  }
  
  if (proof?.proofType !== 'accessibility') return null;
  if (!proof.role) return null; // Semantic Identity fundamentally requires a role

  // Construct literal Playwright executable string
  let selector = `getByRole('${proof.role}')`;
  
  if (proof.accessibleName) {
    // Safely escape single quotes and backslashes
    const escapedName = proof.accessibleName.replace(/(['\\])/g, '\\$1');
    selector = `getByRole('${proof.role}', { name: '${escapedName}', exact: true })`;
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
