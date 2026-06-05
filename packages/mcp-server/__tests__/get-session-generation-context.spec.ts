import { describe, expect, it, vi } from 'vitest';
import { getSessionGenerationContextTool } from '../src/tools/get-session-generation-context';
import { getToolHandlers } from '../src/tools';
import { McpContext } from '../src/context';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

describe('Phase 3E-D: get_session_generation_context MCP Tool', () => {
  const mockSteps = [
    { stepIndex: 1, locatorStatus: 'resolved', assertions: [{}] },
    { stepIndex: 2, locatorStatus: 'unresolved', assertions: [] },
    { stepIndex: 3, locatorStatus: 'not_applicable', assertions: [{}, {}] },
  ];

  const mockGenerationContext = {
    schemaVersion: 'air:generation-context:v1',
    sessionId: 'session-1',
    url: 'https://test.com',
    recordedAt: 12345,
    metadata: { source: 'air-db' },
    steps: mockSteps,
  };

  it('Test 1: successful response', async () => {
    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: vi.fn(() => ({
        buildGenerationContext: vi.fn(() => mockGenerationContext),
      } as any)),
    };

    const response = await getSessionGenerationContextTool.handle(
      { sessionId: 'session-1' },
      mockContext
    ) as any;

    expect(mockContext.getCodegenService).toHaveBeenCalled();
    expect(response.content[0].type).toBe('text');

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed._meta.privacy).toBeTruthy();
    expect(parsed.data.schemaVersion).toBe('air:mcp-generation-context-response:v1');
    expect(parsed.data.generationContextSchemaVersion).toBe('air:generation-context:v1');
    expect(Array.isArray(parsed.data.steps)).toBe(true);
  });

  it('Test 2: pagination', async () => {
    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: vi.fn(() => ({
        buildGenerationContext: vi.fn(() => mockGenerationContext),
      } as any)),
    };

    const response = await getSessionGenerationContextTool.handle(
      { sessionId: 'session-1', offset: 1, limit: 1 },
      mockContext
    ) as any;

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.data.totalSteps).toBe(3);
    expect(parsed.data.offset).toBe(1);
    expect(parsed.data.limit).toBe(1);
    expect(parsed.data.hasMore).toBe(true);
    expect(parsed.data.steps.length).toBe(1);
    expect(parsed.data.steps[0].stepIndex).toBe(2);
  });

  it('Test 3: limit clamped', async () => {
    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: vi.fn(() => ({
        buildGenerationContext: vi.fn(() => mockGenerationContext),
      } as any)),
    };

    const response = await getSessionGenerationContextTool.handle(
      { sessionId: 'session-1', limit: 999 },
      mockContext
    ) as any;

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.data.limit).toBe(100);
  });

  it('Test 4: offset beyond end', async () => {
    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: vi.fn(() => ({
        buildGenerationContext: vi.fn(() => mockGenerationContext),
      } as any)),
    };

    const response = await getSessionGenerationContextTool.handle(
      { sessionId: 'session-1', offset: 999 },
      mockContext
    ) as any;

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.data.steps).toEqual([]);
    expect(parsed.data.hasMore).toBe(false);
  });

  it('Test 5: summary counts', async () => {
    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: vi.fn(() => ({
        buildGenerationContext: vi.fn(() => mockGenerationContext),
      } as any)),
    };

    const response = await getSessionGenerationContextTool.handle(
      { sessionId: 'session-1' },
      mockContext
    ) as any;

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.data.summary.resolvedSteps).toBe(1);
    expect(parsed.data.summary.unresolvedSteps).toBe(1);
    expect(parsed.data.summary.notApplicableSteps).toBe(1);
    expect(parsed.data.summary.assertionCount).toBe(3);
  });

  it('Test 6: invalid args', async () => {
    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: vi.fn(),
    };

    try {
      await getSessionGenerationContextTool.handle({}, mockContext);
      expect.fail('Should have thrown');
    } catch (error: any) {
      expect(error).toBeInstanceOf(McpError);
      expect(error.code).toBe(ErrorCode.InvalidParams);
    }
  });

  it('Test 7: session not found', async () => {
    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: vi.fn(() => ({
        buildGenerationContext: vi.fn(() => {
          throw new Error('Session not found: session-x');
        }),
      } as any)),
    };

    try {
      await getSessionGenerationContextTool.handle({ sessionId: 'session-x' }, mockContext);
      expect.fail('Should have thrown');
    } catch (error: any) {
      expect(error).toBeInstanceOf(McpError);
      expect(error.code).toBe(ErrorCode.InvalidRequest);
      expect(error.message).toContain('Session not found: session-x');
    }
  });

  it('Test 8: registry', () => {
    const tools = getToolHandlers();
    expect(tools).toContain(getSessionGenerationContextTool);
  });

  it('Test 9: no raw DOM fields', async () => {
    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: vi.fn(() => ({
        buildGenerationContext: vi.fn(() => mockGenerationContext),
      } as any)),
    };

    const response = await getSessionGenerationContextTool.handle(
      { sessionId: 'session-1' },
      mockContext
    ) as any;

    const text = response.content[0].text;
    expect(text).not.toContain('snapshotHtml');
    expect(text).not.toContain('events.payload');
    expect(text).not.toContain('snapshot_html');
    expect(text).not.toContain('rawHtml');
  });
});
