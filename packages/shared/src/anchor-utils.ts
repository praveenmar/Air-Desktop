export type CompositeAnchorKind =
  | "form_cluster"
  | "container_controls"
  | "table_row"
  | "dialog_actions"
  | "menu_group";

export interface CompositeAnchor {
  kind: CompositeAnchorKind;
  scopeTag?: string | null;
  scopeRole?: string | null;
  scopeId?: string | null;
  scopeName?: string | null;
  scopeLabel?: string | null;
  tokens: string[];
  descriptor: string;
  confidence: number;
}

export interface CompositeAnchorScanResult {
  anchors: CompositeAnchor[];
  inspectedContainerCount: number;
  droppedCompositeCount: number;
  skippedCompositeReasons: string[];
  skippedCompositeCount: number;
  finalCompositeCount: number;
  formScanMs: number;
  dialogScanMs: number;
  tableScanMs: number;
  menuScanMs: number;
  containerScanMs: number;
}

interface CompositeAnchorCandidate extends CompositeAnchor {
  sortScore: number;
}

const MAX_COMPOSITE_ANCHORS_PER_PAGE = 8;
const MAX_PER_KIND = 3;
const MAX_CONTAINERS_PER_KIND = 6;
const MAX_CHILD_CONTROLS_PER_CONTAINER = 12;
const MAX_CONTAINER_NODES = 220;
const MAX_CONTAINER_DEPTH = 6;
const NON_VOLATILE_TEXT_MAX_LENGTH = 40;

const FORM_CONTROL_SELECTOR =
  'input, select, textarea, button, [role="button"], [data-testid], [name]';
const ACTION_CONTROL_SELECTOR =
  'button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"], a[href]';
const MENU_CONTROL_SELECTOR =
  '[role="menuitem"], [role="option"], option, button, [role="button"], a[href], li';

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

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

function collapseWhitespace(text: string | null | undefined): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTokenValue(text: string | null | undefined): string {
  return collapseWhitespace(text).toLowerCase();
}

function isLikelyVolatile(value: string | null | undefined): boolean {
  const normalized = collapseWhitespace(value);
  if (!normalized) return true;
  if (normalized.length > 80) return true;
  if (/\b\d{6,}\b/.test(normalized)) return true;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(normalized)) return true;
  if (/[A-Za-z0-9_-]{20,}/.test(normalized)) return true;
  return false;
}

function isStableTextCandidate(value: string | null | undefined): boolean {
  const normalized = collapseWhitespace(value);
  if (!normalized) return false;
  if (normalized.length < 2 || normalized.length > NON_VOLATILE_TEXT_MAX_LENGTH) return false;
  if (isLikelyVolatile(normalized)) return false;
  return true;
}

function tokenFromParts(prefix: string, value: string | null | undefined): string | null {
  const normalized = normalizeTokenValue(value);
  if (!normalized) return null;
  return `${prefix}:${normalized}`;
}

function safeGetAttribute(el: Element, name: string): string | null {
  try {
    return el.getAttribute(name);
  } catch {
    return null;
  }
}

function stableAttributeToken(el: Element, tagName?: string): string | null {
  const tag = (tagName || el.tagName || "node").toLowerCase();

  const testId = normalizeAnchor(
    safeGetAttribute(el, "data-testid") ||
      safeGetAttribute(el, "data-cy") ||
      safeGetAttribute(el, "data-qa"),
  );
  if (testId && !isLikelyVolatile(testId)) {
    return tokenFromParts(`${tag}.testid`, testId);
  }

  const id = normalizeAnchor((el as HTMLElement).id || "");
  if (id && !/\d{5,}/.test(id) && !isLikelyVolatile(id)) {
    return tokenFromParts(`${tag}.id`, id);
  }

  const name = normalizeAnchor(safeGetAttribute(el, "name"));
  if (name && !isLikelyVolatile(name)) {
    return tokenFromParts(`${tag}.name`, name);
  }

  const ariaLabel = normalizeAnchor(safeGetAttribute(el, "aria-label"));
  if (ariaLabel && isStableTextCandidate(ariaLabel)) {
    return tokenFromParts(`${tag}.aria`, ariaLabel);
  }

  const role = normalizeAnchor(safeGetAttribute(el, "role"));
  if (role && !isLikelyVolatile(role)) {
    return tokenFromParts(`${tag}.role`, role);
  }

  return null;
}

function stableTextToken(el: Element, prefix: string): string | null {
  const text = normalizeAnchor(el.textContent || "");
  if (!isStableTextCandidate(text)) return null;
  return tokenFromParts(prefix, text);
}

function sortAndDedupeTokens(tokens: Array<string | null | undefined>): string[] {
  return [...new Set(tokens.filter((token): token is string => typeof token === "string" && token.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function buildDescriptor(kind: CompositeAnchorKind, scopeToken: string | null, tokens: string[]): string {
  const parts: string[] = [kind];
  if (scopeToken) parts.push(`scope=${scopeToken}`);
  if (tokens.length > 0) parts.push(`tokens=${tokens.join("|")}`);
  return parts.join("|");
}

function deriveScopeIdentity(container: Element): {
  scopeTag: string | null;
  scopeRole: string | null;
  scopeId: string | null;
  scopeName: string | null;
  scopeLabel: string | null;
  scopeToken: string | null;
} {
  const scopeTag = container.tagName ? container.tagName.toLowerCase() : null;
  const scopeRole = normalizeTokenValue(safeGetAttribute(container, "role")) || null;
  const scopeId = normalizeTokenValue((container as HTMLElement).id || "") || null;
  const scopeName = normalizeTokenValue(safeGetAttribute(container, "name")) || null;

  const labelSource =
    safeGetAttribute(container, "aria-label") ||
    safeGetAttribute(container, "aria-labelledby") ||
    ((scopeTag === "dialog" || scopeRole === "dialog") ? extractHeadingText(container) : null);
  const scopeLabel = isStableTextCandidate(labelSource) ? normalizeTokenValue(labelSource) : null;

  const scopeToken =
    stableAttributeToken(container, scopeTag || "scope") ||
    (scopeLabel ? tokenFromParts(`${scopeTag || "scope"}.label`, scopeLabel) : null) ||
    (scopeRole ? tokenFromParts(`${scopeTag || "scope"}.role`, scopeRole) : null);

  return {
    scopeTag,
    scopeRole,
    scopeId,
    scopeName,
    scopeLabel,
    scopeToken,
  };
}

function countNodesWithLimit(container: Element, maxNodes = MAX_CONTAINER_NODES): number {
  let count = 0;
  const stack: Element[] = [container];
  while (stack.length > 0 && count <= maxNodes) {
    const current = stack.pop();
    if (!current) continue;
    count++;
    for (let i = current.children.length - 1; i >= 0; i--) {
      const child = current.children.item(i);
      if (child && typeof child.tagName === "string") stack.push(child);
    }
  }
  return count;
}

function collectControls(
  container: Element,
  selector: string,
  maxItems = MAX_CHILD_CONTROLS_PER_CONTAINER,
  maxDepth = MAX_CONTAINER_DEPTH,
): Element[] {
  const collected: Element[] = [];
  const seen = new Set<Element>();
  const stack: Array<{ node: Element; depth: number }> = [{ node: container, depth: 0 }];

  while (stack.length > 0 && collected.length < maxItems) {
    const current = stack.pop();
    if (!current) continue;

    if (current.depth > 0 && current.node.matches(selector) && !seen.has(current.node)) {
      collected.push(current.node);
      seen.add(current.node);
    }

    if (current.depth >= maxDepth) continue;
    for (let i = current.node.children.length - 1; i >= 0; i--) {
      const child = current.node.children.item(i);
      if (child && typeof child.tagName === "string") {
        stack.push({ node: child, depth: current.depth + 1 });
      }
    }
  }

  return collected;
}

function extractHeadingText(container: Element): string | null {
  const headings = container.querySelectorAll("h1, h2, h3, legend, [role='heading']");
  for (const heading of headings) {
    const text = normalizeAnchor(heading.textContent || "");
    if (isStableTextCandidate(text)) return text;
  }
  return null;
}

function firstStableText(elements: Iterable<Element>, prefix: string): string | null {
  for (const element of elements) {
    const token = stableTextToken(element, prefix);
    if (token) return token;
    const attrToken = stableAttributeToken(element);
    if (attrToken) return attrToken;
  }
  return null;
}

function getStableRowIdentifier(row: Element): string | null {
  const rowToken = stableAttributeToken(row, "tr");
  if (rowToken) return rowToken;

  const directCells = Array.from(row.children)
    .filter((child): child is Element => !!child && typeof child.tagName === "string")
    .filter((child) => /^(td|th)$/i.test(child.tagName));

  if (directCells.length === 0) return null;

  const firstCell = directCells[0];
  const firstCellToken =
    stableAttributeToken(firstCell, firstCell.tagName.toLowerCase()) ||
    stableTextToken(firstCell, "row");

  return firstCellToken;
}

function buildCompositeAnchor(
  kind: CompositeAnchorKind,
  container: Element,
  tokens: Array<string | null | undefined>,
  confidence: number,
): CompositeAnchorCandidate | null {
  const normalizedTokens = sortAndDedupeTokens(tokens);
  if (normalizedTokens.length === 0) return null;

  const scope = deriveScopeIdentity(container);
  const descriptor = buildDescriptor(kind, scope.scopeToken, normalizedTokens);
  const sortScore = confidence * 100 + normalizedTokens.length;

  return {
    kind,
    scopeTag: scope.scopeTag,
    scopeRole: scope.scopeRole,
    scopeId: scope.scopeId,
    scopeName: scope.scopeName,
    scopeLabel: scope.scopeLabel,
    tokens: normalizedTokens,
    descriptor,
    confidence,
    sortScore,
  };
}

function selectTopAnchors(candidates: CompositeAnchorCandidate[]): CompositeAnchorScanResult {
  const byKind = new Map<CompositeAnchorKind, CompositeAnchorCandidate[]>();
  for (const candidate of candidates) {
    const list = byKind.get(candidate.kind) || [];
    list.push(candidate);
    byKind.set(candidate.kind, list);
  }

  const keptPerKind: CompositeAnchorCandidate[] = [];
  let droppedCompositeCount = 0;

  for (const [kind, list] of byKind.entries()) {
    const sorted = [...list].sort(
      (left, right) =>
        right.sortScore - left.sortScore ||
        right.confidence - left.confidence ||
        left.descriptor.localeCompare(right.descriptor),
    );
    keptPerKind.push(...sorted.slice(0, MAX_PER_KIND));
    droppedCompositeCount += Math.max(0, sorted.length - MAX_PER_KIND);
    byKind.set(kind, sorted);
  }

  const finalAnchors = keptPerKind
    .sort(
      (left, right) =>
        right.sortScore - left.sortScore ||
        right.confidence - left.confidence ||
        left.descriptor.localeCompare(right.descriptor),
    )
    .slice(0, MAX_COMPOSITE_ANCHORS_PER_PAGE);

  droppedCompositeCount += Math.max(0, keptPerKind.length - finalAnchors.length);

  return {
    anchors: finalAnchors.map(({ sortScore: _sortScore, ...anchor }) => anchor),
    inspectedContainerCount: 0,
    droppedCompositeCount,
    skippedCompositeReasons: [],
    skippedCompositeCount: 0,
    finalCompositeCount: finalAnchors.length,
    formScanMs: 0,
    dialogScanMs: 0,
    tableScanMs: 0,
    menuScanMs: 0,
    containerScanMs: 0,
  };
}

function chooseStableControlToken(el: Element): string | null {
  return (
    stableAttributeToken(el) ||
    stableTextToken(el, `${el.tagName.toLowerCase()}.text`) ||
    (el.tagName.toLowerCase() === "input"
      ? tokenFromParts("input.type", normalizeAnchor(safeGetAttribute(el, "type") || "text"))
      : null)
  );
}

function generateFormAnchor(form: Element): CompositeAnchorCandidate | null {
  const controls = collectControls(form, FORM_CONTROL_SELECTOR);
  const fieldTokens = controls
    .map((control) => {
      const tag = control.tagName.toLowerCase();
      if (tag === "button" || safeGetAttribute(control, "role") === "button") {
        return chooseStableControlToken(control);
      }
      const nameToken =
        tokenFromParts(`${tag}.name`, normalizeAnchor(safeGetAttribute(control, "name"))) ||
        stableAttributeToken(control, tag) ||
        tokenFromParts(`${tag}.type`, normalizeAnchor(safeGetAttribute(control, "type")));
      return nameToken;
    })
    .filter((token): token is string => !!token)
    .slice(0, MAX_CHILD_CONTROLS_PER_CONTAINER);

  const formAction = normalizeAnchor(safeGetAttribute(form, "action"));
  const formActionToken =
    formAction && !isLikelyVolatile(formAction)
      ? tokenFromParts("form.action", formAction.toLowerCase())
      : null;
  const headingToken = tokenFromParts("form.label", extractHeadingText(form));

  return buildCompositeAnchor(
    "form_cluster",
    form,
    [formActionToken, headingToken, ...fieldTokens],
    0.95,
  );
}

function isTableHeaderStable(value: string | null | undefined): boolean {
  const normalized = normalizeAnchor(value);
  return normalized.length >= 2 && normalized.length <= 30 && !isLikelyVolatile(normalized);
}

function generateTableRowAnchors(table: Element): CompositeAnchorCandidate[] {
  const headerCells = Array.from(table.querySelectorAll("thead th, th[scope='col'], tr:first-child th"))
    .map((cell) => normalizeAnchor(cell.textContent || ""))
    .filter((text) => isTableHeaderStable(text))
    .slice(0, 6);
  const headerTokens = headerCells.map((header) => tokenFromParts("header", header));

  if (headerTokens.length === 0) return [];

  const rows = Array.from(table.querySelectorAll("tbody tr, tr"))
    .filter((row) => row.querySelector("td,th"))
    .slice(0, MAX_CONTAINERS_PER_KIND);

  const anchors: CompositeAnchorCandidate[] = [];
  for (const row of rows) {
    const rowControls = collectControls(row, ACTION_CONTROL_SELECTOR, 6, 3);
    if (rowControls.length === 0) continue;

    const rowIdentifier = getStableRowIdentifier(row);
    if (!rowIdentifier) continue;

    const actionTokens = rowControls
      .map((control) => chooseStableControlToken(control))
      .filter((token): token is string => !!token)
      .slice(0, 4);
    if (actionTokens.length === 0) continue;

    const anchor = buildCompositeAnchor(
      "table_row",
      row,
      [...headerTokens, rowIdentifier, ...actionTokens],
      0.96,
    );
    if (anchor) anchors.push(anchor);
  }

  return anchors;
}

function generateDialogAnchor(dialog: Element): CompositeAnchorCandidate | null {
  const titleToken =
    tokenFromParts("dialog.title", extractHeadingText(dialog)) ||
    tokenFromParts("dialog.label", normalizeAnchor(safeGetAttribute(dialog, "aria-label")));
  const actionTokens = collectControls(dialog, ACTION_CONTROL_SELECTOR, 8, 5)
    .map((control) => chooseStableControlToken(control))
    .filter((token): token is string => !!token)
    .slice(0, 6);

  return buildCompositeAnchor(
    "dialog_actions",
    dialog,
    [titleToken, ...actionTokens],
    0.93,
  );
}

function generateMenuAnchor(container: Element): CompositeAnchorCandidate | null {
  const labelToken =
    tokenFromParts("menu.label", normalizeAnchor(safeGetAttribute(container, "aria-label"))) ||
    tokenFromParts("menu.heading", extractHeadingText(container));
  const optionTokens = collectControls(container, MENU_CONTROL_SELECTOR, 10, 4)
    .map((control) => chooseStableControlToken(control))
    .filter((token): token is string => !!token)
    .slice(0, 8);

  return buildCompositeAnchor(
    "menu_group",
    container,
    [labelToken, ...optionTokens],
    0.9,
  );
}

function generateContainerAnchor(container: Element): CompositeAnchorCandidate | null {
  const controlTokens = collectControls(container, ACTION_CONTROL_SELECTOR, 8, 4)
    .map((control) => chooseStableControlToken(control))
    .filter((token): token is string => !!token)
    .slice(0, 6);
  const labelToken =
    tokenFromParts("container.label", normalizeAnchor(safeGetAttribute(container, "aria-label"))) ||
    tokenFromParts("container.heading", extractHeadingText(container));

  return buildCompositeAnchor(
    "container_controls",
    container,
    [labelToken, ...controlTokens],
    0.82,
  );
}

function scanContainers(root: Document | Element, selector: string, limit: number): Element[] {
  const found = root.querySelectorAll(selector);
  const results: Element[] = [];
  for (const element of found) {
    if (results.length >= limit) break;
    if (element && typeof element.tagName === "string") results.push(element);
  }
  return results;
}

/**
 * MUST be self-contained for page.evaluate()
 */
export function scanPageAnchors(
  root: Document | Element = (globalThis as { document?: Document }).document as Document,
  locationPath: string = typeof window !== "undefined" ? window.location.pathname : "/"
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
    if (!rawEl || typeof rawEl.tagName !== "string") continue;

    const tag = rawEl.tagName.toUpperCase();
    const styleAttr = typeof rawEl.getAttribute === "function" ? rawEl.getAttribute("style") || "" : "";

    // Visibility checks
    if (tag === "INPUT" && normalize(rawEl.getAttribute?.("type") || "").toLowerCase() === "hidden") continue;
    if (/display\s*:\s*none/i.test(styleAttr)) continue;

    try {
      if (rawEl.hasAttribute("data-testid")) {
        const v = normalize(rawEl.getAttribute("data-testid"));
        if (v.length > 1) anchors.push(`${tag}:testid=${v}`);
      } else if ((rawEl as Element & { id?: string }).id && !/\d{5,}/.test((rawEl as Element & { id?: string }).id || "")) {
        const v = normalize((rawEl as Element & { id?: string }).id || "");
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
        const inputType = normalize(rawEl.getAttribute?.("type") || "text").toLowerCase();
        if (inputType.length > 1) anchors.push(`${tag}:type=${inputType}`);
      }
    } catch (e) {
      console.warn("[AnchorCapture] Error processing element:", e);
    }
  }

  return [...new Set(anchors)].sort();
}

export function scanCompositeAnchors(
  root: Document | Element = (globalThis as { document?: Document }).document as Document,
  _locationPath: string = typeof window !== "undefined" ? window.location.pathname : "/"
): CompositeAnchor[] {
  return scanCompositeAnchorsDetailed(root, _locationPath).anchors;
}

export function scanCompositeAnchorsDetailed(
  root: Document | Element = (globalThis as { document?: Document }).document as Document,
  _locationPath: string = typeof window !== "undefined" ? window.location.pathname : "/"
): CompositeAnchorScanResult {
  const candidates: CompositeAnchorCandidate[] = [];
  const skippedCompositeReasons: string[] = [];
  let inspectedContainerCount = 0;
  let skippedCompositeCount = 0;
  let formScanMs = 0;
  let dialogScanMs = 0;
  let tableScanMs = 0;
  let menuScanMs = 0;
  let containerScanMs = 0;

  const inspectContainer = (
    kind: CompositeAnchorKind,
    container: Element,
    build: (container: Element) => CompositeAnchorCandidate | CompositeAnchorCandidate[] | null,
  ) => {
    inspectedContainerCount++;
    if (countNodesWithLimit(container, MAX_CONTAINER_NODES + 1) > MAX_CONTAINER_NODES) {
      skippedCompositeReasons.push("container_too_large");
      skippedCompositeCount += 1;
      return;
    }
    const built = build(container);
    if (!built) return;
    if (Array.isArray(built)) candidates.push(...built);
    else candidates.push(built);
  };

  let scanStartedAt = nowMs();
  const forms = scanContainers(root, "form", MAX_CONTAINERS_PER_KIND);
  for (const form of forms) inspectContainer("form_cluster", form, generateFormAnchor);
  formScanMs = nowMs() - scanStartedAt;

  scanStartedAt = nowMs();
  const dialogs = scanContainers(root, 'dialog, [role="dialog"]', MAX_CONTAINERS_PER_KIND);
  for (const dialog of dialogs) inspectContainer("dialog_actions", dialog, generateDialogAnchor);
  dialogScanMs = nowMs() - scanStartedAt;

  scanStartedAt = nowMs();
  const tables = scanContainers(root, "table", MAX_CONTAINERS_PER_KIND);
  for (const table of tables) inspectContainer("table_row", table, generateTableRowAnchors);
  tableScanMs = nowMs() - scanStartedAt;

  scanStartedAt = nowMs();
  const menus = scanContainers(
    root,
    '[role="menu"], [role="listbox"], [role="list"], nav, [role="group"]',
    MAX_CONTAINERS_PER_KIND,
  );
  for (const menu of menus) inspectContainer("menu_group", menu, generateMenuAnchor);
  menuScanMs = nowMs() - scanStartedAt;

  scanStartedAt = nowMs();
  const containers = scanContainers(
    root,
    'section, [role="region"], [role="group"], [role="toolbar"], [role="navigation"], main, aside',
    MAX_CONTAINERS_PER_KIND,
  );
  for (const container of containers) inspectContainer("container_controls", container, generateContainerAnchor);
  containerScanMs = nowMs() - scanStartedAt;

  const selected = selectTopAnchors(
    candidates.filter(
      (candidate, index, arr) =>
        arr.findIndex((other) => other.descriptor === candidate.descriptor) === index,
    ),
  );
  selected.inspectedContainerCount = inspectedContainerCount;
  selected.skippedCompositeReasons = [...new Set(skippedCompositeReasons)].sort();
  selected.skippedCompositeCount = skippedCompositeCount;
  selected.finalCompositeCount = selected.anchors.length;
  selected.formScanMs = formScanMs;
  selected.dialogScanMs = dialogScanMs;
  selected.tableScanMs = tableScanMs;
  selected.menuScanMs = menuScanMs;
  selected.containerScanMs = containerScanMs;
  return selected;
}
