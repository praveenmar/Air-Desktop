import {
  extractText,
  generateOptimalSelector,
} from "../../../shared/src/selectors.ts";

export interface CandidateElement {
  tag: string;
  role: string | null;
  type: string | null;
  id: string | null;
  name: string | null;
  testId: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  href: string | null;
  text: string | null;
  selector: string;
  selectorPriority: string;
  selectorRank: number;
}

const INTERACTIVE_QUERY = [
  "input",
  "button",
  "select",
  "textarea",
  "a[href]",
  "form",
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
].join(", ");

function shouldSkipElement(el: HTMLElement): boolean {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  if ((el as HTMLInputElement).type === "hidden") return true;

  const style = el.style;
  if (style?.display === "none") return true;
  if (style?.visibility === "hidden") return true;

  return false;
}

function toCandidate(el: HTMLElement): CandidateElement {
  const selector = generateOptimalSelector(el);
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role"),
    type: (el as HTMLInputElement).type || null,
    id: el.id || null,
    name: (el as HTMLInputElement).name || null,
    testId: el.getAttribute("data-testid"),
    ariaLabel: el.getAttribute("aria-label"),
    placeholder: (el as HTMLInputElement).placeholder || null,
    href: (el as HTMLAnchorElement).href || null,
    text: extractText(el, 80),
    selector: selector.selector,
    selectorPriority: selector.priority,
    selectorRank: selector.rank,
  };
}

export function extractInteractiveElements(
  root: Document | Element = document,
  maxCandidates = 50
): CandidateElement[] {
  try {
    const out: CandidateElement[] = [];
    const seen = new Set<string>();
    const elements = root.querySelectorAll(INTERACTIVE_QUERY);

    for (const node of elements) {
      const el = node as HTMLElement;
      if (shouldSkipElement(el)) continue;

      const candidate = toCandidate(el);
      const dedupeKey = `${candidate.selector}|${candidate.tag}`;
      if (seen.has(dedupeKey)) continue;

      seen.add(dedupeKey);
      out.push(candidate);
      if (out.length >= maxCandidates) break;
    }

    return out;
  } catch (error) {
    console.warn(
      "[CandidateCapture] Failed to extract interactive candidates:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}
