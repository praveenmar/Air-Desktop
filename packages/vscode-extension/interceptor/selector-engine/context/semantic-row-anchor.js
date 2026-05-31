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
  const rejected = candidates.slice(1).map(c => ({
    text: c.text,
    reason: c.primaryPenalty || 'lower-score'
  }));

  const identityText = bestCandidate.text;
  
  // Uniqueness validation
  const count = allRows.filter(row => {
    const texts = rowCellExtractor(row, null, actionName).map(e => e.text);
    return texts.includes(identityText);
  }).length;

  const reasons = [...bestCandidate.reasons];
  let blockedReason = null;
  let uniqueRowBinding = false;

  if (count === 1) {
    uniqueRowBinding = true;
    reasons.push('unique-within-table');
  } else {
    blockedReason = 'table-row-ambiguous-row-identity';
  }

  return {
    rowIdentityTexts: [identityText],
    rowIdentityMode: 'single-text',
    matchingRowIdentityCount: count,
    uniqueRowBinding,
    rowIdentitySource: 'primary-semantic-column',
    rowIdentityReasons: reasons,
    rejectedRowIdentityCandidates: rejected,
    blockedReason
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
