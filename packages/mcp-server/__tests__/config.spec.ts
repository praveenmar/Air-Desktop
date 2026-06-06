import { describe, expect, it } from 'vitest';
import { resolveHttpPort } from '../src/config';

describe('Phase 3E HTTP Hardening: config helpers', () => {
  it('does not use generic PORT env fallback', () => {
    const port = resolveHttpPort([], {
      PORT: '9999',
    });

    expect(port).toBe(3333);
  });

  it('uses AIR_MCP_PORT when provided', () => {
    const port = resolveHttpPort([], {
      AIR_MCP_PORT: '4444',
      PORT: '9999',
    });

    expect(port).toBe(4444);
  });

  it('defaults to 3333 when no explicit AIR port is configured', () => {
    const port = resolveHttpPort([], {});

    expect(port).toBe(3333);
  });
});
