/**
 * @typedef {Object} CandidateProof
 * @property {string} source - The interceptor module that generated the proof (e.g., 'interceptor.js')
 * @property {string} [identityType] - The type of identity (e.g., 'data-testid', 'id')
 * @property {string} [value] - The value of the identity attribute
 * @property {boolean} [isLikelyDynamic] - Whether the ID appears auto-generated
 */

/**
 * @typedef {Object} Candidate
 * @property {string} classId - The originating generator class (e.g., 'direct-identity')
 * @property {string} selector - The synthesized selector string
 * @property {string} engine - The selector engine (e.g., 'playwright-css')
 * @property {string[]} appliedModifiers - Array of modifier IDs that transformed this candidate
 * @property {CandidateProof} proof - The pure proof object that generated this candidate
 */

/**
 * @typedef {Object} SelectorProofPacketV0
 * @property {Candidate[]} candidates - Array of fully synthesized/transformed candidates
 */

import { safeCssEscape } from '../utils.js';
import { createCandidate, SelectorClassIds, SelectorEngines } from '../contracts/selector-class-contract.js';

/**
 * Class 1: Direct Identity Generator
 * Synthesizes a base Candidate object exclusively from a pure JSON proof.
 * 
 * @param {CandidateProof} proof - Pure JSON proof object
 * @returns {Candidate|null} A pure Candidate object, or null if proof is invalid
 */
export function generateDirectIdentityShadow(proof) {
  if (!proof || !proof.identityType || !proof.value) return null;

  // We do not emit ID candidates if the orchestrator marked them as dynamic
  if (proof.identityType === 'id' && proof.isLikelyDynamic) return null;

  const isTestId = proof.identityType === 'data-testid';
  const selector = isTestId
    ? `[data-testid="${safeCssEscape(proof.value)}"]`
    : `[id="${safeCssEscape(proof.value)}"]`;

  return createCandidate({
    classId: SelectorClassIds.DIRECT_IDENTITY,
    selector,
    engine: SelectorEngines.PLAYWRIGHT_CSS,
    proof: proof
  });
}
