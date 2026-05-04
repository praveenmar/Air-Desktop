import { describe, expect, it, vi } from 'vitest';
import {
  generateCandidates,
  resolveSelectorsForSession,
  scoreCandidate,
  validateCSSCandidate,
  validateTextCandidate,
  SnapshotCache,
} from '../src/selector-resolver';
import { getSourceNodeId } from '../src/codegen.service';
import { CodegenSession, CodegenStep } from '../src/types';
import type { SnapshotSelectionResult } from '../src/snapshot-selector';
import { inferStepSignalAttributes } from '../src/resolver/text-matching';

type TestElement = {
  id?: string;
  tagName?: string;
  textContent?: string;
  style?: string;
  className?: string;
  parentElement?: TestElement | null;
  children?: TestElement[];
  attrs: Record<string, string>;
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
  querySelectorAll?: (selector: string) => Array<Element>;
};

type TestDocument = Document & {
  querySelectorAll: (selector: string) => Array<Element>;
  querySelector: (selector: string) => Element | null;
};

function makeElement(
  attrs: Record<string, string> = {},
  options: {
    text?: string;
    style?: string;
    id?: string;
    className?: string;
    parent?: TestElement | null;
    tagName?: string;
    children?: TestElement[];
  } = {}
): Element {
  const element: TestElement = {
    id: options.id ?? attrs.id,
    tagName: options.tagName || 'DIV',
    textContent: options.text || '',
    style: options.style || '',
    className: options.className ?? attrs.class ?? '',
    parentElement: options.parent || null,
    children: options.children || [],
    attrs: { ...attrs, ...(options.style ? { style: options.style } : {}) },
    hasAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name);
    },
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    },
    querySelectorAll() {
      return [];
    },
  };

  return element as unknown as Element;
}

function makeDocument(
  selectorMap: Record<string, Element[]>,
  html = '<html><body></body></html>'
): Document {
  const document = {
    querySelectorAll(selector: string) {
      if (!Object.prototype.hasOwnProperty.call(selectorMap, selector)) {
        throw new Error(`Unknown selector in test doc: ${selector}`);
      }
      return selectorMap[selector];
    },
    querySelector(selector: string) {
      return selectorMap[selector]?.[0] ?? null;
    },
    documentElement: { outerHTML: html },
    body: { outerHTML: html },
  };

  return document as unknown as TestDocument;
}

function makeSnapshotCache(
  entries: Record<string, Document | null>,
  snapshotEngineAvailable = true
): SnapshotCache {
  const compoundKey = (normalizedUrl?: string, controlSignature?: string): string | null => {
    if (!normalizedUrl) return null;
    return `${normalizedUrl}|${controlSignature ?? ''}`;
  };

  return {
    snapshotEngineAvailable,
    get(nodeId: string, normalizedUrl?: string, controlSignature?: string): Document | null {
      const key = compoundKey(normalizedUrl, controlSignature);
      if (key && Object.prototype.hasOwnProperty.call(entries, key)) {
        return entries[key] ?? null;
      }
      return entries[nodeId] ?? null;
    },
  };
}

function makeSnapshotCacheWithSelection(
  entries: Record<string, Document | null>,
  selectionFactory: (step: CodegenStep, mode?: 'action' | 'outcome') => SnapshotSelectionResult,
  snapshotEngineAvailable = true,
): SnapshotCache {
  return {
    ...makeSnapshotCache(entries, snapshotEngineAvailable),
    selectForStep: selectionFactory,
  };
}

function makeStep(step: number, overrides: Partial<CodegenStep> = {}): CodegenStep {
  return {
    step,
    intent: `click_step_${step}`,
    action: 'click',
    selector: 'button',
    selectorPriority: 'unknown',
    selectorRank: 10,
    sourceNodeId: `node-${step}`,
    assertions: [],
    userAssertions: [],
    confidence: 1,
    sampleSize: 1,
    pageUrl: 'http://example.com/page',
    ...overrides,
  };
}

function makeSession(steps: CodegenStep[]): CodegenSession {
  return {
    sessionId: 'session-1',
    url: 'http://example.com',
    title: 'Example',
    recordedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    stepCount: steps.length,
    steps,
    flowConfidence: 1,
    nodeCount: steps.length,
  };
}

function scoreResolvedCandidate(
  step: CodegenStep,
  snapshot: Document,
  selector: string,
): { score: number; reason: string | undefined } {
  const candidate = generateCandidates(step, snapshot).find(entry => entry.selector === selector);
  if (!candidate) {
    throw new Error(`Missing candidate for selector: ${selector}`);
  }
  const validation = selector.startsWith('text=')
    ? validateTextCandidate(selector, snapshot, step)
    : validateCSSCandidate(selector, snapshot, step);
  return {
    score: scoreCandidate(candidate, validation, step, snapshot),
    reason: undefined,
  };
}

function scoreExplicitCandidate(
  step: CodegenStep,
  snapshot: Document,
  selector: string,
  source: 'class' | 'path' | 'text' | 'parent-scope' | 'id' | 'name' | 'testid' | 'aria' | 'placeholder' | 'role+name' | 'original',
  rank: number,
): number {
  const validation = selector.startsWith('text=')
    ? validateTextCandidate(selector, snapshot, step)
    : validateCSSCandidate(selector, snapshot, step);
  const effectiveSource = (source === 'path' ? 'original' : source);
  return scoreCandidate({ selector, source: effectiveSource, rank }, validation, step, snapshot);
}

describe('selector-resolver', () => {
  it('prefers preserved fingerprint href over selector-string inference', () => {
    const step = makeStep(1, {
      selector: 'a[href="/wrong"]',
      fingerprint: {
        selector: 'a[href="/wrong"]',
        attributes: {
          href: '/admin/viewAdminModule',
        },
      },
    });

    const attrs = inferStepSignalAttributes(step);
    expect(attrs.href).toBe('/admin/viewAdminModule');
  });

  it('prefers preserved placeholder and exposes data-cy/data-qa signal attributes', () => {
    const step = makeStep(1, {
      selector: 'input[placeholder="Wrong"][data-cy="fallback-cy"][data-qa="fallback-qa"]',
      action: 'input',
      fingerprint: {
        selector: 'input[placeholder="Wrong"][data-cy="fallback-cy"][data-qa="fallback-qa"]',
        attributes: {
          placeholder: 'Search',
          dataCy: 'employee-search',
          'data-qa': 'employee-search',
        },
      },
    });

    const attrs = inferStepSignalAttributes(step);
    expect(attrs.placeholder).toBe('Search');
    expect(attrs.dataCy).toBe('employee-search');
    expect(attrs.dataQa).toBe('employee-search');
  });

  it('falls back to selector-string inference when recorded fingerprint field is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const step = makeStep(1, {
      selector: 'input[name="username"][placeholder="Username"]',
      action: 'input',
      fingerprint: {
        selector: 'input[name="username"][placeholder="Username"]',
        attributes: {},
      },
    });

    const attrs = inferStepSignalAttributes(step);
    expect(attrs.name).toBe('username');
    expect(attrs.placeholder).toBe('Username');
    expect(warnSpy).toHaveBeenCalledWith(
      'FINGERPRINT_ATTRIBUTE_INFERRED_DOWNSTREAM',
      expect.objectContaining({ attribute: 'name' }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'FINGERPRINT_ATTRIBUTE_INFERRED_DOWNSTREAM',
      expect.objectContaining({ attribute: 'placeholder' }),
    );
  });

  it('rejects unique href-mismatched deterministic candidate', async () => {
    const adminWrong = makeElement(
      { class: 'menu-item', href: '/web/index.php/pim/viewPimModule' },
      { text: 'Admin', tagName: 'A' },
    );
    const otherLinks = Array.from({ length: 59 }, (_, idx) =>
      makeElement(
        { class: 'menu-item', href: `/web/index.php/module/${idx}` },
        { text: `Item ${idx}`, tagName: 'A' },
      ),
    );
    const menuItems = [adminWrong, ...otherLinks];
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-item': menuItems,
        'text=admin': [adminWrong],
        'a:has-text("Admin")': [adminWrong],
        '*': menuItems,
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('.menu-item');
    expect(resolution.resolverMetadata.resolvedBy).toBe('blocked-semantic-mismatch');
    expect(resolution.resolverMetadata.rejectReason).toBe('href_mismatch');
    expect(resolution.resolverMetadata.semanticRejectReason).toBe('href_mismatch');
    expect(resolution.resolverMetadata.rejectedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selector: 'text=admin', reason: 'href_mismatch' }),
      ]),
    );
  });

  it('does not resolve select-like "-- Select --" interaction to search input', async () => {
    const searchInput = makeElement(
      { placeholder: 'Search', type: 'search' },
      { tagName: 'INPUT' },
    );
    const unrelated = makeElement({}, { text: 'Other', tagName: 'DIV' });
    const step = makeStep(1, {
      selector: 'div > div:nth-of-type(1)',
      selectorPriority: 'path',
      selectorRank: 10,
      intent: 'click_Select',
      action: 'click',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: 'div > div:nth-of-type(1)',
        selectorPriority: 'path',
        selectorRank: 10,
        tagName: 'div',
        textExcerpt: '-- Select --',
        attributes: {},
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        'div > div:nth-of-type(1)': [],
        '[placeholder="Search"]': [searchInput],
        'input[placeholder="Search"]': [searchInput],
        '*': [searchInput, unrelated],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('div > div:nth-of-type(1)');
    expect(resolution.resolverMetadata.resolvedBy).toBe('blocked-semantic-mismatch');
    expect(resolution.resolverMetadata.rejectReason).toBe('control_family_mismatch');
    expect(resolution.resolverMetadata.semanticRejectReason).toBe('control_family_mismatch');
  });

  it('rejects unique candidate with wrong menu role/control family', async () => {
    const logoutButton = makeElement(
      { role: 'button' },
      { text: 'Logout', tagName: 'BUTTON' },
    );
    const otherButtons = Array.from({ length: 59 }, (_, idx) =>
      makeElement(
        { role: 'button' },
        { text: `Action ${idx}`, tagName: 'BUTTON' },
      ),
    );
    const menuEntries = [logoutButton, ...otherButtons];
    const step = makeStep(1, {
      selector: '.menu-entry',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Logout',
      action: 'click',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-entry',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'li',
        textExcerpt: 'Logout',
        attributes: {
          role: 'menuitem',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-entry': menuEntries,
        'text=logout': [logoutButton],
        'button:has-text("Logout")': [logoutButton],
        '*': menuEntries,
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('.menu-entry');
    expect(resolution.resolverMetadata.resolvedBy).toBe('blocked-semantic-mismatch');
    expect(resolution.resolverMetadata.rejectReason).toBe('control_family_mismatch');
    expect(resolution.resolverMetadata.semanticRejectReason).toBe('control_family_mismatch');
  });

  it('still resolves good Admin navigation candidate when text and href align', async () => {
    const admin = makeElement(
      { class: 'menu-item', href: '/web/index.php/admin/viewAdminModule' },
      { text: 'Admin', tagName: 'A' },
    );
    const pim = makeElement(
      { class: 'menu-item', href: '/web/index.php/pim/viewPimModule' },
      { text: 'PIM', tagName: 'A' },
    );
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-item': [admin, pim],
        'text=admin': [admin],
        'a:has-text("Admin")': [admin],
        '*': [admin, pim],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toMatch(/admin/i);
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.rejectReason).toBeNull();
    expect(resolution.resolverMetadata.semanticCompatibilityScore).toBeGreaterThan(0);
  });

  it('allows deterministic override when event-local snapshot reports target evidence present', async () => {
    const admin = makeElement(
      { class: 'menu-item', href: '/web/index.php/admin/viewAdminModule' },
      { text: 'Admin', tagName: 'A' },
    );
    const pim = makeElement(
      { class: 'menu-item', href: '/web/index.php/pim/viewPimModule' },
      { text: 'PIM', tagName: 'A' },
    );
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      sourceNodeId: 'node-1',
      eventId: 'ev-1',
      fingerprint: {
        selector: '.menu-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const snapshot = makeDocument({
      '.menu-item': [admin, pim],
      'text=admin': [admin],
      'a:has-text("Admin")': [admin],
      '*': [admin, pim],
    });

    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'event-local-pageState',
          temporalClass: 'action_local',
          reason: 'selected_event_local_pageState_by_eventId',
          eventId: 'ev-1',
          confidenceScore: 1,
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
        },
        evaluatedCandidates: [
          {
            source: 'event-local-pageState',
            temporalClass: 'action_local',
            selected: true,
            reason: 'selected_event_local_pageState_by_eventId',
            eventId: 'ev-1',
            confidenceScore: 1,
            targetPresent: true,
            snapshotTargetEvidenceReason: 'selector_match',
          },
        ],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toMatch(/admin/i);
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('uses explicit label text as semantic compatibility evidence for field candidates', async () => {
    const labelUser = makeElement({ for: 'username' }, { text: 'Username', tagName: 'LABEL' });
    const labelPassword = makeElement({ for: 'password' }, { text: 'Password', tagName: 'LABEL' });
    const usernameInput = makeElement(
      { id: 'username', name: 'username', class: 'field-input' },
      { tagName: 'INPUT', id: 'username' },
    );
    const passwordInput = makeElement(
      { id: 'password', name: 'password', class: 'field-input' },
      { tagName: 'INPUT', id: 'password' },
    );

    const step = makeStep(1, {
      selector: '.field-input',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_username',
      action: 'input',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.field-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        textExcerpt: 'Username',
        attributes: {},
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.field-input': [usernameInput, passwordInput],
        '#username': [usernameInput],
        '[id="username"]': [usernameInput],
        'input[name="username"]': [usernameInput],
        '*': [labelUser, labelPassword, usernameInput, passwordInput],
        label: [labelUser, labelPassword],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toMatch(/username/i);
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.semanticCompatibilityReasons).toEqual(
      expect.arrayContaining(['text_match:label_for']),
    );
  });

  it('keeps stable semantic IDs strong without over-penalizing them', async () => {
    const usernameInput = makeElement(
      { id: 'username', name: 'username', class: 'field-input' },
      { tagName: 'INPUT' },
    );
    const passwordInput = makeElement(
      { id: 'password', name: 'password', class: 'field-input' },
      { tagName: 'INPUT' },
    );

    const step = makeStep(1, {
      selector: '.field-input',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_username',
      action: 'input',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.field-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          id: 'username',
          name: 'username',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.field-input': [usernameInput, passwordInput],
        '#username': [usernameInput],
        '[id="username"]': [usernameInput],
        '[name="username"]': [usernameInput],
        'input[name="username"]': [usernameInput],
        '*': [usernameInput, passwordInput],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect([ '#username', 'input[name="username"]' ]).toContain(resolution.resolvedSelector);
    expect(scoreResolvedCandidate(step, snapshotCache.get('node-1')!, '[id="username"]').score).toBeGreaterThanOrEqual(0.65);
  });

  it('uses title and icon alt as bounded semantic compatibility evidence', async () => {
    const iconChild = makeElement({ alt: 'Upload Avatar' }, { tagName: 'IMG' }) as any;
    const uploadButton = makeElement(
      { 'data-testid': 'upload-avatar', title: 'Upload Avatar' },
      { tagName: 'BUTTON', children: [iconChild] },
    ) as any;
    iconChild.parentElement = uploadButton;
    const otherButton = makeElement(
      { 'data-testid': 'cancel-avatar', title: 'Cancel Avatar' },
      { tagName: 'BUTTON' },
    );

    const step = makeStep(1, {
      selector: '.icon-btn',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_upload_avatar',
      action: 'click',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.icon-btn',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        attributes: {
          dataTestId: 'upload-avatar',
          title: 'Upload Avatar',
          alt: 'Upload Avatar',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.icon-btn': [uploadButton, otherButton],
        '[data-testid="upload-avatar"]': [uploadButton],
        'button[data-testid="upload-avatar"]': [uploadButton],
        '*': [uploadButton, iconChild, otherButton],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toContain('upload-avatar');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.semanticCompatibilityReasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^text_match:(title|icon_child_alt)$/),
      ]),
    );
  });

  it('penalizes generated headlessui IDs but does not reject them', async () => {
    const logout = makeElement(
      { id: 'headlessui-menu-item-12', role: 'menuitem' },
      { text: 'Logout', tagName: 'BUTTON' },
    );
    const other = makeElement(
      { id: 'headlessui-menu-item-13', role: 'menuitem' },
      { text: 'Profile', tagName: 'BUTTON' },
    );

    const step = makeStep(1, {
      selector: '.menu-entry',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Logout',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-entry',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        textExcerpt: 'Logout',
        attributes: {
          role: 'menuitem',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-entry': [logout, other],
        '[id="headlessui-menu-item-12"]': [logout],
        'text=logout': [logout],
        'button:has-text("Logout")': [logout],
        '*': [logout, other],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).not.toContain('headlessui');
    expect(resolution.resolverMetadata.rejectReason).toBeNull();
  });

  it('records bounded nav/menu context as semantic compatibility evidence', async () => {
    const navRoot = makeElement({ id: 'main-nav' }, { tagName: 'NAV' }) as any;
    const navItem = makeElement({}, { tagName: 'LI', parent: navRoot }) as any;
    const pimItem = makeElement({}, { tagName: 'LI', parent: navRoot }) as any;
    const adminLink = makeElement(
      { class: 'menu-item', href: '/web/index.php/admin/viewAdminModule' },
      { text: 'Admin', tagName: 'A', parent: navItem },
    );
    const pimLink = makeElement(
      { class: 'menu-item', href: '/web/index.php/pim/viewPimModule' },
      { text: 'PIM', tagName: 'A', parent: pimItem },
    );
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        parentSelector: '#main-nav',
        context: {
          parentTag: 'li',
          nearestContainerTag: 'nav',
        },
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-item': [adminLink, pimLink],
        '#main-nav': [navRoot],
        'text=admin': [adminLink],
        'a:has-text("Admin")': [adminLink],
        '*': [navRoot, navItem, pimItem, adminLink, pimLink],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolverMetadata.semanticCompatibilityReasons).toEqual(
      expect.arrayContaining([
        'parent_selector_match',
        'parent_tag_match:li',
        'nearest_container_match:nav',
      ]),
    );
  });

  it('penalizes UUID-like and long numeric IDs in candidate scoring', () => {
    const uuidElement = makeElement(
      { id: 'user-7f4c2f31-1e1a-4bd4-a1a2-99f9f6a5f123' },
      { tagName: 'DIV' },
    );
    const longNumericElement = makeElement(
      { id: 'account-1234567890' },
      { tagName: 'DIV' },
    );
    const stableElement = makeElement({ id: 'usernameField' }, { tagName: 'DIV', id: 'usernameField' });
    const snapshot = makeDocument({
      '.item': [uuidElement, longNumericElement],
      '.stable-item': [stableElement],
      '[id="user-7f4c2f31-1e1a-4bd4-a1a2-99f9f6a5f123"]': [uuidElement],
      '[id="account-1234567890"]': [longNumericElement],
      '[id="usernameField"]': [stableElement],
      '#usernameField': [stableElement],
      '*': [uuidElement, longNumericElement, stableElement],
    });

    const uuidStep = makeStep(1, {
      selector: '.item',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          id: 'user-7f4c2f31-1e1a-4bd4-a1a2-99f9f6a5f123',
        },
      },
    });
    const longNumericStep = makeStep(1, {
      selector: '.item',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          id: 'account-1234567890',
        },
      },
    });
    const stableStep = makeStep(1, {
      selector: '.stable-item',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.stable-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          id: 'usernameField',
        },
      },
    });

    const stableScore = scoreResolvedCandidate(stableStep, snapshot, '#usernameField').score;
    expect(scoreResolvedCandidate(uuidStep, snapshot, '[id="user-7f4c2f31-1e1a-4bd4-a1a2-99f9f6a5f123"]').score).toBeLessThan(stableScore);
    expect(scoreResolvedCandidate(longNumericStep, snapshot, '[id="account-1234567890"]').score).toBeLessThan(stableScore);
  });

  it('does not over-penalize readable IDs with small numeric suffixes', () => {
    const addressLine = makeElement({ id: 'addressLine2' }, { tagName: 'INPUT', id: 'addressLine2' });
    const step = makeStep(1, {
      selector: '.field-input',
      selectorPriority: 'class',
      selectorRank: 7,
      action: 'input',
      fingerprint: {
        selector: '.field-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          id: 'addressLine2',
          name: 'addressLine2',
        },
      },
    });
    const snapshot = makeDocument({
      '.field-input': [addressLine],
      '#addressLine2': [addressLine],
      '[id="addressLine2"]': [addressLine],
      '*': [addressLine],
    });

    expect(scoreResolvedCandidate(step, snapshot, '#addressLine2').score).toBeGreaterThanOrEqual(0.65);
  });

  it('gives readable fingerprint-aligned IDs a small bonus', () => {
    const usernameInput = makeElement(
      { id: 'usernameField', name: 'username' },
      { tagName: 'INPUT', id: 'usernameField' },
    );
    const snapshot = makeDocument({
      '.field-input': [usernameInput],
      '#usernameField': [usernameInput],
      '[id="usernameField"]': [usernameInput],
      '[name="username"]': [usernameInput],
      '*': [usernameInput],
    });

    const unalignedStep = makeStep(1, {
      selector: '.field-input',
      selectorPriority: 'class',
      selectorRank: 7,
      action: 'input',
      fingerprint: {
        selector: '.field-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {},
      },
    });
    const alignedStep = makeStep(1, {
      ...unalignedStep,
      fingerprint: {
        selector: '.field-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          name: 'username',
        },
      },
      intent: 'input_username',
    });

    expect(scoreResolvedCandidate(alignedStep, snapshot, '[id="usernameField"]').score)
      .toBeGreaterThan(scoreResolvedCandidate(unalignedStep, snapshot, '[id="usernameField"]').score);
  });

  it('semantic class beats hashed class in candidate scoring', () => {
    const semanticElement = makeElement({ class: 'username-field' }, { tagName: 'INPUT' });
    const hashedElement = makeElement({ class: 'a1b2c3d4e5' }, { tagName: 'INPUT' });
    const semanticSnapshot = makeDocument({
      '.field': [semanticElement],
      '.username-field': [semanticElement],
      'input.username-field': [semanticElement],
      '*': [semanticElement],
    });
    const hashedSnapshot = makeDocument({
      '.field': [hashedElement],
      '.a1b2c3d4e5': [hashedElement],
      'input.a1b2c3d4e5': [hashedElement],
      '*': [hashedElement],
    });

    const semanticStep = makeStep(1, {
      selector: '.field',
      selectorPriority: 'class',
      selectorRank: 7,
      action: 'input',
      fingerprint: {
        selector: '.field',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          name: 'username',
        },
      },
      intent: 'input_username',
    });
    const hashedStep = makeStep(1, {
      ...semanticStep,
      fingerprint: {
        selector: '.field',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          class: 'a1b2c3d4e5',
        },
      },
    });

    expect(scoreExplicitCandidate(semanticStep, semanticSnapshot, '.username-field', 'class', 7))
      .toBeGreaterThan(scoreExplicitCandidate(hashedStep, hashedSnapshot, '.a1b2c3d4e5', 'class', 7));
  });

  it('utility-only Tailwind class list is penalized', () => {
    const utilityElement = makeElement({ class: 'flex items-center justify-center bg-blue-500 text-white p-4' }, { tagName: 'DIV' });
    const semanticElement = makeElement({ class: 'sidebar-button flex mt-4' }, { tagName: 'DIV' });
    const utilitySnapshot = makeDocument({
      '.target': [utilityElement],
      '.flex': [utilityElement],
      '*': [utilityElement],
    });
    const semanticSnapshot = makeDocument({
      '.target': [semanticElement],
      '.sidebar-button': [semanticElement],
      '*': [semanticElement],
    });

    const utilityStep = makeStep(1, {
      selector: '.target',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'flex items-center justify-center bg-blue-500 text-white p-4',
        },
      },
    });
    const semanticStep = makeStep(1, {
      ...utilityStep,
      fingerprint: {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'sidebar-button flex mt-4',
        },
      },
      intent: 'click_sidebar_button',
    });

    expect(scoreExplicitCandidate(utilityStep, utilitySnapshot, '.flex', 'class', 7))
      .toBeLessThan(scoreExplicitCandidate(semanticStep, semanticSnapshot, '.sidebar-button', 'class', 7));
  });

  it('does not generate or prefer compound utility selectors', () => {
    const element = makeElement({ class: 'flex items-center justify-center bg-blue-500 text-white p-4 rounded-md' }, { tagName: 'DIV' });
    const snapshot = makeDocument({
      '.target': [element],
      '*': [element],
    });
    const step = makeStep(1, {
      selector: '.target',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'flex items-center justify-center bg-blue-500 text-white p-4 rounded-md',
        },
      },
    });

    const candidates = generateCandidates(step, snapshot).map(candidate => candidate.selector);
    expect(candidates.some(selector => selector.includes('.flex.items-center'))).toBe(false);
  });

  it('semantic class mixed with utility classes remains usable', async () => {
    const sidebarItem = makeElement({ class: 'oxd-sidebar-item flex mt-4' }, { tagName: 'DIV' });
    const otherItem = makeElement({ class: 'oxd-sidebar-link flex mt-4' }, { tagName: 'DIV', text: 'Other' });
    const step = makeStep(1, {
      selector: '.oxd-sidebar-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_sidebar_item',
      fingerprint: {
        selector: '.oxd-sidebar-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'oxd-sidebar-item flex mt-4',
        },
      },
    });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-sidebar-item': [sidebarItem],
        'div.oxd-sidebar-item': [sidebarItem],
        '*': [sidebarItem, otherItem],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toContain('oxd-sidebar-item');
  });

  it('generic framework class is penalized but not rejected', async () => {
    const menuItem = makeElement({ class: 'oxd-main-menu-item' }, { tagName: 'DIV', text: 'Admin' });
    const semanticMenuItem = makeElement({ class: 'admin-menu-item' }, { tagName: 'DIV', text: 'Admin' });
    const step = makeStep(1, {
      selector: '.oxd-main-menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      fingerprint: {
        selector: '.oxd-main-menu-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        textExcerpt: 'Admin',
        attributes: {
          class: 'oxd-main-menu-item',
        },
      },
    });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-main-menu-item': [menuItem],
        'div.oxd-main-menu-item': [menuItem],
        '*': [menuItem],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolverMetadata.rejectReason).toBeNull();
    expect(scoreExplicitCandidate(step, snapshotCache.get('node-1')!, '.oxd-main-menu-item', 'class', 7))
      .toBeLessThan(scoreExplicitCandidate(
        {
          ...step,
          selector: '.admin-menu-item',
          fingerprint: {
            ...step.fingerprint,
            selector: '.admin-menu-item',
            attributes: {
              class: 'admin-menu-item',
            },
          },
        },
        makeDocument({
          '.admin-menu-item': [semanticMenuItem],
          '*': [semanticMenuItem],
        }),
        '.admin-menu-item',
        'class',
        7,
      ));
  });

  it('BEM-like class remains usable', () => {
    const bemElement = makeElement({ class: 'user-menu__logout' }, { tagName: 'BUTTON' });
    const frameworkElement = makeElement({ class: 'oxd-main-menu-item' }, { tagName: 'BUTTON' });
    const bemSnapshot = makeDocument({
      '.target': [bemElement],
      '.user-menu__logout': [bemElement],
      '*': [bemElement],
    });
    const frameworkSnapshot = makeDocument({
      '.target': [frameworkElement],
      '.oxd-main-menu-item': [frameworkElement],
      '*': [frameworkElement],
    });

    const bemStep = makeStep(1, {
      selector: '.target',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_logout',
      fingerprint: {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        textExcerpt: 'Logout',
        attributes: {
          class: 'user-menu__logout',
        },
      },
    });
    const frameworkStep = makeStep(1, {
      ...bemStep,
      fingerprint: {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        textExcerpt: 'Logout',
        attributes: {
          class: 'oxd-main-menu-item',
        },
      },
    });

    expect(scoreExplicitCandidate(bemStep, bemSnapshot, '.user-menu__logout', 'class', 7))
      .toBeGreaterThan(scoreExplicitCandidate(frameworkStep, frameworkSnapshot, '.oxd-main-menu-item', 'class', 7));
  });

  it('class-only selector remains available if no better truth exists', async () => {
    const classOnly = makeElement({ class: 'product-card' }, { tagName: 'DIV', text: 'Card' });
    const step = makeStep(1, {
      selector: '.product-card',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.product-card',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'product-card',
        },
      },
    });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.product-card': [classOnly],
        '*': [classOnly],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    expect(['kept-original', 'deterministic-override']).toContain(result.resolutions[0].resolverMetadata.resolvedBy);
  });

  it('penalized class still outranks brittle structural fallback when no stronger semantic candidate exists', () => {
    const button = makeElement({ class: 'flex items-center justify-center' }, { tagName: 'BUTTON', text: 'Open' });
    const snapshot = makeDocument({
      '.target': [button],
      '.flex': [button],
      'div > main > div:nth-child(3) > span > button': [button],
      '*': [button],
    });
    const step = makeStep(1, {
      selector: 'div > main > div:nth-child(3) > span > button',
      selectorPriority: 'path',
      selectorRank: 10,
      fingerprint: {
        selector: 'div > main > div:nth-child(3) > span > button',
        selectorPriority: 'path',
        selectorRank: 10,
        tagName: 'button',
        attributes: {
          class: 'flex items-center justify-center',
        },
      },
    });

    expect(scoreExplicitCandidate(step, snapshot, '.flex', 'class', 7))
      .toBeGreaterThan(scoreExplicitCandidate(step, snapshot, 'div > main > div:nth-child(3) > span > button', 'path', 10));
  });

  it('surfaces class penalty reasons in metadata', async () => {
    const utilityElement = makeElement({ class: 'flex text-white bg-blue-500' }, { tagName: 'DIV', text: '' });
    const step = makeStep(1, {
      selector: '.missing-target',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.missing-target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'flex text-white bg-blue-500',
        },
      },
    });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.flex': [utilityElement],
        'div.flex': [utilityElement],
        '*': [utilityElement],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    expect(result.resolutions[0].resolverMetadata.classPenaltyReason ?? []).toContain('utility_class');
  });

  it('does not treat unrelated parent wrapper text as a semantic text match', async () => {
    const wrapper = makeElement({}, { text: 'Approve request', tagName: 'DIV' }) as any;
    const siblingWrapper = makeElement({}, { text: 'Reject request', tagName: 'DIV' }) as any;
    const editButton = makeElement(
      { 'data-testid': 'edit-row' },
      { text: 'Edit', tagName: 'BUTTON', parent: wrapper },
    );
    const rejectButton = makeElement(
      { 'data-testid': 'reject-row' },
      { text: 'Reject', tagName: 'BUTTON', parent: siblingWrapper },
    );
    wrapper.children = [editButton as any];
    siblingWrapper.children = [rejectButton as any];

    const step = makeStep(1, {
      selector: '.row-action',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Approve',
      action: 'click',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.row-action',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        textExcerpt: 'Approve',
        attributes: {
          dataTestId: 'edit-row',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.row-action': [editButton, rejectButton],
        '[data-testid="edit-row"]': [editButton],
        'button[data-testid="edit-row"]': [editButton],
        '*': [wrapper, siblingWrapper, editButton, rejectButton],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.semanticCompatibilityReasons ?? []).not.toEqual(
      expect.arrayContaining(['text_match:parent_wrapper_text']),
    );
  });

  it('keeps generated IDs above fragile structural selectors', () => {
    const button = makeElement({ id: 'headlessui-menu-button-12' }, { tagName: 'BUTTON', text: 'Open' });
    const snapshot = makeDocument({
      'div > main > div:nth-child(3) > span > button': [button],
      '[id="headlessui-menu-button-12"]': [button],
      '*': [button],
    });
    const step = makeStep(1, {
      selector: 'div > main > div:nth-child(3) > span > button',
      selectorPriority: 'path',
      selectorRank: 10,
      fingerprint: {
        selector: 'div > main > div:nth-child(3) > span > button',
        selectorPriority: 'path',
        selectorRank: 10,
        tagName: 'button',
        attributes: {
          id: 'headlessui-menu-button-12',
        },
      },
    });

    const idScore = scoreResolvedCandidate(step, snapshot, '[id="headlessui-menu-button-12"]').score;
    const structuralScore = scoreResolvedCandidate(step, snapshot, 'div > main > div:nth-child(3) > span > button').score;
    expect(idScore).toBeGreaterThan(structuralScore);
  });

  it('emits attribute ID selectors for React runtime IDs and leading-digit IDs', () => {
    const reactElement = makeElement({ id: ':r1:' }, { tagName: 'DIV' });
    const numericElement = makeElement({ id: '123-login' }, { tagName: 'DIV' });
    const snapshot = makeDocument({
      '.item': [reactElement, numericElement],
      '*': [reactElement, numericElement],
    });

    const reactStep = makeStep(1, {
      selector: '.item',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          id: ':r1:',
        },
      },
    });
    const digitStep = makeStep(1, {
      selector: '.item',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          id: '123-login',
        },
      },
    });

    expect(generateCandidates(reactStep, snapshot).map(candidate => candidate.selector)).toContain('[id=":r1:"]');
    expect(generateCandidates(reactStep, snapshot).map(candidate => candidate.selector)).not.toContain('#:r1:');
    expect(generateCandidates(digitStep, snapshot).map(candidate => candidate.selector)).toContain('[id="123-login"]');
    expect(generateCandidates(digitStep, snapshot).map(candidate => candidate.selector)).not.toContain('#123-login');
  });

  it('blocks deterministic rescue when selected action snapshot reports target evidence missing', async () => {
    const searchInput = makeElement(
      { placeholder: 'Search', type: 'search' },
      { tagName: 'INPUT' },
    );
    const snapshot = makeDocument({
      '[placeholder="Search"]': [searchInput],
      'input[placeholder="Search"]': [searchInput],
      '*': [searchInput],
    });
    const step = makeStep(1, {
      selector: 'div > div:nth-of-type(1)',
      selectorPriority: 'path',
      selectorRank: 10,
      intent: 'click_Select',
      sourceNodeId: 'node-1',
      eventId: 'ev-1',
      fingerprint: {
        selector: 'div > div:nth-of-type(1)',
        selectorPriority: 'path',
        selectorRank: 10,
        tagName: 'div',
        textExcerpt: '-- Select --',
        attributes: {},
      },
    });

    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'selected_source_node_snapshot_after_event_local_missing',
          sourceNodeId: 'node-1',
          confidenceScore: 0.35,
          snapshotTargetEvidence: false,
          snapshotTargetEvidenceReason: 'target_missing_in_snapshot',
        },
        evaluatedCandidates: [
          {
            source: 'source-node-snapshot',
            temporalClass: 'pre_action',
            selected: true,
            reason: 'selected_source_node_snapshot_after_event_local_missing',
            sourceNodeId: 'node-1',
            confidenceScore: 0.35,
            targetPresent: false,
            snapshotTargetEvidenceReason: 'target_missing_in_snapshot',
          },
        ],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('div > div:nth-of-type(1)');
    expect(resolution.resolverMetadata.resolvedBy).toBe('blocked-snapshot-target-missing');
    expect(resolution.resolverMetadata.rejectReason).toBe('snapshot_target_missing');
    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: 'div > div:nth-of-type(1)',
      engine: 'css',
      source: 'resolver',
      proofLevel: 'blocked',
      rejectReason: 'snapshot_target_missing',
    }));
  });

  it('still resolves Logout menu item when role and text align', async () => {
    const logout = makeElement(
      { role: 'menuitem', href: '/web/index.php/auth/logout' },
      { text: 'Logout', tagName: 'A' },
    );
    const changePassword = makeElement(
      { role: 'menuitem', href: '/web/index.php/pim/changePassword' },
      { text: 'Change Password', tagName: 'A' },
    );
    const step = makeStep(1, {
      selector: '[role="menuitem"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      intent: 'click_Logout',
      action: 'click',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '[role="menuitem"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'a',
        textExcerpt: 'Logout',
        attributes: {
          role: 'menuitem',
          href: '/web/index.php/auth/logout',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '[role="menuitem"]': [logout, changePassword],
        'text=logout': [logout],
        '[role="menuitem"]:has-text("Logout")': [logout],
        '*': [logout, changePassword],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toContain('Logout');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.rejectReason).toBeNull();
  });

  it('keeps valid unique original selector', async () => {
    const step = makeStep(1, {
      selector: '[id="submit-btn"]',
      selectorPriority: 'id',
      selectorRank: 2,
      sourceNodeId: 'node-1',
    });

    const session = makeSession([step]);
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '[id="submit-btn"]': [makeElement({ id: 'submit-btn' }, { id: 'submit-btn', text: 'Submit' })],
      }),
    });

    const result = await resolveSelectorsForSession(session, snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('[id="submit-btn"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('kept-original');
    expect(resolution.selectorSpec).toEqual(expect.objectContaining({
      selector: '[id="submit-btn"]',
      engine: 'css',
      source: 'interceptor',
      proofLevel: 'recorded',
    }));
    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: '[id="submit-btn"]',
      engine: 'css',
      source: 'interceptor',
      proofLevel: 'snapshot_validated',
    }));
    expect(result.llmAttemptedStepNumbers).toHaveLength(0);
  });

  it('keeps valid unique original text selector', async () => {
    const logout = makeElement({}, { text: 'Logout' });
    const cancel = makeElement({}, { text: 'Cancel' });
    const step = makeStep(1, {
      selector: 'text=Logout',
      selectorPriority: 'text',
      selectorRank: 8,
      sourceNodeId: 'node-1',
    });

    const session = makeSession([step]);
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '*': [logout, cancel],
      }),
    });

    const result = await resolveSelectorsForSession(session, snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('text=Logout');
    expect(resolution.resolverMetadata.resolvedBy).toBe('kept-original');
    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: 'text=Logout',
      engine: 'text',
      source: 'interceptor',
      proofLevel: 'snapshot_validated',
    }));
  });

  it('performs deterministic override when original is non-unique and stable candidate is unique', async () => {
    const step = makeStep(1, {
      selector: '[name="save"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      intent: 'click_save',
      sourceNodeId: 'node-1',
    });

    const submit = makeElement({ name: 'save', 'data-testid': 'save-primary' }, { text: 'Save' });
    const draft = makeElement({ name: 'save' }, { text: 'Save Draft' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '[name="save"]': [submit, draft],
        '[data-testid="save-primary"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('[data-testid="save-primary"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: '[data-testid="save-primary"]',
      engine: 'css',
      source: 'resolver',
      proofLevel: 'semantic_validated',
    }));
  });

  it('performs deterministic override to unique text candidate when css selector is non-unique', async () => {
    const logoutBtn = makeElement({ class: 'btn' }, { text: 'Logout' });
    const cancelBtn = makeElement({ class: 'btn' }, { text: 'Cancel' });
    const step = makeStep(1, {
      selector: '.btn',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_logout',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.btn': [logoutBtn, cancelBtn],
        '*': [logoutBtn, cancelBtn],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('text=logout');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('uses text-derived deterministic override for repeated css selector with intent text', async () => {
    const admin = makeElement({ class: 'menu-item' }, { text: 'Admin' });
    const pim = makeElement({ class: 'menu-item' }, { text: 'PIM' });
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-item': [admin, pim],
        '.menu-item:has-text("Admin")': [admin],
        '*': [admin, pim],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).not.toBe('.menu-item');
    expect(resolution.resolvedSelector).toMatch(/admin/i);
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('resolves calendar year selection deterministically from numeric intent', async () => {
    const year1981 = makeElement({ class: 'oxd-calendar-dropdown--option' }, { text: '1981' });
    const year2026 = makeElement({ class: 'oxd-calendar-dropdown--option' }, { text: '2026' });
    const step = makeStep(1, {
      selector: '.oxd-calendar-dropdown--option',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_1981',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-calendar-dropdown--option': [year1981, year2026],
        '.oxd-calendar-dropdown--option:has-text("1981")': [year1981],
        '*': [year1981, year2026],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).not.toBe('.oxd-calendar-dropdown--option');
    expect(resolution.resolvedSelector).toContain('1981');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('resolves calendar date input with scoped deterministic selector', async () => {
    const calendarContainer = makeElement({ class: 'oxd-date-input' }, { text: '' });
    const dateInput = makeElement(
      { class: 'oxd-input oxd-input--focus', placeholder: 'yyyy-dd-mm' },
      { text: '' },
    );
    const otherInput = makeElement(
      { class: 'oxd-input oxd-input--focus', placeholder: 'Search' },
      { text: '' },
    );
    const step = makeStep(1, {
      selector: '.oxd-input--focus',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_oxd_input_focus',
      action: 'input',
      value: '2026-01-20',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-date-input': [calendarContainer],
        '.oxd-input--focus': [dateInput, otherInput],
        '.oxd-date-input .oxd-input--focus': [dateInput],
        '.oxd-date-input input': [dateInput],
        '.oxd-date-input .oxd-input': [dateInput],
        'input[placeholder*="yyyy"]': [dateInput],
        '*': [calendarContainer, dateInput, otherInput],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).not.toBe('.oxd-input--focus');
    expect(resolution.resolvedSelector).toContain('.oxd-date-input');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('resolves calendar icon click via calendar-scoped selector', async () => {
    const calendarContainer = makeElement({ class: 'oxd-date-input' }, { text: '' });
    const calendarIcon = makeElement({ class: 'oxd-icon' }, { text: '' });
    const otherIcon = makeElement({ class: 'oxd-icon' }, { text: '' });
    const step = makeStep(1, {
      selector: '.oxd-icon',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_oxd_icon',
      action: 'click',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-date-input': [calendarContainer],
        '.oxd-icon': [calendarIcon, otherIcon],
        '.oxd-date-input .oxd-icon': [calendarIcon],
        '*': [calendarContainer, calendarIcon, otherIcon],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('.oxd-date-input .oxd-icon');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('blocks deterministic override to generic shell selector and keeps original unresolved', async () => {
    const appShell = makeElement({ id: 'app' }, { id: 'app', text: 'username password login' });
    const step = makeStep(1, {
      selector: '.btn',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_username',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.btn': [],
        '[id="app"]': [appShell],
        '*': [appShell],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('.btn');
    expect(resolution.resolverMetadata.resolvedBy).toBe('unresolved');
    expect(resolution.resolverMetadata.warningCodes).toContain('blocked-generic-shell-override');
  });

  it('trusts strong original selector when snapshot misses control', async () => {
    const step = makeStep(1, {
      selector: 'input[name="username"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      intent: 'input_username',
      action: 'input',
      sourceNodeId: 'node-1',
    });

    const shell = makeElement({ class: 'orangehrm-login-layout' }, { text: 'Login shell' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        'input[name="username"]': [],
        '.orangehrm-login-layout': [shell],
        '*': [shell],
      }),
    });

    const llmProvider = vi.fn(async () => [{ stepNumber: 1, selector: '.orangehrm-login-layout' }]);
    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: true },
      llmProvider,
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('input[name="username"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('kept-original');
    expect(resolution.resolverMetadata.warningCodes).toContain('trusted-original-snapshot-miss');
    expect(result.llmAttemptedStepNumbers).toHaveLength(0);
    expect(llmProvider).not.toHaveBeenCalled();
  });

  it('treats hidden matches as non-visible during validation', () => {
    const hidden = makeElement({ name: 'save', style: 'display:none' }, { text: 'Hidden Save', style: 'display:none' });
    const visible = makeElement({ name: 'save' }, { text: 'Visible Save' });
    const document = makeDocument({
      '[name="save"]': [hidden, visible],
    });

    const validation = validateCSSCandidate('[name="save"]', document);
    expect(validation.totalMatchCount).toBe(2);
    expect(validation.visibleMatchCount).toBe(1);
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.reason).toBe('unique-visible');
  });

  it('treats matches inside hidden ancestors as non-visible during validation', () => {
    const hiddenAncestor = makeElement({ style: 'display:none' }, { text: 'wrapper' }) as any;
    const hiddenChild = makeElement({ name: 'save' }, { text: 'Hidden Save', parent: hiddenAncestor });
    const visible = makeElement({ name: 'save' }, { text: 'Visible Save' });
    const document = makeDocument({
      '[name="save"]': [hiddenChild, visible],
    });

    const validation = validateCSSCandidate('[name="save"]', document);
    expect(validation.totalMatchCount).toBe(2);
    expect(validation.visibleMatchCount).toBe(1);
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.reason).toBe('unique-visible');
  });

  it('matches text selectors against input value and placeholder', () => {
    const emailInput = makeElement({ name: 'email', value: 'alice@example.com', placeholder: 'Email address' });
    const document = makeDocument({
      '*': [emailInput],
      input: [emailInput],
    });

    const valueValidation = validateTextCandidate('text=alice@example.com', document);
    expect(valueValidation.effectiveMatchCount).toBe(1);
    expect(valueValidation.reason).toBe('unique-visible');

    const placeholderValidation = validateTextCandidate('text=Email address', document);
    expect(placeholderValidation.effectiveMatchCount).toBe(1);
    expect(placeholderValidation.reason).toBe('unique-visible');
  });

  it('matches text selectors against aria-label when textContent is empty', () => {
    const button = makeElement({ 'aria-label': 'Save Changes' });
    const document = makeDocument({
      '*': [button],
      button: [button],
    });

    const validation = validateTextCandidate('text=save changes', document);
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.reason).toBe('unique-visible');
  });

  it('resolves overly broad selectors deterministically after pruning', () => {
    const buttons = Array.from({ length: 60 }, (_, idx) =>
      makeElement({ type: 'button', 'data-idx': String(idx) }, { text: `Button ${idx}`, tagName: 'BUTTON' }),
    );
    const document = makeDocument({
      button: buttons,
    });

    const validation = validateCSSCandidate('button', document, makeStep(1, {
      selector: 'button',
      intent: 'click_button',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        attributes: {},
      },
    }));
    expect(validation.totalMatchCount).toBe(60);
    expect(validation.reason).toBe('too-broad');
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.matchCount).toBe(60);
    expect(validation.resolvedElement).toBeTruthy();
  });

  it('uses parent proximity to disambiguate repeated buttons', () => {
    const formScope = makeElement({ id: 'profile-form' }, { tagName: 'FORM' }) as any;
    const saveA = makeElement({ 'aria-label': 'Save' }, { text: 'Save', tagName: 'BUTTON', parent: formScope });
    const saveB = makeElement({ 'aria-label': 'Save' }, { text: 'Save', tagName: 'BUTTON' });

    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_save',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Save',
        parentSelector: '#profile-form',
        attributes: { 'aria-label': 'Save' },
      },
    });

    const document = makeDocument({
      button: [saveA, saveB],
      '#profile-form': [formScope],
    });

    const validation = validateCSSCandidate('button', document, step);
    expect(validation.reason).toBe('resolved-multi-match');
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.matchCount).toBe(2);
    expect(validation.resolvedElement).toBe(saveA);
    expect(validation.ambiguityReason).toBeUndefined();
  });

  it('uses context proximity to disambiguate same-label menu options in different groups', () => {
    const accountMenu = makeElement({ id: 'account-menu' }, { tagName: 'UL' }) as any;
    const settingsMenu = makeElement({ id: 'settings-menu' }, { tagName: 'UL' }) as any;
    const profileAccount = makeElement(
      { role: 'menuitem', 'aria-label': 'Profile' },
      { text: 'Profile', tagName: 'LI', parent: accountMenu },
    );
    const profileSettings = makeElement(
      { role: 'menuitem', 'aria-label': 'Profile' },
      { text: 'Profile', tagName: 'LI', parent: settingsMenu },
    );

    const step = makeStep(1, {
      selector: '[role="menuitem"]',
      intent: 'click_profile',
      fingerprint: {
        selector: '[role="menuitem"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'li',
        textExcerpt: 'Profile',
        parentSelector: '#settings-menu',
        attributes: { 'aria-label': 'Profile', role: 'menuitem' },
      },
    });

    const document = makeDocument({
      '[role="menuitem"]': [profileAccount, profileSettings],
      '#account-menu': [accountMenu],
      '#settings-menu': [settingsMenu],
    });

    const validation = validateCSSCandidate('[role="menuitem"]', document, step);
    expect(validation.reason).toBe('resolved-multi-match');
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.matchCount).toBe(2);
    expect(validation.resolvedElement).toBe(profileSettings);
    expect(validation.ambiguityReason).toBeUndefined();
  });

  it('uses parent row context to disambiguate repeated row actions', () => {
    const rowA = makeElement({ id: 'row-alpha' }, { tagName: 'TR' }) as any;
    const rowB = makeElement({ id: 'row-beta' }, { tagName: 'TR' }) as any;
    const editAlpha = makeElement(
      { 'aria-label': 'Edit', 'data-testid': 'edit-alpha' },
      { text: 'Edit', tagName: 'BUTTON', parent: rowA },
    );
    const editBeta = makeElement(
      { 'aria-label': 'Edit', 'data-testid': 'edit-beta' },
      { text: 'Edit', tagName: 'BUTTON', parent: rowB },
    );

    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_edit',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Edit',
        parentSelector: '#row-beta',
        attributes: { 'aria-label': 'Edit' },
      },
    });

    const document = makeDocument({
      button: [editAlpha, editBeta],
      '#row-alpha': [rowA],
      '#row-beta': [rowB],
    });

    const validation = validateCSSCandidate('button', document, step);
    expect(validation.reason).toBe('resolved-multi-match');
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.matchCount).toBe(2);
    expect(validation.resolvedElement).toBe(editBeta);
    expect(validation.ambiguityReason).toBeUndefined();
  });

  it('prefers a slightly better ranked element over DOM order when repeated matches are similar', () => {
    const saveA = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const saveB = makeElement(
      { 'data-testid': 'primary-save', 'aria-label': 'Save' },
      { text: 'Save', tagName: 'BUTTON' },
    );

    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_save',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Save',
        attributes: { 'data-testid': 'primary-save', 'aria-label': 'Save' },
      },
    });

    const document = makeDocument({
      button: [saveA, saveB],
    });

    const validation = validateCSSCandidate('button', document, step);
    expect(validation.reason).toBe('resolved-multi-match');
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.matchCount).toBe(2);
    expect(validation.resolvedElement).toBe(saveB);
    expect(validation.ambiguityReason).toBeUndefined();
  });

  it('uses DOM order tiebreaker when repeated matches score the same', () => {
    const saveA = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const saveB = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_save',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Save',
        attributes: {},
      },
    });

    const document = makeDocument({
      button: [saveA, saveB],
    });

    const validation = validateCSSCandidate('button', document, step);
    expect(validation.reason).toBe('resolved-multi-match');
    expect(validation.resolvedElement).toBe(saveA);
    expect(validation.ambiguityReason).toBe('resolved_by_dom_order_tiebreaker');
    expect(validation.confidenceScore).toBeLessThan(0.7);
  });

  it('records ambiguity metadata on deterministic multi-match resolution', async () => {
    const saveA = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const saveB = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const step = makeStep(1, {
      selector: 'button',
      selectorPriority: 'unknown',
      selectorRank: 10,
      intent: 'click_save',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Save',
        attributes: {},
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [saveA, saveB],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolverMetadata.matchCount).toBe(2);
    expect(resolution.resolverMetadata.ambiguityReason).toBe('resolved_by_dom_order_tiebreaker');
    expect(resolution.resolverMetadata.confidenceScore).toBeGreaterThan(0);
  });

  it('preserves threshold safety for truly identical elements resolved by DOM order', async () => {
    const saveA = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const saveB = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const step = makeStep(1, {
      selector: 'button',
      selectorPriority: 'unknown',
      selectorRank: 10,
      intent: 'click_save',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Save',
        attributes: {},
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [saveA, saveB],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolverMetadata.resolvedBy).toBe('unresolved');
    expect(resolution.resolverMetadata.matchCount).toBe(2);
    expect(resolution.resolverMetadata.ambiguityReason).toBe('resolved_by_dom_order_tiebreaker');
    expect(resolution.resolverMetadata.confidenceScore).toBeLessThan(0.7);
    expect(resolution.resolverMetadata.warningCodes).toContain('deterministic-below-threshold');
  });

  it('accepts valid LLM fallback when deterministic candidates stay below threshold', async () => {
    const step = makeStep(1, {
      selector: 'button',
      selectorPriority: 'unknown',
      selectorRank: 10,
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });

    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit' });
    const cancel = makeElement({ 'aria-label': 'cancel' }, { text: 'Cancel' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        'button[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [{ stepNumber: 1, selector: 'button[aria-label="submit"]' }],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('button[aria-label="submit"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('llm-accepted');
    expect(resolution.resolverMetadata.llmAccepted).toBe(true);
    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: 'button[aria-label="submit"]',
      engine: 'css',
      source: 'llm',
      proofLevel: 'semantic_validated',
    }));
    expect(result.llmAttemptedStepNumbers).toEqual([1]);
    expect(result.llmAcceptedStepNumbers).toEqual([1]);
  });

  it('does not invoke LLM fallback when snapshot is unavailable', async () => {
    const session = makeSession([makeStep(1, { selector: 'button', sourceNodeId: 'missing-node' })]);
    const snapshotCache = makeSnapshotCache({});

    const llmProvider = vi.fn(async () => [{ stepNumber: 1, selector: '#irrelevant' }]);
    const result = await resolveSelectorsForSession(
      session,
      snapshotCache,
      { enableLLMFallback: true },
      llmProvider,
    );

    expect(llmProvider).not.toHaveBeenCalled();
    expect(result.llmAttemptedStepNumbers).toHaveLength(0);
    expect(result.resolutions[0].resolverMetadata.warningCodes).toContain('snapshot-unavailable');
  });

  it('marks engine-unavailable when all snapshots are missing due engine failure', async () => {
    const session = makeSession([makeStep(1, { selector: 'button', sourceNodeId: 'node-1' })]);
    const snapshotCache = makeSnapshotCache({ 'node-1': null }, false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await resolveSelectorsForSession(
      session,
      snapshotCache,
      { enableLLMFallback: false },
    );

    expect(result.resolutions[0].resolverMetadata.warningCodes).toContain('snapshot-engine-unavailable');
    expect(warnSpy).toHaveBeenCalledWith('[AIR] No snapshots available for entire session');
    warnSpy.mockRestore();
  });

  it('ignores duplicate LLM suggestions for the same step number', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit' });
    const cancel = makeElement({ 'aria-label': 'cancel' }, { text: 'Cancel' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        'button[aria-label="submit"]': [submit],
        'button[aria-label="cancel"]': [cancel],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: true, resolverMinScore: 1.3 },
      async () => [
        { stepNumber: 1, selector: 'button[aria-label="submit"]' },
        { stepNumber: 1, selector: 'button[aria-label="cancel"]' },
      ],
    );

    expect(result.resolutions[0].resolvedSelector).toBe('button[aria-label="submit"]');
    expect(result.llmAcceptedStepNumbers).toEqual([1]);
  });

  it('enforces LLM fallback circuit breaker cap', async () => {
    const steps = Array.from({ length: 10 }, (_, idx) =>
      makeStep(idx + 1, {
        selector: 'button',
        intent: `click_submit_${idx + 1}`,
        sourceNodeId: `node-${idx + 1}`,
      }),
    );

    const snapshotEntries: Record<string, Document | null> = {};
    for (const step of steps) {
      const submit = makeElement({ 'aria-label': `submit ${step.step}` }, { text: 'Submit' });
      const cancel = makeElement({ 'aria-label': `cancel ${step.step}` }, { text: 'Cancel' });
      snapshotEntries[step.sourceNodeId as string] = makeDocument({
        button: [submit, cancel],
        [`button[aria-label="submit ${step.step}"]`]: [submit],
      });
    }

    const llmProvider = vi.fn(async request =>
      request.steps.map((item: any) => ({ stepNumber: item.stepNumber, selector: `button[aria-label="submit ${item.stepNumber}"]` })),
    );

    const result = await resolveSelectorsForSession(
      makeSession(steps),
      makeSnapshotCache(snapshotEntries),
      { enableLLMFallback: true, resolverMinScore: 1.3 },
      llmProvider,
    );

    expect(result.llmAttemptedStepNumbers).toHaveLength(3);
    expect(llmProvider).toHaveBeenCalledTimes(1);
    expect(result.resolutions.filter(r => r.resolverMetadata.warningCodes.includes('llm-circuit-breaker')).length)
      .toBeGreaterThan(0);
  });

  it('caps LLM retries per step and falls back to deterministic candidate after rejection', async () => {
    const step = makeStep(1, {
      selector: 'button',
      selectorPriority: 'unknown',
      selectorRank: 10,
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });

    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit' });
    const cancelOne = makeElement({ 'aria-label': 'cancel-1' }, { text: 'Cancel' });
    const cancelTwo = makeElement({ 'aria-label': 'cancel-2' }, { text: 'Cancel' });
    const cancelThree = makeElement({ 'aria-label': 'cancel-3' }, { text: 'Cancel' });
    const cancelFour = makeElement({ 'aria-label': 'cancel-4' }, { text: 'Cancel' });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancelOne],
        '[aria-label="submit"]': [submit],
        '[aria-label="cancel-1"]': [cancelOne],
        '[aria-label="cancel-2"]': [cancelTwo],
        '[aria-label="cancel-3"]': [cancelThree],
        '[aria-label="cancel-4"]': [cancelFour],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          selector: '[aria-label="cancel-1"]',
          selectors: [
            '[aria-label="cancel-1"]',
            '[aria-label="cancel-2"]',
            '[aria-label="cancel-3"]',
            '[aria-label="cancel-4"]',
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(result.llmAttemptedStepNumbers).toEqual([1]);
    expect(result.llmAcceptedStepNumbers).toHaveLength(0);
    expect(resolution.resolvedSelector).toBe('[aria-label="submit"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.warningCodes).toContain('llm-retry-cap-reached');
    expect(resolution.resolverMetadata.warningCodes).toContain('deterministic-low-score-fallback');
    expect(resolution.resolverMetadata.warningCodes).toContain('llm-retries-exhausted');
    expect(resolution.resolverMetadata.llmAccepted).toBe(false);
    expect(resolution.resolverMetadata.rejectReason).toBe('llm-intent-mismatch');
  });

  it('accepts a valid field selector via LLM instead of using a non-interactive container fallback', async () => {
    const step = makeStep(1, {
      selector: 'input[name="username"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      intent: 'click_username',
      action: 'click',
      sourceNodeId: 'node-1',
    });

    const loginContainer = makeElement({ class: 'orangehrm-login-layout' }, { text: 'Username Password Login' });
    const uniqueInput = makeElement({ name: 'username' }, { text: '', tagName: 'INPUT' });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        'input[name="username"]': [uniqueInput],
        '.orangehrm-login-layout': [loginContainer],
        '*': [loginContainer, uniqueInput],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.1,
      },
      async () => [
        { stepNumber: 1, selector: 'input[name="username"]' },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('input[name="username"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('llm-accepted');
    expect(result.llmAttemptedStepNumbers).toEqual([1]);
    expect(result.llmAcceptedStepNumbers).toEqual([1]);
    expect(resolution.resolverMetadata.warningCodes).not.toContain('deterministic-low-score-fallback');
    expect(resolution.resolverMetadata.rejectReason).toBeNull();
    expect(resolution.resolverMetadata.llmCandidatesReturned).toEqual(['input[name="username"]']);
    expect(resolution.resolverMetadata.llmCandidatesTried).toEqual(['input[name="username"]']);
    expect(resolution.resolverMetadata.llmAcceptedRank).toBe(1);
    expect(resolution.resolverMetadata.llmResponseFormat).toBe('legacy-selector');
  });

  it('rejects false-positive LLM selector when intent token does not match target element context', async () => {
    const step = makeStep(1, {
      selector: '.oxd-text',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_2026',
      action: 'click',
      sourceNodeId: 'node-1',
    });

    const yearOption = makeElement({ class: 'oxd-calendar-dropdown--option' }, { text: '2026' });
    const adminLink = makeElement({ href: '/web/index.php/admin/viewAdminModule' }, { text: 'Admin' });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-text': [yearOption, adminLink],
        'a[href="/web/index.php/admin/viewAdminModule"]': [adminLink],
        '*': [yearOption, adminLink],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        { stepNumber: 1, selector: 'a[href="/web/index.php/admin/viewAdminModule"]' },
      ],
    );

    const resolution = result.resolutions[0];
    expect(result.llmAttemptedStepNumbers).toEqual([1]);
    expect(result.llmAcceptedStepNumbers).toHaveLength(0);
    expect(resolution.resolverMetadata.resolvedSelector).not.toBe('a[href="/web/index.php/admin/viewAdminModule"]');
    expect(['unresolved', 'deterministic-override']).toContain(resolution.resolverMetadata.resolvedBy);
    expect(resolution.resolverMetadata.rejectReason).toBe('llm-intent-mismatch');
    expect(resolution.resolverMetadata.warningCodes).toContain('llm-intent-mismatch');
    expect(resolution.resolverMetadata.llmAlternative).toBe('a[href="/web/index.php/admin/viewAdminModule"]');
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: 'a[href="/web/index.php/admin/viewAdminModule"]',
        rejectReason: 'llm-intent-mismatch',
      },
    ]);
  });

  it('accepts a later LLM candidate after an earlier invalid selector', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({}, { text: 'Submit', tagName: 'BUTTON' });
    const cancel = makeElement({}, { text: 'Submit', tagName: 'BUTTON' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        '.dialog button.primary': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[' },
            { selector: '.dialog button.primary' },
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('.dialog button.primary');
    expect(resolution.resolverMetadata.resolvedBy).toBe('llm-accepted');
    expect(resolution.resolverMetadata.llmAcceptedRank).toBe(2);
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: 'button[',
        rejectReason: 'invalid-llm-selector',
      },
    ]);
  });

  it('accepts a later LLM candidate after an earlier non-unique selector', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({}, { text: 'Submit', tagName: 'BUTTON' });
    const cancel = makeElement({}, { text: 'Submit', tagName: 'BUTTON' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        '.dialog button.primary': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          selectors: [
            'button',
            '.dialog button.primary',
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('.dialog button.primary');
    expect(resolution.resolverMetadata.resolvedBy).toBe('llm-accepted');
    expect(resolution.resolverMetadata.llmAcceptedRank).toBe(2);
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: 'button',
        rejectReason: 'llm-selector-not-unique',
      },
    ]);
  });

  it('merges duplicate LLM step objects and accepts a later valid candidate', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit' });
    const cancel = makeElement({ 'aria-label': 'cancel' }, { text: 'Cancel' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        'button[aria-label="submit"]': [submit],
        'button[aria-label="cancel"]': [cancel],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
        llmMaxCandidatesPerStep: 3,
      },
      async () => [
        { stepNumber: 1, selector: 'button[aria-label="cancel"]' },
        { stepNumber: 1, selectors: ['button[aria-label="submit"]'] },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('button[aria-label="submit"]');
    expect(resolution.resolverMetadata.llmCandidatesReturned).toEqual([
      'button[aria-label="cancel"]',
      'button[aria-label="submit"]',
    ]);
    expect(resolution.resolverMetadata.llmCandidatesTried).toEqual([
      'button[aria-label="cancel"]',
      'button[aria-label="submit"]',
    ]);
    expect(resolution.resolverMetadata.llmAcceptedRank).toBe(2);
  });

  it('applies href mismatch semantic safety to LLM candidates before accepting later valid candidate', async () => {
    const step = makeStep(1, {
      selector: '.menu-link',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-link',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const adminLink = makeElement({ href: '/web/index.php/admin/viewAdminModule' }, { text: 'Admin' });
    const wrongLink = makeElement({ href: '/web/index.php/pim/viewPimModule' }, { text: 'Admin' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-link': [adminLink, wrongLink],
        'a[href="/web/index.php/pim/viewPimModule"]': [wrongLink],
        'a[href="/web/index.php/admin/viewAdminModule"]': [adminLink],
        '*': [adminLink, wrongLink],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'a[href="/web/index.php/pim/viewPimModule"]' },
            { selector: 'a[href="/web/index.php/admin/viewAdminModule"]' },
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('a[href="/web/index.php/admin/viewAdminModule"]');
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: 'a[href="/web/index.php/pim/viewPimModule"]',
        rejectReason: 'href_mismatch',
      },
    ]);
  });

  it('applies control-family mismatch safety to LLM candidates', async () => {
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_logout',
      action: 'custom-select',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '[role="menuitem"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'a',
        textExcerpt: 'Logout',
        attributes: {
          role: 'menuitem',
          href: '/logout',
        },
      },
    });

    const wrongButton = makeElement({ role: 'button', 'aria-label': 'Logout' }, { text: 'Logout' });
    const rightMenuItem = makeElement({ role: 'menuitem', href: '/logout' }, { text: 'Logout' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-item': [wrongButton, rightMenuItem],
        '[role="button"]': [wrongButton],
        '[role="menuitem"]': [rightMenuItem],
        '*': [wrongButton, rightMenuItem],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          candidates: [
            { selector: '[role="button"]' },
            { selector: '[role="menuitem"]' },
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('[role="menuitem"]');
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: '[role="button"]',
        rejectReason: 'control_family_mismatch',
      },
    ]);
  });

  it('applies text mismatch safety to LLM candidates', async () => {
    const step = makeStep(1, {
      selector: '.nav-link',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.nav-link',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const adminLink = makeElement({ href: '/web/index.php/admin/viewAdminModule' }, { text: 'Admin' });
    const pimLink = makeElement({ href: '/web/index.php/admin/viewAdminModule' }, { text: 'PIM' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.nav-link': [adminLink, pimLink],
        '.sidebar a.pim-link': [pimLink],
        '.sidebar a.admin-link': [adminLink],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          candidates: [
            { selector: '.sidebar a.pim-link' },
            { selector: '.sidebar a.admin-link' },
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('.sidebar a.admin-link');
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: '.sidebar a.pim-link',
        rejectReason: 'text_mismatch',
      },
    ]);
  });

  it('rejects overly complex LLM selectors before accepting a simpler valid candidate', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit],
        'button[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          candidates: [
            {
              selector: 'html body main section div div div div div button:nth-child(2):nth-of-type(1)',
            },
            {
              selector: 'button[aria-label="submit"]',
            },
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('button[aria-label="submit"]');
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: 'html body main section div div div div div button:nth-child(2):nth-of-type(1)',
        rejectReason: 'llm-selector-too-complex',
      },
    ]);
  });

  it('triggers one corrective retry after all top-k candidates fail and accepts a normalized retry selector', async () => {
    const step = makeStep(1, {
      selector: '.login-panel',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_username',
      action: 'input',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.login-panel',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        textExcerpt: 'Username',
        parentSelector: 'form.login-form',
        attributes: {
          name: 'username',
          placeholder: 'Username',
          'data-testid': 'username-input',
          'data-cy': 'username-field',
          role: 'textbox',
        },
      },
    });

    const container = makeElement({ class: 'login-panel' }, { text: 'Login', tagName: 'DIV' });
    const usernameInput = makeElement(
      { name: 'username', placeholder: 'Username', role: 'textbox' },
      { tagName: 'INPUT' },
    );
    const provider = vi.fn(async (request: any) => {
      if (request.mode === 'retry') {
        return [{ stepNumber: 1, selector: 'locator(\'input[name="username"]\')' }];
      }
      return [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[' },
            { selector: '.login-panel' },
          ],
        },
      ];
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.login-panel': [container],
        'input[name="username"]': [usernameInput],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      provider,
    );

    const resolution = result.resolutions[0];
    expect(provider).toHaveBeenCalledTimes(2);
    expect(resolution.resolvedSelector).toBe('input[name="username"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('llm-accepted');
    expect(resolution.resolverMetadata.llmRetryTriggered).toBe(true);
    expect(resolution.resolverMetadata.llmRetrySelector).toBe('input[name="username"]');
    expect(resolution.resolverMetadata.llmRetryAccepted).toBe(true);
    expect(resolution.resolverMetadata.llmRetryStatus).toBe('accepted');
  });

  it('applies existing low-score fallback after retry rejection and does not retry more than once', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const shell = makeElement({ class: 'shell' }, { text: 'Layout', tagName: 'DIV' });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit', tagName: 'BUTTON' });
    const cancel = makeElement({ 'aria-label': 'cancel' }, { text: 'Submit', tagName: 'BUTTON' });
    const provider = vi.fn(async (request: any) => {
      if (request.mode === 'retry') {
        return [{ stepNumber: 1, selector: 'button' }];
      }
      return [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[' },
            { selector: '.shell' },
          ],
        },
      ];
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        '.shell': [shell],
        '[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      provider,
    );

    const resolution = result.resolutions[0];
    expect(provider).toHaveBeenCalledTimes(2);
    expect(resolution.resolvedSelector).toBe('[aria-label="submit"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.llmRetryTriggered).toBe(true);
    expect(resolution.resolverMetadata.llmRetryAccepted).toBe(false);
    expect(resolution.resolverMetadata.llmRetryRejectReason).toBe('llm-selector-not-unique');
    expect(resolution.resolverMetadata.llmRetryStatus).toBe('rejected');
    expect(resolution.resolverMetadata.warningCodes).toContain('deterministic-low-score-fallback');
  });

  it('rejects semantically wrong retry selectors through the same validation gates', async () => {
    const step = makeStep(1, {
      selector: '.menu-link',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-link',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });
    const adminLink = makeElement({ href: '/web/index.php/admin/viewAdminModule' }, { text: 'Admin' });
    const wrongLink = makeElement({ href: '/web/index.php/pim/viewPimModule' }, { text: 'Admin' });
    const provider = vi.fn(async (request: any) => {
      if (request.mode === 'retry') {
        return [{ stepNumber: 1, selector: 'a[href="/web/index.php/pim/viewPimModule"]' }];
      }
      return [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[' },
            { selector: '.menu-link' },
          ],
        },
      ];
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-link': [adminLink, wrongLink],
        'a[href="/web/index.php/admin/viewAdminModule"]': [adminLink],
        'a[href="/web/index.php/pim/viewPimModule"]': [wrongLink],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      provider,
    );

    const resolution = result.resolutions[0];
    expect(provider).toHaveBeenCalledTimes(2);
    expect(resolution.resolverMetadata.llmRetryTriggered).toBe(true);
    expect(resolution.resolverMetadata.llmRetryRejectReason).toBe('href_mismatch');
    expect(resolution.resolverMetadata.llmRetryStatus).toBe('rejected');
  });

  it('does not run corrective retry for blocked-snapshot-target-missing steps', async () => {
    const step = makeStep(1, {
      selector: 'div > div:nth-of-type(1)',
      selectorPriority: 'path',
      selectorRank: 10,
      intent: 'click_select',
      sourceNodeId: 'node-1',
      eventId: 'ev-1',
    });
    const provider = vi.fn(async () => []);
    const selectTrigger = makeElement({ 'aria-haspopup': 'listbox' }, { text: '-- Select --', tagName: 'DIV' });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': makeDocument({ '*': [selectTrigger] }) },
      () => ({
        snapshot: makeDocument({ '*': [selectTrigger] }),
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'selected_source_node_snapshot_after_event_local_missing',
          eventId: 'ev-1',
          sourceNodeId: 'node-1',
          confidenceScore: 0.35,
          snapshotTargetEvidence: false,
          snapshotTargetEvidenceReason: 'target_missing_in_snapshot',
        },
        evaluatedCandidates: [
          {
            source: 'source-node-snapshot',
            temporalClass: 'pre_action',
            selected: true,
            reason: 'selected_source_node_snapshot_after_event_local_missing',
            sourceNodeId: 'node-1',
            confidenceScore: 0.35,
            targetPresent: false,
            snapshotTargetEvidenceReason: 'target_missing_in_snapshot',
          },
        ],
      }),
    );

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: true },
      provider,
    );

    expect(provider).not.toHaveBeenCalled();
    expect(result.resolutions[0].resolverMetadata.resolvedBy).toBe('blocked-snapshot-target-missing');
    expect(result.resolutions[0].resolverMetadata.llmRetryTriggered).toBe(false);
  });

  it('does not run corrective retry on empty initial response', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit', tagName: 'BUTTON' });
    const provider = vi.fn(async () => []);
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit],
        '[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      provider,
    );

    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.resolutions[0].resolverMetadata.llmRetryTriggered).toBe(false);
    expect(result.resolutions[0].resolverMetadata.llmRetryStatus).toBe('skipped-empty-response');
  });

  it('does not run corrective retry on initial provider error', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit', tagName: 'BUTTON' });
    const provider = vi.fn(async () => {
      throw new Error('provider-down');
    });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit],
        '[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      provider,
    );

    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.resolutions[0].resolverMetadata.llmRetryTriggered).toBe(false);
  });

  it('uses llmRetryTimeoutMs for corrective retry and falls back safely on timeout', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const shell = makeElement({ class: 'shell' }, { text: 'Layout', tagName: 'DIV' });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit', tagName: 'BUTTON' });
    const cancel = makeElement({ 'aria-label': 'cancel' }, { text: 'Submit', tagName: 'BUTTON' });
    const provider = vi.fn(async (request: any) => {
      if (request.mode === 'retry') {
        return await new Promise(() => {});
      }
      return [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[' },
            { selector: '.shell' },
          ],
        },
      ];
    });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        '.shell': [shell],
        '[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
        llmRetryTimeoutMs: 1,
      },
      provider,
    );

    const resolution = result.resolutions[0];
    expect(provider).toHaveBeenCalledTimes(2);
    expect(resolution.resolvedSelector).toBe('[aria-label="submit"]');
    expect(resolution.resolverMetadata.llmRetryTriggered).toBe(true);
    expect(resolution.resolverMetadata.llmRetryTimeoutMs).toBe(1);
    expect(resolution.resolverMetadata.llmRetryStatus).toBe('skipped-timeout');
  });

  it('uses controlSignature-specific snapshots for same normalized URL', async () => {
    const firstNameInput = makeElement({ name: 'firstName' }, { text: 'First Name' });
    const lastNameInput = makeElement({ name: 'lastName' }, { text: 'Last Name' });

    const stepA = makeStep(1, {
      selector: '[name="firstName"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      sourceNodeId: 'shared-node',
      normalizedUrl: 'https://app.test/profile',
      controlSignature: 'sig-a',
    });
    const stepB = makeStep(2, {
      selector: '[name="lastName"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      sourceNodeId: 'shared-node',
      normalizedUrl: 'https://app.test/profile',
      controlSignature: 'sig-b',
    });

    const snapshotCache = makeSnapshotCache({
      'https://app.test/profile|sig-a': makeDocument({
        '[name="firstName"]': [firstNameInput],
        '[name="lastName"]': [],
        '*': [firstNameInput],
      }),
      'https://app.test/profile|sig-b': makeDocument({
        '[name="firstName"]': [],
        '[name="lastName"]': [lastNameInput],
        '*': [lastNameInput],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([stepA, stepB]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    expect(result.resolutions.map(r => r.resolvedSelector)).toEqual([
      '[name="firstName"]',
      '[name="lastName"]',
    ]);
    expect(result.resolutions.every(r => r.resolverMetadata.resolvedBy === 'kept-original')).toBe(true);
  });

  it('falls back to blank controlSignature key when step controlSignature is missing', async () => {
    const emailInput = makeElement({ name: 'email' }, { text: 'Email' });
    const step = makeStep(1, {
      selector: '[name="email"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      sourceNodeId: 'shared-node',
      normalizedUrl: 'https://app.test/profile',
      controlSignature: undefined,
    });

    const snapshotCache = makeSnapshotCache({
      'https://app.test/profile|': makeDocument({
        '[name="email"]': [emailInput],
        '*': [emailInput],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    expect(result.resolutions[0].resolvedSelector).toBe('[name="email"]');
    expect(result.resolutions[0].resolverMetadata.resolvedBy).toBe('kept-original');
  });

  it('uses fingerprint parentSelector hint for parent-scoped deterministic override', async () => {
    const primary = makeElement({ class: 'submit-btn' }, { text: 'Save' });
    const secondary = makeElement({ class: 'submit-btn' }, { text: 'Save Draft' });

    const step = makeStep(1, {
      selector: '.submit-btn',
      selectorPriority: 'class',
      selectorRank: 7,
      sourceNodeId: 'node-1',
      intent: 'click_save',
      fingerprint: {
        selector: '.submit-btn',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        parentSelector: '#profile-form',
        textExcerpt: 'Save',
        attributes: {},
        attributesHash: 'hash-1',
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.submit-btn': [primary, secondary],
        '#profile-form .submit-btn': [primary],
        '*': [primary, secondary],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false, resolverMinScore: 0.6 },
    );

    expect(result.resolutions[0].resolvedSelector).toBe('#profile-form .submit-btn');
    expect(result.resolutions[0].resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('exports node mapping helper with expected priority', () => {
    expect(getSourceNodeId({ nodeId: 'event-node' }, { fromNodeId: 'from-node', toNodeId: 'to-node' }))
      .toBe('event-node');
    expect(getSourceNodeId({ nodeId: null }, { fromNodeId: 'from-node', toNodeId: 'to-node' }))
      .toBe('from-node');
    expect(getSourceNodeId({ nodeId: null }, { fromNodeId: null, toNodeId: 'to-node' }))
      .toBe('to-node');
  });
});
