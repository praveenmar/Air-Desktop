import { getRole } from './dom-attributes.js';
import { getSafeClassTokens, normalizeText } from '../utils.js';

export function summarizeTarget(element, options = {}) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  const summary = {
    tagName: element.tagName?.toLowerCase?.() || null,
    role: getRole(element) || null,
  };
  
  if (options.includeClassList) {
    const classes = getSafeClassTokens(element).slice(0, 3);
    summary.classList = classes.length > 0 ? classes.join(' ') : null;
  }
  
  if (options.includeTextExcerpt !== false) {
    summary.textExcerpt = normalizeText(element.innerText || element.textContent || '').slice(0, 80) || null;
  }
  
  if (options.includeTabIndex) {
    const tabIndexAttr = element.getAttribute?.('tabindex');
    summary.tabIndex = tabIndexAttr !== null && tabIndexAttr !== undefined ? tabIndexAttr : null;
  }
  
  if (options.includeAriaLabels) {
    summary.ariaLabel = element.getAttribute?.('aria-label') || null;
    summary.ariaLabelledBy = element.getAttribute?.('aria-labelledby') || null;
  }
  
  return summary;
}
