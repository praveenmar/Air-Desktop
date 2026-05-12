import * as fs from 'fs';
import * as path from 'path';
import { parseHTML } from 'linkedom';
import type { AirMethodMeta } from '../sidecar.types';

export interface LiveRepairEvidence {
  capturedAt?: string;
  methodName?: string;
  errorMessage?: string | null;
  currentUrl?: string | null;
  pageTitle?: string | null;
  html?: string | null;
  methodMeta?: Partial<AirMethodMeta> & {
    fieldLabelText?: string | null;
    triggerFieldLabelText?: string | null;
  };
}

export interface RepairSuggestion {
  kind: 'input-label-context' | 'custom-control-trigger-context';
  status: 'repairable' | 'blocked';
  oldSelector: string | null;
  newLocator: string | null;
  proof: string;
  confidence: number;
  reason: string;
  warningCodes: string[];
}

export interface SmokeRepairSuggestionFile {
  version: 1;
  methodName?: string;
  step?: number | null;
  currentUrl?: string | null;
  screenshotPath?: string | null;
  sourceEvidenceFile?: string | null;
  suggestions: RepairSuggestion[];
}

function normalizeText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function cleanComment(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isVisibleElement(el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    const htmlEl = current as HTMLElement;
    const tagName = (htmlEl.tagName || '').toLowerCase();
    if (htmlEl.hasAttribute('hidden')) return false;
    if ((htmlEl.getAttribute('aria-hidden') || '').toLowerCase() === 'true') return false;
    if (tagName === 'input' && (htmlEl.getAttribute('type') || '').toLowerCase() === 'hidden') return false;
    const style = (htmlEl.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '');
    if (style.includes('display:none')) return false;
    if (style.includes('visibility:hidden')) return false;
    current = htmlEl.parentElement;
  }
  return true;
}

function getVisibleInputLikeControls(root: ParentNode): Element[] {
  try {
    return Array.from(
      root.querySelectorAll(
        'input,textarea,select,[role="textbox"],[role="combobox"],[role="searchbox"],[role="spinbutton"],[contenteditable="true"],[aria-haspopup="listbox"],[aria-haspopup="combobox"]',
      ),
    ).filter(isVisibleElement);
  } catch {
    return [];
  }
}

function getVisibleTriggerLikeControls(root: ParentNode): Element[] {
  try {
    return Array.from(
      root.querySelectorAll(
        'select,[role="combobox"],[role="button"][aria-haspopup],[aria-haspopup="listbox"],[aria-haspopup="combobox"],[contenteditable="true"]',
      ),
    ).filter(isVisibleElement);
  } catch {
    return [];
  }
}

function isStateClassToken(token: string): boolean {
  const normalized = token.toLowerCase();
  return /(^|[-_:])(active|focus|focused|selected|open|disabled|hover|loading|expanded|collapsed|current|checked|invalid|valid|dirty|touched|visited|state)([-_:]|$)/.test(normalized)
    || normalized.startsWith('is-')
    || normalized.startsWith('has-')
    || normalized.includes('--active')
    || normalized.includes('--focus')
    || normalized.includes('--selected')
    || normalized.includes('--open');
}

function isLikelyStableClassToken(token: string): boolean {
  const normalized = token.trim();
  if (!normalized) return false;
  if (isStateClassToken(normalized)) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (/^(mt|mb|ml|mr|mx|my|pt|pb|pl|pr|px|py|w|h|min|max|gap|grid|flex|items|justify|text|bg|border|rounded|shadow|col|row)-/i.test(normalized)) {
    return false;
  }
  if (/^[a-z]{1,2}\d+$/i.test(normalized)) return false;
  return /[a-z]/i.test(normalized);
}

function deriveCleanContainerSelector(container: Element): string | null {
  const dataTestId = container.getAttribute('data-testid');
  if (dataTestId) return `[data-testid="${dataTestId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  const dataCy = container.getAttribute('data-cy');
  if (dataCy) return `[data-cy="${dataCy.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  const dataQa = container.getAttribute('data-qa');
  if (dataQa) return `[data-qa="${dataQa.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  const id = container.getAttribute('id');
  if (id) return `[id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  const classAttr = container.getAttribute('class') || '';
  const stableToken = classAttr.split(/\s+/).find(isLikelyStableClassToken);
  return stableToken ? `.${stableToken}` : null;
}

function findExactLabels(document: Document, labelText: string): Element[] {
  const normalized = normalizeText(labelText);
  try {
    return Array.from(document.querySelectorAll('label')).filter(label =>
      normalizeText(label.textContent || '') === normalized && isVisibleElement(label),
    );
  } catch {
    return [];
  }
}

function findTightContainer(
  label: Element,
  targetKind: 'input' | 'trigger',
): { container: Element | null; control: Element | null; blockedReason: string | null } {
  let current: Element | null = label;
  let depth = 0;
  while (current && depth < 5) {
    const tagName = (current.tagName || '').toLowerCase();
    if (['body', 'html', 'main', 'section', 'article', 'table', 'tbody', 'thead', 'form'].includes(tagName)) {
      break;
    }
    const controls = targetKind === 'input'
      ? getVisibleInputLikeControls(current)
      : getVisibleTriggerLikeControls(current);
    if (controls.length === 1) {
      return { container: current, control: controls[0] ?? null, blockedReason: null };
    }
    if (controls.length > 1) {
      return { container: null, control: null, blockedReason: 'multiple_input_like_targets' };
    }
    current = current.parentElement;
    depth += 1;
  }
  return { container: null, control: null, blockedReason: 'no_bounded_label_container' };
}

function deriveTriggerChildSelector(control: Element, originalSelector: string | null | undefined): string | null {
  const role = (control.getAttribute('role') || '').toLowerCase();
  const hasPopup = (control.getAttribute('aria-haspopup') || '').toLowerCase();
  if (role === 'combobox') return '[role="combobox"]';
  if (role === 'button' && hasPopup) return `[role="button"][aria-haspopup="${hasPopup.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  if (hasPopup === 'listbox' || hasPopup === 'combobox') return `[aria-haspopup="${hasPopup.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  if (originalSelector && originalSelector.trim().startsWith('.')) return originalSelector.trim();
  const classAttr = control.getAttribute('class') || '';
  const stableToken = classAttr.split(/\s+/).find(isLikelyStableClassToken);
  return stableToken ? `.${stableToken}` : null;
}

function analyzeWeakInputRepair(evidence: LiveRepairEvidence): RepairSuggestion[] {
  const meta = evidence.methodMeta ?? {};
  const fieldLabelText = meta.fieldLabelText;
  if (!fieldLabelText || !evidence.html) return [];
  const { document } = parseHTML(evidence.html);
  const labels = findExactLabels(document as unknown as Document, fieldLabelText);
  if (labels.length !== 1) {
    return [{
      kind: 'input-label-context',
      status: 'blocked',
      oldSelector: meta.originalSelector ?? meta.selectorUsed ?? null,
      newLocator: null,
      proof: 'live-dom-label-scan',
      confidence: 0,
      reason: labels.length > 1 ? 'duplicate_label_text' : 'label_missing',
      warningCodes: ['label-context-proof-only'],
    }];
  }
  const bounded = findTightContainer(labels[0], 'input');
  if (!bounded.container || !bounded.control) {
    return [{
      kind: 'input-label-context',
      status: 'blocked',
      oldSelector: meta.originalSelector ?? meta.selectorUsed ?? null,
      newLocator: null,
      proof: 'live-dom-bounded-container',
      confidence: 0,
      reason: bounded.blockedReason ?? 'no_bounded_label_container',
      warningCodes: ['label-context-proof-only'],
    }];
  }
  const cleanParentSelector = deriveCleanContainerSelector(bounded.container);
  if (!cleanParentSelector) {
    return [{
      kind: 'input-label-context',
      status: 'blocked',
      oldSelector: meta.originalSelector ?? meta.selectorUsed ?? null,
      newLocator: null,
      proof: 'live-dom-bounded-container',
      confidence: 0.4,
      reason: 'no_clean_parent_selector',
      warningCodes: ['label-context-no-clean-parent'],
    }];
  }
  const targetTag = ((bounded.control.tagName || 'input').toLowerCase() || 'input');
  return [{
    kind: 'input-label-context',
    status: 'repairable',
    oldSelector: meta.originalSelector ?? meta.selectorUsed ?? null,
    newLocator: `page.locator(${JSON.stringify(cleanParentSelector)}).locator(${JSON.stringify(targetTag)})`,
    proof: 'exact label + one visible input in bounded container (live DOM)',
    confidence: 0.93,
    reason: cleanComment(fieldLabelText),
    warningCodes: ['label-context-structural-fallback'],
  }];
}

function analyzeCustomTriggerRepair(evidence: LiveRepairEvidence): RepairSuggestion[] {
  const meta = evidence.methodMeta ?? {};
  const labelText = meta.triggerFieldLabelText;
  if (!labelText || !evidence.html) return [];
  const { document } = parseHTML(evidence.html);
  const labels = findExactLabels(document as unknown as Document, labelText);
  if (labels.length !== 1) {
    return [{
      kind: 'custom-control-trigger-context',
      status: 'blocked',
      oldSelector: meta.triggerOriginalSelector ?? null,
      newLocator: null,
      proof: 'live-dom-trigger-label-scan',
      confidence: 0,
      reason: labels.length > 1 ? 'duplicate_label_text' : 'label_missing',
      warningCodes: ['custom-control-trigger-target-binding-ambiguous'],
    }];
  }
  const bounded = findTightContainer(labels[0], 'trigger');
  if (!bounded.container || !bounded.control) {
    return [{
      kind: 'custom-control-trigger-context',
      status: 'blocked',
      oldSelector: meta.triggerOriginalSelector ?? null,
      newLocator: null,
      proof: 'live-dom-trigger-bounded-container',
      confidence: 0,
      reason: bounded.blockedReason ?? 'no_bounded_label_container',
      warningCodes: ['custom-control-trigger-target-binding-ambiguous'],
    }];
  }
  const cleanParentSelector = deriveCleanContainerSelector(bounded.container);
  const childSelector = deriveTriggerChildSelector(bounded.control, meta.triggerOriginalSelector);
  if (!cleanParentSelector || !childSelector) {
    return [{
      kind: 'custom-control-trigger-context',
      status: 'blocked',
      oldSelector: meta.triggerOriginalSelector ?? null,
      newLocator: null,
      proof: 'live-dom-trigger-bounded-container',
      confidence: 0.45,
      reason: !cleanParentSelector ? 'no_clean_parent_selector' : 'proof_only_no_clean_render',
      warningCodes: ['custom-control-trigger-structural-fallback'],
    }];
  }
  return [{
    kind: 'custom-control-trigger-context',
    status: 'repairable',
    oldSelector: meta.triggerOriginalSelector ?? null,
    newLocator: `page.locator(${JSON.stringify(cleanParentSelector)}).locator(${JSON.stringify(childSelector)})`,
    proof: 'exact label + one visible trigger in bounded container (live DOM)',
    confidence: 0.92,
    reason: cleanComment(labelText),
    warningCodes: ['custom-control-trigger-structural-fallback'],
  }];
}

export function analyzeSmokeRepairEvidence(evidence: LiveRepairEvidence): SmokeRepairSuggestionFile {
  const meta = evidence.methodMeta ?? {};
  const suggestions: RepairSuggestion[] = [];
  if (meta.actionType === 'input') {
    suggestions.push(...analyzeWeakInputRepair(evidence));
  }
  if (meta.actionType === 'custom-select' || meta.actionType === 'custom-control-open') {
    suggestions.push(...analyzeCustomTriggerRepair(evidence));
  }
  return {
    version: 1,
    methodName: evidence.methodName,
    step: meta.step ?? null,
    currentUrl: evidence.currentUrl ?? null,
    sourceEvidenceFile: null,
    screenshotPath: null,
    suggestions,
  };
}

export function readLiveRepairEvidence(filePath: string | null | undefined): LiveRepairEvidence | null {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, 'utf8')) as LiveRepairEvidence;
}

export function writeSmokeRepairSuggestion(
  params: {
    evidenceFile?: string | null;
    screenshotPath?: string | null;
    outputFile: string;
  },
): SmokeRepairSuggestionFile | null {
  const evidence = readLiveRepairEvidence(params.evidenceFile);
  if (!evidence) return null;
  const suggestion = analyzeSmokeRepairEvidence(evidence);
  suggestion.sourceEvidenceFile = params.evidenceFile ? path.resolve(params.evidenceFile) : null;
  suggestion.screenshotPath = params.screenshotPath ? path.resolve(params.screenshotPath) : null;
  fs.mkdirSync(path.dirname(params.outputFile), { recursive: true });
  fs.writeFileSync(params.outputFile, `${JSON.stringify(suggestion, null, 2)}\n`, 'utf8');
  return suggestion;
}
