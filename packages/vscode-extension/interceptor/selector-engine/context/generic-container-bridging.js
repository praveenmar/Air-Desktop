import { safeTrim } from '../utils.js';
import { isFastVisible } from '../shared/visibility.js';

export function escapeXPathLiteral(value) {
  const normalized = safeTrim(value);
  if (!normalized.includes('"')) return `"${normalized}"`;
  if (!normalized.includes('\'')) return `'${normalized}'`;
  const parts = normalized.split('"');
  const tokens = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index]) tokens.push(`"${parts[index]}"`);
    if (index < parts.length - 1) tokens.push('\'"\'');
  }
  return `concat(${tokens.join(', ')})`;
}

export function collectGenericContainerProposals(proof, doc) {
  if (!proof || proof.isValid !== true) return [];
  if (proof.uniqueContainerBinding !== true || proof.uniqueAnchorBinding !== true || proof.uniqueActionBinding !== true) {
    return [];
  }

  const containerTag = proof.containerTag;
  const isRoleBackedContainer = proof.containerSelectorKind === 'region' || proof.containerSelectorKind === 'dialog' || proof.containerSelectorKind === 'alertdialog';
  const hasValidContainerMetadata = containerTag || (isRoleBackedContainer && proof.containerRole);

  const anchorTag = proof.anchorTag;
  const hasValidAnchorMetadata = (proof.anchorSource === 'aria-labelledby' || proof.anchorSource === 'aria-label') || anchorTag;

  const actionTag = proof.actionTag;
  const hasValidActionMetadata = !!actionTag;

  if (!hasValidContainerMetadata || !hasValidAnchorMetadata || !hasValidActionMetadata) {
    return [{
      selector: '',
      engine: 'xpath',
      family: 'generic-container',
      proposalSource: 'generic-container',
      matchCount: 0,
      visibleMatchCount: 0,
      isDiagnosticOnly: true,
      eligibleForSelection: false,
      suppressedBy: null,
      warningCodes: ['generic-container-proposal-missing-required-metadata'],
      blockedReason: 'generic-container-proposal-missing-required-metadata',
    }];
  }

  // 1. Container Predicate
  let containerSelector = `//${containerTag}`;
  if (isRoleBackedContainer && proof.containerRole) {
    containerSelector = `//*[@role="${proof.containerRole}"]`;
  }

  // 2. Anchor Predicate
  let anchorPredicate = '';
  if (proof.anchorSource === 'aria-labelledby' && proof.anchorId) {
    anchorPredicate = `[@aria-labelledby="${proof.anchorId}"]`;
  } else if (proof.anchorSource === 'aria-label') {
    anchorPredicate = `[@aria-label=${escapeXPathLiteral(proof.containerAnchorText)}]`;
  } else {
    anchorPredicate = `[.//${anchorTag}[normalize-space(.)=${escapeXPathLiteral(proof.containerAnchorText)}]]`;
  }

  // 3. Action Predicate
  let actionPredicate = '';
  
  if (proof.actionNameSource === 'aria-label') {
    actionPredicate = `//${actionTag}[@aria-label=${escapeXPathLiteral(proof.actionName)}]`;
  } else if (proof.actionNameSource === 'title') {
    actionPredicate = `//${actionTag}[@title=${escapeXPathLiteral(proof.actionName)}]`;
  } else if (proof.actionNameSource === 'value' && actionTag === 'input') {
    if (!proof.actionInputType) {
      return [{
        selector: '',
        engine: 'xpath',
        family: 'generic-container',
        proposalSource: 'generic-container',
        matchCount: 0,
        visibleMatchCount: 0,
        isDiagnosticOnly: true,
        eligibleForSelection: false,
        suppressedBy: null,
        warningCodes: ['generic-container-proposal-missing-required-metadata'],
        blockedReason: 'generic-container-proposal-missing-required-metadata',
      }];
    }
    actionPredicate = `//input[@type="${proof.actionInputType}" and @value=${escapeXPathLiteral(proof.actionName)}]`;
  } else {
    // Normal Text
    actionPredicate = `//${actionTag}[normalize-space(.)=${escapeXPathLiteral(proof.actionName)}]`;
  }

  const finalXPath = `${containerSelector}${anchorPredicate}${actionPredicate}`;

  // 4. Evaluate using DOM APIs
  const root = doc || document;
  let matches;
  try {
    matches = root.evaluate(finalXPath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  } catch (e) {
    return []; // invalid xpath fallback
  }

  const matchCount = matches.snapshotLength;
  let visibleMatchCount = 0;
  for (let i = 0; i < matchCount; i++) {
    if (isFastVisible(matches.snapshotItem(i))) {
      visibleMatchCount += 1;
    }
  }

  const warningCodes = [];
  let isSafe = matchCount === 1 && visibleMatchCount === 1;
  let blockedReason = null;

  if (matchCount === 0) {
    warningCodes.push('generic-container-proposal-no-match');
    isSafe = false;
  } else if (matchCount > 1) {
    warningCodes.push('generic-container-proposal-not-unique');
    isSafe = false;
  }
  
  if (matchCount > 0 && visibleMatchCount === 0) {
    warningCodes.push('generic-container-proposal-not-visible');
    isSafe = false;
  } else if (visibleMatchCount > 1) {
    warningCodes.push('generic-container-proposal-not-visible-unique');
    isSafe = false;
  }

  let eligibleForSelection = isSafe;

  // 5. Apply suppression rules correctly
  if (proof.suppressedBy) {
    eligibleForSelection = false;
    warningCodes.push('suppressed-by-specialized-proof');
    blockedReason = 'specialized-proof-already-available';
  }

  return [{
    selector: finalXPath,
    engine: 'xpath',
    family: 'generic-container',
    proposalSource: 'generic-container',
    matchCount,
    visibleMatchCount,
    isDiagnosticOnly: true,
    eligibleForSelection,
    suppressedBy: proof.suppressedBy || null,
    warningCodes,
    blockedReason,
  }];
}
