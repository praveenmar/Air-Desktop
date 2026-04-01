import * as crypto from 'crypto';

/**
 * Computes a normalized SHA-256 hash of a Playwright action string.
 * Survives formatting changes and SDET-added comments.
 */
export function computeActionChecksum(actionCode: string): string {
  const normalized = actionCode
    // Strip inline and multi-line comments before hashing
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
    // Remove all whitespace, tabs, and newlines
    .replace(/\s+/g, '')
    // Normalize all double quotes and backticks to single quotes
    .replace(/["`]/g, "'");
  
  return crypto.createHash('sha256').update(normalized).digest('hex');
}