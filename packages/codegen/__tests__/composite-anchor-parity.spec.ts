import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';
import {
  scanCompositeAnchors,
  scanPageAnchors,
  type CompositeAnchor,
} from '@air/shared';

const require = createRequire(import.meta.url);
const { AIRInterceptor } = require('../../vscode-extension/interceptor.js') as {
  AIRInterceptor: {
    prototype: {
      scanPageAnchors: (root?: Document | Element) => string[];
      scanCompositeAnchors: (root?: Document | Element) => CompositeAnchor[];
    };
  };
};

type InterceptorScanner = {
    scanPageAnchors: (root?: Document | Element) => string[];
    scanCompositeAnchors: (root?: Document | Element) => CompositeAnchor[];
  };

type RuntimeGlobals = {
  window?: Window & typeof globalThis;
  document?: Document;
  Element?: typeof Element;
  HTMLElement?: typeof HTMLElement;
  HTMLInputElement?: typeof HTMLInputElement;
  HTMLTextAreaElement?: typeof HTMLTextAreaElement;
  HTMLSelectElement?: typeof HTMLSelectElement;
  Node?: typeof Node;
};

function withBrowserGlobals<T>(html: string, fn: (document: Document) => T): T {
  const dom = new JSDOM(html);
  const noopFetch = (() => Promise.resolve(new Response())) as typeof fetch;
  const windowLike = dom.window as Window & typeof globalThis & {
    __air_rawFetch?: typeof fetch;
    __air_gmSend?: undefined;
    fetch?: typeof fetch;
  };
  windowLike.fetch = noopFetch;
  windowLike.__air_rawFetch = noopFetch;

  const runtime = globalThis as unknown as RuntimeGlobals;
  const previous = {
    window: runtime.window,
    document: runtime.document,
    Element: runtime.Element,
    HTMLElement: runtime.HTMLElement,
    HTMLInputElement: runtime.HTMLInputElement,
    HTMLTextAreaElement: runtime.HTMLTextAreaElement,
    HTMLSelectElement: runtime.HTMLSelectElement,
    Node: runtime.Node,
  };

  runtime.window = windowLike;
  runtime.document = dom.window.document;
  runtime.Element = windowLike.Element;
  runtime.HTMLElement = windowLike.HTMLElement;
  runtime.HTMLInputElement = windowLike.HTMLInputElement;
  runtime.HTMLTextAreaElement = windowLike.HTMLTextAreaElement;
  runtime.HTMLSelectElement = windowLike.HTMLSelectElement;
  runtime.Node = windowLike.Node;

  try {
    return fn(dom.window.document);
  } finally {
    runtime.window = previous.window;
    runtime.document = previous.document;
    runtime.Element = previous.Element;
    runtime.HTMLElement = previous.HTMLElement;
    runtime.HTMLInputElement = previous.HTMLInputElement;
    runtime.HTMLTextAreaElement = previous.HTMLTextAreaElement;
    runtime.HTMLSelectElement = previous.HTMLSelectElement;
    runtime.Node = previous.Node;
    (dom.window as Window & { close?: () => void }).close?.();
  }
}

function makeInterceptor() {
  return Object.create(AIRInterceptor.prototype) as InterceptorScanner;
}

function simplifyComposite(anchors: CompositeAnchor[]) {
  return anchors.map((anchor) => ({
    kind: anchor.kind,
    descriptor: anchor.descriptor,
    tokens: [...anchor.tokens],
    confidence: anchor.confidence,
  }));
}

const parityFixtures = [
  {
    name: 'form_cluster',
    html: `
      <html><body>
        <form id="profile-form" action="/profile/save">
          <input name="lastName" />
          <input name="firstName" />
          <button data-testid="save-profile">Save</button>
        </form>
      </body></html>
    `,
  },
  {
    name: 'dialog_actions',
    html: `
      <html><body>
        <div role="dialog" aria-label="Delete user">
          <h2>Delete User</h2>
          <button>Cancel</button>
          <button data-testid="confirm-delete">Delete</button>
        </div>
      </body></html>
    `,
  },
  {
    name: 'table_row',
    html: `
      <html><body>
        <table id="users-table">
          <thead>
            <tr><th>Name</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Alice</td><td>Active</td><td><button>Edit</button></td>
            </tr>
            <tr>
              <td>Order 123456</td><td>Pending</td><td><button>Delete</button></td>
            </tr>
          </tbody>
        </table>
      </body></html>
    `,
  },
  {
    name: 'menu_group',
    html: `
      <html><body>
        <div role="group" aria-label="Row actions">
          <button>Edit</button>
          <button>Delete</button>
          <button>Archive</button>
        </div>
      </body></html>
    `,
  },
  {
    name: 'caps_and_order',
    html: `
      <html><body>
        ${Array.from({ length: 5 }, (_, index) => `
          <form id="form-${index}">
            <input name="zeta-${index}" />
            <input name="alpha-${index}" />
            <button data-testid="save-${index}">Save</button>
          </form>
        `).join('')}
        ${Array.from({ length: 5 }, (_, index) => `
          <div role="dialog" aria-label="Dialog ${index}">
            <h2>Dialog ${index}</h2>
            <button>Cancel</button>
            <button data-testid="confirm-${index}">Confirm</button>
          </div>
        `).join('')}
      </body></html>
    `,
  },
];

describe('composite-anchor parity', () => {
  it.each(parityFixtures)('matches shared and interceptor output for $name', ({ html }) => {
    withBrowserGlobals(html, (document) => {
      const interceptor = makeInterceptor();
      const locationPath = document.defaultView?.location?.pathname || '/';

      const sharedFlat = scanPageAnchors(document, locationPath);
      const interceptorFlat = interceptor.scanPageAnchors(document);
      expect(interceptorFlat).toEqual(sharedFlat);

      const sharedComposite = simplifyComposite(scanCompositeAnchors(document));
      const interceptorComposite = simplifyComposite(interceptor.scanCompositeAnchors(document));
      expect(interceptorComposite).toEqual(sharedComposite);
    });
  });
});
