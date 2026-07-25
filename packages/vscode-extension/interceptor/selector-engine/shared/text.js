import { normalizeText } from '../utils.js';

export function normalizeLabelText(value) {
  const normalized = normalizeText(value)
    .replace(/[:*]\s*$/, '')
    .trim();
  return normalized || null;
}

export function escapeTextLiteral(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

export function extractReferencedText(documentRef, idList) {
  if (!documentRef || typeof idList !== 'string') return null;
  const parts = [];
  for (const refId of idList.split(/\s+/).filter(Boolean)) {
    const ref = documentRef.getElementById?.(refId);
    const text = normalizeLabelText(ref?.textContent || '');
    if (!text) continue;
    if (!parts.includes(text)) parts.push(text);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}
