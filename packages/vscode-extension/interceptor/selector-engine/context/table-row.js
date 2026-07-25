import {
  buildAttributeSelector,
  getSafeClassTokens,
  safeCssEscape,
  isLikelyDynamicId,
  safeTrim,
  normalizeText,
} from '../utils.js';
import { isFastVisible, queryVisibleElements, countVisibleMatches } from '../shared/visibility.js';
import { getRole } from '../shared/dom-attributes.js';
import { escapeTextLiteral, normalizeLabelText, extractReferencedText } from '../shared/text.js';
import { summarizeTarget as _summarizeTarget } from '../shared/target-summary.js';
import { buildSelectorForElement } from '../shared/selectors.js';
import { resolveAccessibilityEvidence } from '../accessibility/role-name.js';
import { resolveCanonicalCustomControlTargetInternal } from '../canonical-target.js';
import { chooseSemanticRowIdentity } from './semantic-row-anchor.js';

function summarizeTarget(element) {
  return _summarizeTarget(element, { includeClassList: true });
}

// [role="treegrid"] included: a treegrid is a hybrid tree+grid widget.
// Class 8 handles row identity + action (grid dimension).
// Class 9 handles ancestry (tree dimension). Both can emit for the same element.
const TABLE_SELECTOR = 'table, [role="table"], [role="grid"], [role="treegrid"]';
const ROW_SELECTOR = 'tr, [role="row"]';
const CELL_SELECTOR = 'td, th, [role="cell"], [role="gridcell"], [role="rowheader"], [role="columnheader"]';
const ACTION_SELECTOR = 'button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"], a[href], input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="switch"]';
const HEADER_CELL_SELECTOR = 'thead th, th[scope="col"], [role="columnheader"]';
const MAX_IDENTITY_TOKENS = 3;


function findTable(target) {
  return target?.closest?.(TABLE_SELECTOR) || null;
}

function findRow(target) {
  return target?.closest?.(ROW_SELECTOR) || null;
}


function buildTableSummary(table) {
  if (!table || table.nodeType !== Node.ELEMENT_NODE) return null;
  const role = getRole(table);
  if (role) return role;
  const tagName = table.tagName?.toLowerCase?.() || 'table';
  const classToken = getSafeClassTokens(table)[0];
  return classToken ? `${tagName}.${classToken}` : tagName;
}


function findTableLabel(table) {
  if (!table || table.nodeType !== Node.ELEMENT_NODE) {
    return {
      tableLabelText: null,
      tableLabelSource: 'none',
    };
  }

  const ariaLabel = normalizeLabelText(table.getAttribute?.('aria-label') || '');
  if (ariaLabel) {
    return {
      tableLabelText: ariaLabel,
      tableLabelSource: 'aria-label',
    };
  }

  const ariaLabelledBy = safeTrim(table.getAttribute?.('aria-labelledby') || '');
  if (ariaLabelledBy) {
    const referenced = extractReferencedText(table.ownerDocument || document, ariaLabelledBy);
    if (referenced) {
      return {
        tableLabelText: referenced,
        tableLabelSource: 'aria-labelledby',
      };
    }
  }

  try {
    const heading = Array.from(table.querySelectorAll('caption, h1, h2, h3, h4, h5, h6, [role="heading"]'))
      .find((candidate) => isFastVisible(candidate) && normalizeLabelText(candidate.textContent || ''));
    const text = normalizeLabelText(heading?.textContent || '');
    if (text) {
      return {
        tableLabelText: text,
        tableLabelSource: heading.tagName?.toLowerCase?.() === 'caption' ? 'caption' : 'heading',
      };
    }
  } catch {
    // Fail closed.
  }

  return {
    tableLabelText: null,
    tableLabelSource: 'none',
  };
}

function getVisibleRows(table) {
  return queryVisibleElements(table, ROW_SELECTOR).filter((row) => (
    row.querySelector?.(CELL_SELECTOR)
  ));
}

function getVisibleCells(row) {
  return queryVisibleElements(row, CELL_SELECTOR);
}

function isActionControl(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  try {
    return element.matches(ACTION_SELECTOR);
  } catch {
    return false;
  }
}

function extractActionName(target, accessibilityProof) {
  return accessibilityProof?.accessibleName
    || normalizeLabelText(target?.textContent || '')
    || normalizeLabelText(target?.getAttribute?.('title') || '')
    || normalizeLabelText(target?.getAttribute?.('aria-label') || '')
    || null;
}

function buildActionSelector(target, accessibilityProof) {
  const role = accessibilityProof?.role || getRole(target);
  const tagName = target?.tagName?.toLowerCase?.() || '';
  const isActionLike = isActionControl(target)
    || role === 'button'
    || role === 'link'
    || ['checkbox', 'radio', 'switch'].includes(role)
    || (tagName === 'input' && ['button', 'submit', 'reset', 'checkbox', 'radio'].includes(safeTrim(target.getAttribute?.('type') || '').toLowerCase()));

  if (!isActionLike) return null;

  return buildSelectorForElement(target, {
    allowHref: true,
    allowType: true,
    allowRole: true,
  });
}

function getColumnIndex(target, row) {
  const cells = getVisibleCells(row);
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index].contains(target)) return index;
  }
  return -1;
}

function getHeaderTexts(table) {
  const explicitHeaders = queryVisibleElements(table, HEADER_CELL_SELECTOR)
    .map((header) => normalizeLabelText(header.textContent || ''))
    .filter(Boolean);
  if (explicitHeaders.length > 0) return explicitHeaders;

  const firstRow = queryVisibleElements(table, ROW_SELECTOR)[0] || null;
  if (!firstRow) return [];
  return getVisibleCells(firstRow)
    .map((cell) => normalizeLabelText(cell.textContent || ''))
    .filter(Boolean);
}

function extractRowCellTexts(row, target, actionName) {
  return getVisibleCells(row)
    .map((cell, index) => {
      const text = normalizeLabelText(cell.textContent || '');
      const containsTarget = !!target && cell.contains(target);
      const hasActionControls = queryVisibleElements(cell, ACTION_SELECTOR).length > 0;
      return {
        index,
        text,
        containsTarget,
        hasActionControls,
      };
    })
    .filter((entry) => !!entry.text)
    .filter((entry) => entry.text.length <= 100)
    .filter((entry) => !(entry.containsTarget && entry.text === actionName))
    .filter((entry) => !(entry.hasActionControls && entry.text === actionName))
    .filter((entry) => !/^(?:edit|delete|remove|view|open|save|submit|go)$/i.test(entry.text));
}


function countMatchingActionsInRow(row, actionSelector, actionName, target) {
  if (!row) return 0;

  if (actionSelector) {
    try {
      const matches = Array.from(row.querySelectorAll(actionSelector)).filter(isFastVisible);
      if (matches.length > 0) return matches.length;
    } catch {
      // Ignore selector failures.
    }
  }

  if (!actionName) return 0;
  return queryVisibleElements(row, ACTION_SELECTOR)
    .filter((candidate) => extractActionName(candidate, null) === actionName)
    .length;
}

function getTargetActionIndexWithinRow(row, target, actionSelector, actionName) {
  if (!row || !target) return -1;

  if (actionSelector) {
    try {
      // Use raw DOM order without visibility filtering so the index perfectly
      // aligns with Playwright's .nth() which counts all matched nodes.
      const matches = Array.from(row.querySelectorAll(actionSelector));
      return matches.indexOf(target);
    } catch {
      // Ignore selector failures.
    }
  }

  if (!actionName) return -1;
  // Use raw querySelectorAll instead of queryVisibleElements
  const matches = Array.from(row.querySelectorAll(ACTION_SELECTOR))
    .filter((candidate) => extractActionName(candidate, null) === actionName);
  return matches.indexOf(target);
}


function buildRowSelector(row) {
  if (!row || row.nodeType !== Node.ELEMENT_NODE) return 'tr';
  const tagName = row.tagName?.toLowerCase?.() || '';
  if (tagName === 'tr') return 'tr';
  const role = getRole(row);
  if (role === 'row') return '[role="row"]';
  return tagName || 'tr';
}

function buildRowScopedActionSelector(tableSelector, rowIdentityTexts, actionSelector, row) {
  if (!tableSelector || !actionSelector || !Array.isArray(rowIdentityTexts) || rowIdentityTexts.length === 0) {
    return null;
  }

  // Use :has(cell:text-is("exact")) instead of :has-text("substring").
  //
  // Rationale:
  //   :has-text("Alice") - substring, matches "Alice" AND "Alice Smith" -> strict-mode violation
  //   :has(td:text-is("Alice"), [role="cell"]:text-is("Alice")) - exact cell content match only
  //
  // Multiple identity texts chain as AND conditions (each :has() must be satisfied independently):
  //   :has(td:text-is("Alice"),...):has(td:text-is("admin"),...) -> row must contain BOTH cells
  //
  // Cell selector covers: td, th, [role="cell"], [role="gridcell"], [role="rowheader"], [role="columnheader"]
  // This mirrors CELL_SELECTOR used elsewhere in this file.
  const CELL_TEXT_TARGETS = 'td, th, [role="cell"], [role="gridcell"], [role="rowheader"], [role="columnheader"]';
  const textScope = rowIdentityTexts
    .map((text) => {
      const escaped = escapeTextLiteral(text);
      const cellSelectors = CELL_TEXT_TARGETS
        .split(',')
        .map((s) => `${s.trim()}:text-is("${escaped}")`)
        .join(', ');
      return `:has(${cellSelectors})`;
    })
    .join('');
  return `${tableSelector} ${buildRowSelector(row)}${textScope} ${actionSelector}`;
}

export function resolveTableRowContextEvidence({
  element,
  eventContext,
  canonicalTargetInfo,
  accessibilityEvidence,
} = {}) {
  const rawTarget = element || null;
  if (!rawTarget || rawTarget.nodeType !== Node.ELEMENT_NODE || rawTarget.isConnected === false) {
    return {
      rawTargetSummary: summarizeTarget(rawTarget),
      effectiveTargetSummary: null,
      proofTargetSummary: null,
      usedCanonicalTarget: false,
      actionRole: null,
      actionName: null,
      actionNameSource: 'none',
      actionSelector: null,
      tableRole: null,
      tableLabelText: null,
      tableLabelSource: 'none',
      tableSummary: null,
      tableSelector: null,
      columnHeaderText: null,
      columnIndex: null,
      rowIdentityTexts: [],
      rowIdentityMode: 'none',
      rowIdentitySource: 'none',
      rowIdentityReasons: [],
      rejectedRowIdentityCandidates: [],
      rowScopedActionSelector: null,
      visibleRowCountInTable: null,
      targetRowIndexWithinTable: null,
      targetActionIndexWithinRow: null,
      matchingTableCount: null,
      matchingRowIdentityCount: null,
      matchingActionCountInRow: null,
      uniqueTableBinding: false,
      uniqueRowBinding: false,
      uniqueActionBinding: false,
      requiresPositionalDisambiguation: false,
      isValid: false,
      blockedReason: 'detached-target',
    };
  }

  const resolvedCanonicalTargetInfo = canonicalTargetInfo?.canonicalTarget
    ? canonicalTargetInfo
    : resolveCanonicalCustomControlTargetInternal(rawTarget, eventContext);
  const effectiveTarget = resolvedCanonicalTargetInfo?.canonicalDiffers && resolvedCanonicalTargetInfo?.canonicalTarget
    ? resolvedCanonicalTargetInfo.canonicalTarget
    : rawTarget;
  const accessibilityProof = accessibilityEvidence || resolveAccessibilityEvidence({
    element: effectiveTarget,
    eventContext,
    canonicalTargetInfo: resolvedCanonicalTargetInfo,
  });

  const table = findTable(effectiveTarget);
  const row = findRow(effectiveTarget);
  const actionRole = accessibilityProof?.role || getRole(effectiveTarget);
  const actionName = extractActionName(effectiveTarget, accessibilityProof);
  const actionNameSource = accessibilityProof?.accessibleNameSource || (actionName ? 'text' : 'none');

  if (!table) {
    return {
      rawTargetSummary: summarizeTarget(rawTarget),
      effectiveTargetSummary: summarizeTarget(effectiveTarget),
      proofTargetSummary: summarizeTarget(effectiveTarget),
      usedCanonicalTarget: resolvedCanonicalTargetInfo?.canonicalDiffers === true,
      actionRole,
      actionName,
      actionNameSource,
      actionSelector: null,
      tableRole: null,
      tableLabelText: null,
      tableLabelSource: 'none',
      tableSummary: null,
      tableSelector: null,
      columnHeaderText: null,
      columnIndex: null,
      rowIdentityTexts: [],
      rowIdentityMode: 'none',
      rowIdentitySource: 'none',
      rowIdentityReasons: [],
      rejectedRowIdentityCandidates: [],
      rowScopedActionSelector: null,
      visibleRowCountInTable: null,
      targetRowIndexWithinTable: null,
      targetActionIndexWithinRow: null,
      matchingTableCount: null,
      matchingRowIdentityCount: null,
      matchingActionCountInRow: null,
      uniqueTableBinding: false,
      uniqueRowBinding: false,
      uniqueActionBinding: false,
      requiresPositionalDisambiguation: false,
      isValid: false,
      blockedReason: 'table-row-no-table',
    };
  }

  if (!row) {
    return {
      rawTargetSummary: summarizeTarget(rawTarget),
      effectiveTargetSummary: summarizeTarget(effectiveTarget),
      proofTargetSummary: summarizeTarget(effectiveTarget),
      usedCanonicalTarget: resolvedCanonicalTargetInfo?.canonicalDiffers === true,
      actionRole,
      actionName,
      actionNameSource,
      actionSelector: null,
      tableRole: getRole(table),
      tableLabelText: findTableLabel(table).tableLabelText,
      tableLabelSource: findTableLabel(table).tableLabelSource,
      tableSummary: buildTableSummary(table),
      tableSelector: buildSelectorForElement(table, { allowRole: true }),
      columnHeaderText: null,
      columnIndex: null,
      rowIdentityTexts: [],
      rowIdentityMode: 'none',
      rowIdentitySource: 'none',
      rowIdentityReasons: [],
      rejectedRowIdentityCandidates: [],
      rowScopedActionSelector: null,
      visibleRowCountInTable: getVisibleRows(table).length,
      targetRowIndexWithinTable: null,
      targetActionIndexWithinRow: null,
      matchingTableCount: null,
      matchingRowIdentityCount: null,
      matchingActionCountInRow: null,
      uniqueTableBinding: false,
      uniqueRowBinding: false,
      uniqueActionBinding: false,
      requiresPositionalDisambiguation: false,
      isValid: false,
      blockedReason: 'table-row-no-row',
    };
  }

  const documentRef = effectiveTarget.ownerDocument || document;
  const { tableLabelText, tableLabelSource } = findTableLabel(table);
  const tableSelector = buildSelectorForElement(table, { allowRole: true });
  const actionSelector = buildActionSelector(effectiveTarget, accessibilityProof);
  const visibleRows = getVisibleRows(table);
  // CRITICAL: Playwright's .nth(N) counts ALL matching elements including hidden ones.
  // visibleRows.indexOf(row) gives the index in the visibility-filtered subset - this does NOT
  // match .nth(N) semantics. Tables with sticky headers, collapsed row groups, or hidden
  // pagination rows will produce off-by-N errors with the visible-only index.
  // Use full DOM order (all rows, including hidden) so .nth(N) lands on the correct row.
  const allTableRows = Array.from(table.querySelectorAll(ROW_SELECTOR));
  const targetRowIndexWithinTable = allTableRows.indexOf(row);
  const targetActionIndexWithinRow = getTargetActionIndexWithinRow(row, effectiveTarget, actionSelector, actionName);
  const columnIndex = getColumnIndex(effectiveTarget, row);
  const headerTexts = getHeaderTexts(table);
  const columnHeaderText = columnIndex >= 0 && columnIndex < headerTexts.length ? headerTexts[columnIndex] : null;

  const { 
    rowIdentityTexts, 
    rowIdentityMode, 
    matchingRowIdentityCount,
    uniqueRowBinding: heuristicUniqueRowBinding,
    rowIdentitySource,
    rowIdentityReasons,
    rejectedRowIdentityCandidates,
    blockedReason: heuristicBlockedReason
  } = chooseSemanticRowIdentity(
    row,
    visibleRows,
    effectiveTarget,
    actionName,
    headerTexts,
    extractRowCellTexts
  );

  const matchingActionCountInRow = countMatchingActionsInRow(row, actionSelector, actionName, effectiveTarget);
  const matchingTableCount = countVisibleMatches(documentRef, tableSelector);
  const uniqueTableBinding = matchingTableCount === 1;
  const uniqueRowBinding = heuristicUniqueRowBinding;
  const uniqueActionBinding = matchingActionCountInRow === 1;
  const requiresPositionalDisambiguation = (
    (!uniqueTableBinding && matchingTableCount > 1 && targetRowIndexWithinTable >= 0)
    || (!uniqueRowBinding && rowIdentityTexts.length > 0 && targetRowIndexWithinTable >= 0)
    || (!uniqueActionBinding && targetActionIndexWithinRow >= 0)
  );
  
  const rowScopedActionSelector = buildRowScopedActionSelector(tableSelector, rowIdentityTexts, actionSelector, row);

  let blockedReason = heuristicBlockedReason;
  if (!tableSelector) blockedReason = 'table-row-no-table-selector';
  else if (!actionSelector && !actionName) blockedReason = 'table-row-no-action-binding';
  else if (rowIdentityTexts.length === 0 && targetRowIndexWithinTable < 0) blockedReason = 'table-row-no-row-identity';
  else if (!uniqueTableBinding && matchingTableCount > 1 && targetRowIndexWithinTable < 0) blockedReason = 'table-row-multiple-tables';
  else if (!uniqueActionBinding && targetActionIndexWithinRow < 0) blockedReason = 'table-row-ambiguous-action';

  const isValid = !!tableSelector && !!(actionSelector || actionName);

  return {
    rawTargetSummary: summarizeTarget(rawTarget),
    effectiveTargetSummary: summarizeTarget(effectiveTarget),
    proofTargetSummary: summarizeTarget(effectiveTarget),
    usedCanonicalTarget: resolvedCanonicalTargetInfo?.canonicalDiffers === true,
    actionRole,
    actionName,
    actionNameSource,
    actionSelector,
    tableRole: getRole(table),
    tableLabelText,
    tableLabelSource,
    tableSummary: buildTableSummary(table),
    tableSelector,
    columnHeaderText,
    columnIndex: columnIndex >= 0 ? columnIndex : null,
    rowIdentityTexts,
    rowIdentityMode,
    rowIdentitySource,
    rowIdentityReasons,
    rejectedRowIdentityCandidates,
    rowScopedActionSelector,
    visibleRowCountInTable: visibleRows.length,
    targetRowIndexWithinTable: targetRowIndexWithinTable >= 0 ? targetRowIndexWithinTable : null,
    targetActionIndexWithinRow: targetActionIndexWithinRow >= 0 ? targetActionIndexWithinRow : null,
    matchingTableCount,
    matchingRowIdentityCount,
    matchingActionCountInRow,
    uniqueTableBinding,
    uniqueRowBinding,
    uniqueActionBinding,
    requiresPositionalDisambiguation,
    isValid,
    blockedReason,
  };
}
