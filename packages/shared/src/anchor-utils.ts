/**
 * Exported normalize function (Node + test usage)
 */
export function normalizeAnchor(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .replace(/\(\s*\d+\s*\)/g, "")
    .replace(/\b\d+\s*(new|items?|results?|unread)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * MUST be self-contained for page.evaluate()
 */
export function scanPageAnchors(
  root: Document | Element = document,
  locationPath: string = window.location.pathname
): string[] {
  // Local copy to avoid closure issues in browser execution
  const normalize = (text: string | null | undefined): string => {
    if (!text) return "";
    return String(text)
      .replace(/\(\s*\d+\s*\)/g, "")
      .replace(/\b\d+\s*(new|items?|results?|unread)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  const anchors: string[] = [];
  anchors.push(`URL:${locationPath}`);

  const elements = root.querySelectorAll(
    'input, button, select, textarea, form, h1, h2, h3, [role="button"]'
  );

  for (const rawEl of elements) {
    if (!(rawEl instanceof HTMLElement)) continue;

    // Visibility checks
    if (rawEl instanceof HTMLInputElement && rawEl.type === "hidden") continue;
    if (rawEl.style.display === "none") continue;

    const tag = rawEl.tagName.toUpperCase();

    try {
      if (rawEl.hasAttribute("data-testid")) {
        const v = normalize(rawEl.getAttribute("data-testid"));
        if (v.length > 1) anchors.push(`${tag}:testid=${v}`);
      } else if (rawEl.id && !/\d{5,}/.test(rawEl.id)) {
        const v = normalize(rawEl.id);
        if (v.length > 1) anchors.push(`${tag}:id=${v}`);
      } else if (rawEl.hasAttribute("name")) {
        const v = normalize(rawEl.getAttribute("name"));
        if (v.length > 1) anchors.push(`${tag}:name=${v}`);
      } else if (rawEl.hasAttribute("role")) {
        const v = normalize(rawEl.getAttribute("role"));
        if (v.length > 1) anchors.push(`${tag}:role=${v}`);
      } else if (tag === "BUTTON" || tag === "H1" || tag === "H2") {
        const text = normalize(rawEl.textContent || "");
        if (text.length > 2 && text.length < 30) {
          anchors.push(`${tag}:text=${text}`);
        }
      } else if (tag === "INPUT") {
        const inputType = normalize((rawEl as HTMLInputElement).type || "text").toLowerCase();
        if (inputType.length > 1) anchors.push(`${tag}:type=${inputType}`);
      }
    } catch (e) {
      console.warn("[AnchorCapture] Error processing element:", e);
    }
  }

  return [...new Set(anchors)].sort();
}

