import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { redactSnapshot, serializeSnapshotExcerpt } from '../src/resolver/excerpt-builder';
import type { CodegenStep } from '../src/types';

function withDomGlobals<T>(fn: () => T): T {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const runtime = globalThis as unknown as {
    document?: Document;
    NodeFilter?: { SHOW_TEXT: number; SHOW_ELEMENT: number };
  };
  const windowLike = dom.window as typeof dom.window & {
    NodeFilter?: { SHOW_TEXT: number; SHOW_ELEMENT: number };
    close?: () => void;
  };
  const previousDocument = runtime.document;
  const previousNodeFilter = runtime.NodeFilter;

  runtime.document = dom.window.document;
  runtime.NodeFilter = windowLike.NodeFilter;

  try {
    return fn();
  } finally {
    runtime.document = previousDocument;
    runtime.NodeFilter = previousNodeFilter;
    windowLike.close?.();
  }
}

function makeStep(overrides: Partial<CodegenStep> = {}): CodegenStep {
  return {
    step: 1,
    intent: 'input_email',
    action: 'input',
    selector: 'input[name="email"]',
    selectorPriority: 'attribute',
    selectorRank: 3,
    sourceNodeId: 'node-1',
    assertions: [],
    userAssertions: [],
    confidence: 1,
    sampleSize: 1,
    pageUrl: 'https://example.test/form',
    ...overrides,
  };
}

describe('excerpt-builder redaction', () => {
  it('preserves selector-relevant attributes', () => {
    const redacted = withDomGlobals(() => redactSnapshot(
      '<button id="save-btn" name="save" role="button" aria-label="Save" data-testid="save-primary" data-cy="save-cy" data-qa="save-qa" href="/save" placeholder="Save" for="save-input" type="button">Save</button>',
    ));

    expect(redacted).toContain('id="save-btn"');
    expect(redacted).toContain('name="save"');
    expect(redacted).toContain('role="button"');
    expect(redacted).toContain('aria-label="Save"');
    expect(redacted).toContain('data-testid="save-primary"');
    expect(redacted).toContain('data-cy="save-cy"');
    expect(redacted).toContain('data-qa="save-qa"');
    expect(redacted).toContain('href="/save"');
    expect(redacted).toContain('placeholder="Save"');
    expect(redacted).toContain('for="save-input"');
    expect(redacted).toContain('type="button"');
  });

  it('preserves radio, checkbox, and option values', () => {
    const redacted = withDomGlobals(() => redactSnapshot(
      '<div><input type="radio" value="admin"><input type="checkbox" value="newsletter"><select><option value="india">India</option></select></div>',
    ));

    expect(redacted).toContain('type="radio" value="admin"');
    expect(redacted).toContain('type="checkbox" value="newsletter"');
    expect(redacted).toContain('<option value="india">India</option>');
  });

  it('preserves radio and checkbox values in legacy fallback redaction', () => {
    const runtime = globalThis as unknown as { document?: Document; NodeFilter?: unknown };
    const previousDocument = runtime.document;
    const previousNodeFilter = runtime.NodeFilter;
    delete runtime.document;
    delete runtime.NodeFilter;

    try {
      const redacted = redactSnapshot(
        '<div><input type="radio" value="admin"><input type="checkbox" value="newsletter"><input type="text" value="alice@example.com"></div>',
      );

      expect(redacted).toContain('type="radio" value="admin"');
      expect(redacted).toContain('type="checkbox" value="newsletter"');
      expect(redacted).toContain('type="text" value="REDACTED"');
      expect(redacted).not.toContain('alice@example.com');
    } finally {
      runtime.document = previousDocument;
      runtime.NodeFilter = previousNodeFilter;
    }
  });

  it('redacts text-like input values', () => {
    const redacted = withDomGlobals(() => redactSnapshot(
      '<form><input type="text" value="Alice"><input type="email" value="alice@example.com"><input type="password" value="supersecret"></form>',
    ));

    expect(redacted).toContain('type="text" value="REDACTED"');
    expect(redacted).toContain('type="email" value="REDACTED"');
    expect(redacted).toContain('type="password" value="REDACTED"');
    expect(redacted).not.toContain('alice@example.com');
    expect(redacted).not.toContain('supersecret');
  });

  it('redacts textarea content', () => {
    const redacted = withDomGlobals(() => redactSnapshot(
      '<textarea>Call me at 9876543210 or alice@example.com</textarea>',
    ));

    expect(redacted).toContain('<textarea>REDACTED</textarea>');
    expect(redacted).not.toContain('9876543210');
    expect(redacted).not.toContain('alice@example.com');
  });

  it('redacts sensitive text-node substrings and preserves normal ui text', () => {
    const redacted = withDomGlobals(() => redactSnapshot(
      '<div>Email alice@example.com Phone 9876543210 Token abcdefghijklmnopqrstuvwx UUID 123e4567-e89b-12d3-a456-426614174000 <button>Submit</button></div>',
    ));

    expect(redacted).toContain('Email REDACTED');
    expect(redacted).toContain('Phone REDACTED');
    expect(redacted).toContain('Token REDACTED');
    expect(redacted).toContain('UUID REDACTED');
    expect(redacted).toContain('<button>Submit</button>');
    expect(redacted).not.toContain('alice@example.com');
    expect(redacted).not.toContain('9876543210');
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwx');
    expect(redacted).not.toContain('123e4567-e89b-12d3-a456-426614174000');
  });

  it('strips script, style, template, meta, and noscript content from excerpts', () => {
    const redacted = withDomGlobals(() => redactSnapshot(
      '<div><script>const secretToken = "abcdefghijklmnopqrstuvwx";</script><style>.x{content:"alice@example.com"}</style><template>9876543210</template><meta content="alice@example.com"><noscript>hidden@example.com</noscript><span>Visible</span></div>',
    ));

    expect(redacted).toContain('<div><span>Visible</span></div>');
    expect(redacted).not.toContain('<script');
    expect(redacted).not.toContain('<style');
    expect(redacted).not.toContain('<template');
    expect(redacted).not.toContain('<meta');
    expect(redacted).not.toContain('<noscript');
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwx');
    expect(redacted).not.toContain('alice@example.com');
    expect(redacted).not.toContain('9876543210');
  });

  it('serializes valid html after pruning and ast redaction', () => {
    const dom = new JSDOM(`
      <html>
        <body>
          <form id="profile-form">
            <div class="field">
              <label for="email">Email</label>
              <input id="email" name="email" type="email" value="alice@example.com" />
            </div>
            <div class="summary">
              Contact alice@example.com 9876543210
            </div>
          </form>
        </body>
      </html>
    `);

    const result = serializeSnapshotExcerpt(
      dom.window.document,
      makeStep(),
      2000,
    );

    expect(result.mode).toBe('target-selector');
    expect(result.excerpt).toContain('name="email"');
    expect(result.excerpt).toContain('type="email"');
    expect(result.excerpt).toContain('value="REDACTED"');
    expect(result.excerpt).not.toContain('alice@example.com');
    expect(result.excerpt).not.toContain('9876543210');

    const reparsed = new JSDOM(`<body>${result.excerpt}</body>`);
    const domWindow = dom.window as typeof dom.window & { close?: () => void };
    const reparsedWindow = reparsed.window as typeof reparsed.window & { close?: () => void };
    expect(reparsed.window.document.querySelector('input[name="email"]')).not.toBeNull();

    domWindow.close?.();
    reparsedWindow.close?.();
  });
});
