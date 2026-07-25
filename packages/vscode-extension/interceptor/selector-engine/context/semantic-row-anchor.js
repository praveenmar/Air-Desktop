export function chooseSemanticRowIdentity(targetRow, allRows, target, actionName, headerTexts, rowCellExtractor) {
  const rowTexts = rowCellExtractor(targetRow, target, actionName);

  if (rowTexts.length === 0) {
    return {
      rowIdentityTexts: [],
      rowIdentityMode: 'none',
      matchingRowIdentityCount: 0,
      uniqueRowBinding: false,
      rowIdentitySource: 'none',
      rowIdentityReasons: ['no-valid-cells-found'],
      rejectedRowIdentityCandidates: [],
      blockedReason: 'table-row-no-semantic-row-identity'
    };
  }

  const candidates = rowTexts.map((entry) => {
    const header = headerTexts[entry.index] || '';
    const scoreInfo = scoreCell(entry.text, header, entry.index);
    return {
      text: entry.text,
      ...scoreInfo
    };
  });

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  const bestCandidate = candidates[0];

  // --- Pass 1: Single-column uniqueness (original behaviour, unchanged) ---
  const singleCount = allRows.filter((row) => {
    const texts = rowCellExtractor(row, null, actionName).map((e) => e.text);
    return texts.includes(bestCandidate.text);
  }).length;

  if (singleCount === 1) {
    // Single best column uniquely identifies the row — return immediately.
    const reasons = [...bestCandidate.reasons, 'unique-within-table'];
    const rejected = candidates.slice(1).map((c) => ({
      text: c.text,
      reason: c.primaryPenalty || 'lower-score',
    }));
    return {
      rowIdentityTexts: [bestCandidate.text],
      rowIdentityMode: 'single-text',
      matchingRowIdentityCount: singleCount,
      uniqueRowBinding: true,
      rowIdentitySource: 'primary-semantic-column',
      rowIdentityReasons: reasons,
      rejectedRowIdentityCandidates: rejected,
      blockedReason: null,
    };
  }

  // --- Pass 2: F-G7 Multi-column combination disambiguation ---
  // The single best cell is not unique (e.g. two rows share the same name).
  // Try combining the top N high-scoring cells until the tuple is unique.
  // Cap at MAX_MULTI_COLUMN_TOKENS to keep the generated :has() chain readable.
  const MAX_MULTI_COLUMN_TOKENS = 3;
  const eligibleCandidates = candidates.filter((c) => !c.primaryPenalty || c.score >= 50);

  for (let tokenCount = 2; tokenCount <= Math.min(MAX_MULTI_COLUMN_TOKENS, eligibleCandidates.length); tokenCount += 1) {
    const combo = eligibleCandidates.slice(0, tokenCount);
    const comboTexts = combo.map((c) => c.text);

    const comboCount = allRows.filter((row) => {
      const rowCellTexts = rowCellExtractor(row, null, actionName).map((e) => e.text);
      // All combo texts must be present in the row (AND semantics — mirrors :has() chain).
      return comboTexts.every((t) => rowCellTexts.includes(t));
    }).length;

    if (comboCount === 1) {
      const comboReasons = combo.flatMap((c) => c.reasons);
      comboReasons.push(`multi-column-${tokenCount}-unique`);
      return {
        rowIdentityTexts: comboTexts,
        rowIdentityMode: `multi-text-${tokenCount}`,
        matchingRowIdentityCount: comboCount,
        uniqueRowBinding: true,
        rowIdentitySource: 'multi-column-disambiguation',
        rowIdentityReasons: comboReasons,
        rejectedRowIdentityCandidates: candidates.slice(tokenCount).map((c) => ({
          text: c.text,
          reason: c.primaryPenalty || 'not-needed-for-uniqueness',
        })),
        blockedReason: null,
      };
    }
  }

  // --- Pass 3: All combinations exhausted — block ---
  const rejected = candidates.slice(1).map((c) => ({
    text: c.text,
    reason: c.primaryPenalty || 'lower-score',
  }));
  return {
    rowIdentityTexts: [bestCandidate.text],
    rowIdentityMode: 'single-text',
    matchingRowIdentityCount: singleCount,
    uniqueRowBinding: false,
    rowIdentitySource: 'primary-semantic-column',
    rowIdentityReasons: [...bestCandidate.reasons, 'multi-column-exhausted'],
    rejectedRowIdentityCandidates: rejected,
    blockedReason: 'table-row-ambiguous-row-identity',
  };
}

function scoreCell(text, header, index) {
  let score = 50;
  const reasons = [];
  let primaryPenalty = null;

  const normalizedHeader = header.toLowerCase().trim();
  const normalizedText = text.trim();

  // Header signals
  if (/^(name|product|title|item|description)$/i.test(normalizedHeader)) {
    score += 40;
    reasons.push('header:name');
  } else if (/^(id|action|select|edit|status|date)$/i.test(normalizedHeader)) {
    score -= 30;
    primaryPenalty = primaryPenalty || `header:${normalizedHeader}`;
  }

  // Text shape
  if (/^\d+$/.test(normalizedText)) {
    score -= 40; 
    primaryPenalty = primaryPenalty || 'numeric-id-like';
  } else if (/^[\$€£]?\s?\d+(?:,\d{3})*(?:\.\d{2})?\s?(?:usd|eur|gbp)?$/i.test(normalizedText)) {
    score -= 40; 
    primaryPenalty = primaryPenalty || 'currency-like';
  } else if (/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(normalizedText)) {
    score -= 20; 
    primaryPenalty = primaryPenalty || 'date-like';
  } else {
    if (normalizedText.length > 2 && /[a-zA-Z]/.test(normalizedText)) {
      score += 20;
      reasons.push('human-readable-text');
      
      if (!/^\d/.test(normalizedText)) {
        reasons.push('non-numeric');
        reasons.push('non-currency');
      }
    }
  }

  if (index === 0 && !primaryPenalty) {
    score += 10;
  }

  return { score, reasons, primaryPenalty };
}
