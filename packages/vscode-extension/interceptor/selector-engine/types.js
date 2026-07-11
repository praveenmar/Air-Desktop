export const SELECTOR_ENGINE_VERSION = 'm1';
export const DEFAULT_MAX_CANDIDATES = 12;
export const MAX_VISIBLE_MATCHES_FOR_INDEX = 100;

export const DIRECT_FAMILIES = Object.freeze([
  'test-id',
  'id',
  'name',
  'href',
  'aria-label',
  'placeholder',
]);

export const SECONDARY_FAMILIES = Object.freeze([
  'class',
  'text',
  'role-attr',
  'parent-scoped-css',
  'tight-container-css',
  'xpath',
]);

export const BLOCKED_ID_PATTERNS = Object.freeze([
  // Original patterns
  /^\d/,                              // Starts with digit (invalid CSS ID, usually generated)
  /^react-/i,                         // React-generated IDs
  /[0-9a-f]{8}-[0-9a-f]{4}/i,         // UUID-like segments (e.g. 'abc12345-def6')
  /^:[a-z0-9]+:$/i,                   // React 18 concurrent-mode IDs (e.g. ':r0:')
  /\d{5,}/,                           // Long numeric suffix (5+ digits = generated)
  /^(?:css|sc)-[a-zA-Z0-9]+$/,        // CSS-in-JS (styled-components, emotion)
  /^\d+_\d+$/,                        // Numeric underscore patterns (e.g. '12_345')
  // F-S2: Additional entropy-detection patterns
  /^mui-\d+$/i,                       // MUI auto-generated IDs (e.g. 'mui-123456')
  /^(?:headlessui|radix)-[a-z]+-\d+$/i, // Headless UI / Radix auto IDs
  /\b[a-f0-9]{6,}-[a-f0-9]{4,}\b/i,      // Hashed class-ID combos (e.g. 'ab12cd-ef34')
  /^_next-[a-z0-9]+$/i,              // Next.js route segment IDs
]);

