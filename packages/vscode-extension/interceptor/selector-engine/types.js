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
  /^\d/,
  /^react-/i,
  /[0-9a-f]{8}-[0-9a-f]{4}/i,
  /^:[a-z0-9]+:$/i,
  /\d{5,}/,
  /^(?:css|sc)-[a-zA-Z0-9]+$/,
  /^\d+_\d+$/
]);

