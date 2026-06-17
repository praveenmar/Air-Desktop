// Phase 2 bridge:
// Keep this TS adapter in place; implementation lives in packages/shared.

export type { SelectorResult } from '../../../shared/src/selectors';
export {
  SELECTOR_RANK_MAP,
  escapeCssString,
  rankForPriority,
  findStableClass,
  generateXPath,
  extractText,
  generateOptimalSelector,
} from '../../../shared/src/selectors';
