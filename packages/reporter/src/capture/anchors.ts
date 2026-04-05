/**
 * Shared anchor normalisation - part of the public contract for D4/D5/MCP.
 * Keep this in sync with the inline normalize inside scanPageAnchors().
 */
export function normalizeAnchor(text: unknown): string {
  if (!text) return '';
  return String(text)
    .replace(/\(\s*\d+\s*\)/g, '')
    .replace(/\b\d+\s*(new|items?|results?|unread)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scanPageAnchors(
  rootOrPath: Document | Element | string = document,
  locationPath?: string
): string[] {
  try {
    const root = typeof rootOrPath === 'string' ? document : rootOrPath;
    const resolvedPath =
      typeof rootOrPath === 'string'
        ? rootOrPath
        : (locationPath ?? window.location.pathname);

    console.debug('[AnchorCapture] Starting scan on URL:', window.location.href);

    // IMPORTANT: Keep this logic identical to the exported normalizeAnchor()
    // to prevent drift. See Jira ticket ANCHOR-123 for eventual unification.
    const normalize = (text: unknown): string => {
      if (!text) return '';
      return String(text)
        .replace(/\(\s*\d+\s*\)/g, '')
        .replace(/\b\d+\s*(new|items?|results?|unread)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const anchors: string[] = [];
    anchors.push(`URL:${resolvedPath}`);

    const elements = root.querySelectorAll(
      'input, button, select, textarea, form, h1, h2, h3, [role="button"]'
    );

    for (const rawEl of elements) {
      try {
        const el = rawEl as HTMLElement & { type?: string; name?: string };
        const style = el.style as CSSStyleDeclaration | undefined;
        if (el.type === 'hidden' || style?.display === 'none') continue;
        const tag = el.tagName.toUpperCase();

        if (el.getAttribute('data-testid')) {
          const testId = normalize(el.getAttribute('data-testid'));
          if (testId.length > 1) anchors.push(`${tag}:testid=${testId}`);
        } else if (el.id && !/\d{5,}/.test(el.id)) {
          const id = normalize(el.id);
          if (id.length > 1) anchors.push(`${tag}:id=${id}`);
        } else if (el.name) {
          const name = normalize(el.name);
          if (name.length > 1) anchors.push(`${tag}:name=${name}`);
        } else if (el.getAttribute('role')) {
          const role = normalize(el.getAttribute('role'));
          if (role.length > 1) anchors.push(`${tag}:role=${role}`);
        } else if (tag === 'BUTTON' || tag === 'H1' || tag === 'H2') {
          const text = normalize(el.textContent || '');
          if (text.length > 2 && text.length < 30) {
            anchors.push(`${tag}:text=${text}`);
          }
        } else if (tag === 'INPUT') {
          const inputType = normalize((el as HTMLInputElement).type || 'text').toLowerCase();
          if (inputType.length > 1) anchors.push(`${tag}:type=${inputType}`);
        }
      } catch (elementError) {
        console.warn(
          '[AnchorCapture] Error processing element:',
          elementError instanceof Error ? elementError.message : String(elementError)
        );
        continue;
      }
    }

    const result = [...new Set(anchors)].sort();
    console.debug(`[AnchorCapture] Captured ${result.length} anchors`);
    return result;
  } catch (fatalError) {
    console.error(
      '[AnchorCapture] Fatal error:',
      fatalError instanceof Error ? fatalError.message : String(fatalError)
    );
    return [];
  }
}
