import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  scanCompositeAnchors,
  scanCompositeAnchorsDetailed,
  scanPageAnchors,
  type CompositeAnchor,
} from '@air/shared';

function withDocument<T>(html: string, fn: (document: Document) => T): T {
  const dom = new JSDOM(html);
  try {
    return fn(dom.window.document);
  } finally {
    (dom.window as Window & { close?: () => void }).close?.();
  }
}

function descriptors(anchors: CompositeAnchor[]): string[] {
  return anchors.map((anchor) => anchor.descriptor);
}

describe('composite anchors', () => {
  it('generates form cluster anchors with stable fields and actions', () => {
    withDocument(
      `
      <html><body>
        <form id="profile-form" action="/profile/save">
          <input name="lastName" />
          <input name="firstName" />
          <button data-testid="save-profile">Save</button>
        </form>
      </body></html>
      `,
      (document) => {
        const anchors = scanCompositeAnchors(document);
        const formAnchor = anchors.find((anchor) => anchor.kind === 'form_cluster');

        expect(formAnchor).toBeTruthy();
        expect(formAnchor?.descriptor).toContain('form_cluster');
        expect(formAnchor?.tokens).toEqual([
          'button.testid:save-profile',
          'form.action:/profile/save',
          'input.name:firstname',
          'input.name:lastname',
        ]);
      },
    );
  });

  it('generates dialog anchors using title and actions', () => {
    withDocument(
      `
      <html><body>
        <div role="dialog" aria-label="Delete user">
          <h2>Delete User</h2>
          <button>Cancel</button>
          <button data-testid="confirm-delete">Delete</button>
        </div>
      </body></html>
      `,
      (document) => {
        const anchors = scanCompositeAnchors(document);
        const dialogAnchor = anchors.find((anchor) => anchor.kind === 'dialog_actions');

        expect(dialogAnchor).toBeTruthy();
        expect(dialogAnchor?.tokens).toContain('dialog.title:delete user');
        expect(dialogAnchor?.tokens).toContain('button.testid:confirm-delete');
        expect(dialogAnchor?.tokens).toContain('button.text:cancel');
      },
    );
  });

  it('generates stable table row anchors and skips volatile row identifiers', () => {
    withDocument(
      `
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
      (document) => {
        const anchors = scanCompositeAnchors(document).filter((anchor) => anchor.kind === 'table_row');

        expect(anchors).toHaveLength(1);
        expect(anchors[0].tokens).toContain('row:alice');
        expect(anchors[0].tokens).toContain('header:actions');
        expect(anchors[0].tokens).toContain('header:name');
        expect(anchors[0].tokens).toContain('header:status');
        expect(anchors[0].descriptor).not.toContain('123456');
      },
    );
  });

  it('generates menu group anchors with grouped options', () => {
    withDocument(
      `
      <html><body>
        <div role="group" aria-label="Row actions">
          <button>Edit</button>
          <button>Delete</button>
          <button>Archive</button>
        </div>
      </body></html>
      `,
      (document) => {
        const anchors = scanCompositeAnchors(document);
        const menuAnchor = anchors.find((anchor) => anchor.kind === 'menu_group');

        expect(menuAnchor).toBeTruthy();
        expect(menuAnchor?.tokens).toContain('menu.label:row actions');
        expect(menuAnchor?.tokens).toContain('button.text:edit');
        expect(menuAnchor?.tokens).toContain('button.text:delete');
      },
    );
  });

  it('keeps flat anchors unchanged', () => {
    withDocument(
      `
      <html><body>
        <h1>Login</h1>
        <form id="login-form">
          <input name="username" />
          <button>Submit</button>
        </form>
      </body></html>
      `,
      (document) => {
        expect(scanPageAnchors(document, '/login')).toEqual([
          'BUTTON:text=Submit',
          'FORM:id=login-form',
          'H1:text=Login',
          'INPUT:name=username',
          'URL:/login',
        ]);
      },
    );
  });

  it('enforces per-kind and per-page composite caps', () => {
    withDocument(
      `
      <html><body>
        ${Array.from({ length: 5 }, (_, index) => `
          <form id="form-${index}">
            <input name="field-${index}" />
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
      (document) => {
        const result = scanCompositeAnchorsDetailed(document);
        const kindCounts = result.anchors.reduce<Record<string, number>>((acc, anchor) => {
          acc[anchor.kind] = (acc[anchor.kind] || 0) + 1;
          return acc;
        }, {});

        expect(result.anchors.length).toBeLessThanOrEqual(8);
        expect(kindCounts.form_cluster || 0).toBeLessThanOrEqual(3);
        expect(kindCounts.dialog_actions || 0).toBeLessThanOrEqual(3);
        expect(result.droppedCompositeCount).toBeGreaterThan(0);
      },
    );
  });

  it('reports oversized containers with a deterministic skip reason', () => {
    withDocument(
      `
      <html><body>
        <form id="large-form">
          ${Array.from({ length: 260 }, (_, index) => `<div><input name="field-${index}" /></div>`).join('')}
        </form>
      </body></html>
      `,
      (document) => {
        const result = scanCompositeAnchorsDetailed(document);

        expect(result.anchors).toEqual([]);
        expect(result.skippedCompositeReasons).toContain('container_too_large');
        expect(result.inspectedContainerCount).toBeGreaterThan(0);
      },
    );
  });

  it('produces deterministic descriptors regardless of DOM order for sortable tokens', () => {
    withDocument(
      `
      <html><body>
        <form id="sorted-form">
          <input name="zeta" />
          <input name="alpha" />
          <button>Save</button>
        </form>
      </body></html>
      `,
      (document) => {
        const [anchor] = scanCompositeAnchors(document).filter((item) => item.kind === 'form_cluster');

        expect(anchor.tokens).toEqual([
          'button.text:save',
          'input.name:alpha',
          'input.name:zeta',
        ]);
        expect(descriptors([anchor])).toEqual([anchor.descriptor]);
      },
    );
  });
});
