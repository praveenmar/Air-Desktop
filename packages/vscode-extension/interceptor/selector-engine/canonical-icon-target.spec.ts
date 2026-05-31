// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCanonicalTargetInternal } from './canonical-target.js';

describe('SVG/Icon Canonicalization via resolveCanonicalTargetInternal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('Test 1: SVG path inside button canonicalizes to button', () => {
    document.body.innerHTML = `
      <button aria-label="Search">
        <svg><path id="target-path"></path></svg>
      </button>
    `;
    const rawTarget = document.getElementById('target-path');
    const button = document.querySelector('button');
    const result = resolveCanonicalTargetInternal(rawTarget, {});

    expect(result.canonicalDiffers).toBe(true);
    expect(result.canonicalTarget).toBe(button);
    expect(result.canonicalReason).toBe('svg-icon-owned-by-actionable-parent');
  });

  it('Test 2: SVG inside link canonicalizes to link', () => {
    document.body.innerHTML = `
      <a href="/settings" aria-label="Settings">
        <svg id="target-svg"><path></path></svg>
      </a>
    `;
    const rawTarget = document.getElementById('target-svg');
    const link = document.querySelector('a');
    const result = resolveCanonicalTargetInternal(rawTarget, {});

    expect(result.canonicalDiffers).toBe(true);
    expect(result.canonicalTarget).toBe(link);
    expect(result.canonicalReason).toBe('svg-icon-owned-by-actionable-parent');
  });

  it('Test 3: SVG inside role=button canonicalizes to role owner', () => {
    document.body.innerHTML = `
      <div role="button" aria-label="Close">
        <svg><use id="target-use"></use></svg>
      </div>
    `;
    const rawTarget = document.getElementById('target-use');
    const div = document.querySelector('div');
    const result = resolveCanonicalTargetInternal(rawTarget, {});

    expect(result.canonicalDiffers).toBe(true);
    expect(result.canonicalTarget).toBe(div);
    expect(result.canonicalReason).toBe('svg-icon-owned-by-actionable-parent');
  });

  it('Test 4: Standalone SVG fails closed', () => {
    document.body.innerHTML = `
      <div>
        <svg id="target-svg"><path></path></svg>
      </div>
    `;
    const rawTarget = document.getElementById('target-svg');
    const result = resolveCanonicalTargetInternal(rawTarget, {});

    expect(result.canonicalDiffers).toBe(false);
    expect(result.canonicalTarget).toBe(null);
    expect(result.blockedReason).not.toBeNull();
  });

  it('Test 5: Direct button click unchanged', () => {
    document.body.innerHTML = `
      <button id="target-btn">Login</button>
    `;
    const rawTarget = document.getElementById('target-btn');
    const result = resolveCanonicalTargetInternal(rawTarget, {});

    expect(result.canonicalDiffers).toBe(false);
  });

  it('Test 6: Input selector behavior unchanged', () => {
    document.body.innerHTML = `
      <input id="target-input" name="username" placeholder="Username">
    `;
    const rawTarget = document.getElementById('target-input');
    const result = resolveCanonicalTargetInternal(rawTarget, {});

    expect(result.canonicalDiffers).toBe(false);
  });

  it('Test 7: Option-panel behavior unchanged', () => {
    document.body.innerHTML = `
      <div class="oxd-select-text">-- Select --</div>
    `;
    const rawTarget = document.querySelector('.oxd-select-text');
    const result = resolveCanonicalTargetInternal(rawTarget, { eventType: 'custom-control-open' });

    // The existing custom control descendant traversal should run, but fail because it has no meaningful descendant
    expect(result.blockedReason).not.toBeNull();
    // But importantly, it shouldn't hit the SVG reason.
    expect(result.blockedReason).not.toBe('svg-icon-no-actionable-owner');
    expect(result.blockedReason).not.toBe('not-an-icon-node');
    expect(result.canonicalDiffers).toBe(false);
  });
});
