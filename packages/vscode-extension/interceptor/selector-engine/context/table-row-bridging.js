import { DEFAULT_MAX_CANDIDATES } from '../types.js';
import { finalizeCandidates } from '../evaluation.js';
import { resolveCanonicalCustomControlTargetInternal } from '../canonical-target.js';
import { buildProposalCandidateInput } from '../proposal-contract.js';
import {
  getSafeClassTokens,
  isLikelyDynamicId,
  safeTrim,
} from '../utils.js';
import { resolveTableRowContextEvidence } from './table-row.js';

function resolveProposalTarget(element, eventContext, tableRowContextEvidence, canonicalTargetInfo) {
  if (tableRowContextEvidence?.usedCanonicalTarget !== true) return element || null;
  const resolvedCanonicalTargetInfo = canonicalTargetInfo?.canonicalTarget
    ? canonicalTargetInfo
    : resolveCanonicalCustomControlTargetInternal(element, eventContext);
  return resolvedCanonicalTargetInfo?.canonicalTarget || element || null;
}

function escapeXPathLiteral(value) {
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

function buildClassPredicate(classToken) {
  const normalized = safeTrim(classToken);
  if (!normalized) return null;
  const tokenWithPadding = ` ${normalized} `
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  return `contains(concat(" ", normalize-space(@class), " "), "${tokenWithPadding}")`;
}

function getBestStableClassToken(element) {
  const tokens = getSafeClassTokens(element)
    .filter((token) => !/^(?:is|has)-/i.test(token))
    .filter((token) => !/^(?:css-|sc-)/i.test(token))
    .filter((token) => token.length >= 4)
    .sort((left, right) => left.length - right.length);
  return tokens[0] || null;
}

function getTableElement(element) {
  return element?.closest?.('table, [role="table"], [role="grid"]') || null;
}

function buildTableScopeXPath(tableElement) {
  if (!tableElement || tableElement.nodeType !== Node.ELEMENT_NODE) return null;
  const tagName = tableElement.tagName?.toLowerCase?.() || '';
  const role = safeTrim(tableElement.getAttribute?.('role') || '');

  if (tableElement.id && !isLikelyDynamicId(tableElement.id)) {
    if (tagName === 'table') return `//table[@id=${escapeXPathLiteral(tableElement.id)}]`;
    return `//*[@id=${escapeXPathLiteral(tableElement.id)}]`;
  }

  const classToken = getBestStableClassToken(tableElement);
  const classPredicate = classToken ? buildClassPredicate(classToken) : null;

  if (role) {
    const predicates = [`@role=${escapeXPathLiteral(role)}`];
    if (classPredicate) predicates.push(classPredicate);
    return `//*[(self::table or @role="table" or @role="grid") and ${predicates.join(' and ')}]`;
  }

  if (tagName === 'table') {
    if (classPredicate) return `//table[${classPredicate}]`;
    return '//table';
  }

  return classPredicate ? `//*[${classPredicate}]` : null;
}

function buildRowNodeXPath(rowElement) {
  if (!rowElement || rowElement.nodeType !== Node.ELEMENT_NODE) {
    return '//*[self::tr or @role="row"]';
  }
  const tagName = rowElement.tagName?.toLowerCase?.() || '';
  const role = safeTrim(rowElement.getAttribute?.('role') || '');
  if (tagName === 'tr') return '//tr';
  if (role === 'row') return '//*[@role="row"]';
  return '//*[self::tr or @role="row"]';
}

function buildActionNodeXPath(actionElement, proof) {
  const tagName = actionElement?.tagName?.toLowerCase?.() || '';
  const role = safeTrim(actionElement?.getAttribute?.('role') || proof?.actionRole || '');
  const href = safeTrim(actionElement?.getAttribute?.('href') || '');
  const type = safeTrim(actionElement?.getAttribute?.('type') || '');
  const classToken = getBestStableClassToken(actionElement);
  const predicates = [];

  let base = '*';
  if (tagName === 'button') base = 'button';
  else if (tagName === 'a') base = 'a';
  else if (tagName === 'input') {
    base = 'input';
    if (type) predicates.push(`@type=${escapeXPathLiteral(type)}`);
  } else if (role) {
    base = '*';
    predicates.push(`@role=${escapeXPathLiteral(role)}`);
  }

  if (href && tagName === 'a') predicates.push(`@href=${escapeXPathLiteral(href)}`);
  if (classToken) predicates.push(buildClassPredicate(classToken));

  if (predicates.length === 0) return `//${base}`;
  return `//${base}[${predicates.join(' and ')}]`;
}

function buildRowIdentityPredicate(rowIdentityTexts) {
  if (!Array.isArray(rowIdentityTexts) || rowIdentityTexts.length === 0) return null;
  const predicates = rowIdentityTexts
    .map((text) => safeTrim(text))
    .filter(Boolean)
    .map((text) => `.//*[contains(normalize-space(.), ${escapeXPathLiteral(text)})]`);
  if (predicates.length === 0) return null;
  return predicates.join(' and ');
}

function getRowElement(element) {
  return element?.closest?.('tr, [role="row"]') || null;
}

function resolveProposalMode(proof) {
  if (!proof?.isValid) return { blockedReason: proof?.blockedReason || 'table-row-invalid-proof' };
  if (!proof?.tableSelector) return { blockedReason: 'table-row-no-table-selector' };
  if (!proof?.actionSelector && !proof?.actionName) {
    return { blockedReason: 'table-row-no-action-binding' };
  }

  const uniqueTable = proof.uniqueTableBinding === true;
  const uniqueRow = proof.uniqueRowBinding === true;
  const uniqueAction = proof.uniqueActionBinding === true;

  if (proof.blockedReason) {
    return { blockedReason: proof.blockedReason };
  }

  if (!uniqueRow || !uniqueAction) {
    const canDisambiguateRow = uniqueRow || (Number.isInteger(proof.targetRowIndexWithinTable) && proof.targetRowIndexWithinTable >= 0);
    const canDisambiguateAction = uniqueAction || (Number.isInteger(proof.targetActionIndexWithinRow) && proof.targetActionIndexWithinRow >= 0);

    if (canDisambiguateRow && canDisambiguateAction) {
      return {
        mode: 'last-resort',
        uniqueTable,
        uniqueRow,
        uniqueAction,
      };
    }
    
    if (!canDisambiguateRow) return { blockedReason: 'table-row-ambiguous-row-identity' };
    return { blockedReason: 'table-row-ambiguous-action' };
  }

  return {
    mode: uniqueTable && uniqueRow && uniqueAction ? 'preferred' : 'fallback',
    uniqueTable,
    uniqueRow,
    uniqueAction,
  };
}

function buildPreferredOrFallbackXPath(proof, element) {
  const tableElement = getTableElement(element);
  const tableScopeXPath = buildTableScopeXPath(tableElement);
  const rowElement = getRowElement(element);
  const rowNodeXPath = buildRowNodeXPath(rowElement);
  const actionNodeXPath = buildActionNodeXPath(element, proof);
  const rowIdentityPredicate = buildRowIdentityPredicate(proof?.rowIdentityTexts);

  if (!tableScopeXPath || !actionNodeXPath || !rowIdentityPredicate) return null;
  return `${tableScopeXPath}${rowNodeXPath}[${rowIdentityPredicate}]${actionNodeXPath}`;
}

function buildPositionalXPath(proof, element) {
  const tableElement = getTableElement(element);
  const tableScopeXPath = buildTableScopeXPath(tableElement);
  const rowElement = getRowElement(element);
  const rowNodeXPath = buildRowNodeXPath(rowElement);
  const actionNodeXPath = buildActionNodeXPath(element, proof);
  const rowIdentityPredicate = buildRowIdentityPredicate(proof?.rowIdentityTexts);

  if (!tableScopeXPath || !actionNodeXPath) {
    return null;
  }

  const rowSelector = rowIdentityPredicate
    ? `${tableScopeXPath}${rowNodeXPath}[${rowIdentityPredicate}]`
    : `${tableScopeXPath}${rowNodeXPath}`;

  const needsRowIndex = proof?.uniqueRowBinding !== true && Number.isInteger(proof?.targetRowIndexWithinTable);
  const needsActionIndex = proof?.uniqueActionBinding !== true && Number.isInteger(proof?.targetActionIndexWithinRow);

  if (!needsRowIndex && !needsActionIndex) return null;

  let finalRowSelector = rowSelector;
  if (needsRowIndex) {
    finalRowSelector = `(${rowSelector})[${proof.targetRowIndexWithinTable + 1}]`;
  }

  if (needsActionIndex) {
    return `(${finalRowSelector}${actionNodeXPath})[${proof.targetActionIndexWithinRow + 1}]`;
  }

  return `${finalRowSelector}${actionNodeXPath}`;
}

function buildProposalInputs(proof, queryTarget, proposalMode, element) {
  const candidates = [];
  const tierHint = proposalMode?.mode === 'preferred'
    ? 'preferred'
    : (proposalMode?.mode === 'last-resort' ? 'last-resort' : 'fallback');
  const baseWarningCodes = [];

  if (proposalMode?.uniqueTable !== true) baseWarningCodes.push('incomplete-table-binding');
  if (proposalMode?.uniqueRow !== true) baseWarningCodes.push('ambiguous-row-binding');
  if (proposalMode?.uniqueAction !== true) baseWarningCodes.push('ambiguous-action-binding');

  if (proposalMode?.mode !== 'last-resort') {
    const xpathSelector = buildPreferredOrFallbackXPath(proof, queryTarget || element);
    if (xpathSelector) {
      const candidate = buildProposalCandidateInput({
        selector: xpathSelector,
        family: 'xpath',
        engine: 'xpath',
        proposalSource: 'table-row',
        queryTarget,
        proposalTierHint: tierHint,
        warningCodes: baseWarningCodes,
      });
      if (candidate) candidates.push(candidate);
    }
  }

  if (proposalMode?.mode === 'last-resort') {
    const positionalXPath = buildPositionalXPath(proof, queryTarget || element);
    if (positionalXPath) {
      const candidate = buildProposalCandidateInput({
        selector: positionalXPath,
        family: 'xpath',
        engine: 'xpath',
        proposalSource: 'table-row',
        queryTarget,
        proposalTierHint: 'last-resort',
        warningCodes: baseWarningCodes,
        usesIndex: true,
        requiresPositionalDisambiguation: true,
      });
      if (candidate) candidates.push(candidate);
    }
  }

  return candidates;
}

export function collectTableRowSelectorProposals({
  element,
  eventContext,
  tableRowContextEvidence,
  canonicalTargetInfo,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
} = {}) {
  const proof = tableRowContextEvidence || resolveTableRowContextEvidence({
    element,
    eventContext,
    canonicalTargetInfo,
  });
  const proposalMode = resolveProposalMode(proof);
  const blockedReason = proposalMode?.blockedReason || null;
  const queryTarget = resolveProposalTarget(
    element,
    eventContext,
    proof,
    canonicalTargetInfo,
  );

  if (blockedReason) {
    return {
      actionRole: proof?.actionRole || null,
      actionName: proof?.actionName || null,
      tableRole: proof?.tableRole || null,
      tableSelector: proof?.tableSelector || null,
      actionSelector: proof?.actionSelector || null,
      rowScopedActionSelector: proof?.rowScopedActionSelector || null,
      usedCanonicalTarget: proof?.usedCanonicalTarget === true,
      blockedReason,
      proposals: [],
    };
  }

  const proposals = finalizeCandidates(
    element,
    buildProposalInputs(proof, queryTarget, proposalMode, element),
    maxCandidates,
  );

  return {
    actionRole: proof?.actionRole || null,
    actionName: proof?.actionName || null,
    tableRole: proof?.tableRole || null,
    tableSelector: proof?.tableSelector || null,
    actionSelector: proof?.actionSelector || null,
    rowScopedActionSelector: proof?.rowScopedActionSelector || null,
    usedCanonicalTarget: proof?.usedCanonicalTarget === true,
    blockedReason: proposals.length > 0 ? null : 'table-row-no-renderable-scope',
    proposals,
  };
}
