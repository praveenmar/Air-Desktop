import { describe, expect, it, vi } from 'vitest';
import { getSessionFlowReviewTool } from '../src/tools/get-session-flow-review';
import { getToolHandlers } from '../src/tools';
import { McpContext } from '../src/context';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

describe('Phase 3E-C: get_session_flow_review MCP Tool', () => {
  it('Test 1: successful response', async () => {
    const mockGetFlowReviewMarkdown = vi.fn().mockReturnValue('AIR Flow Review...');
    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: vi.fn(() => ({
        getFlowReviewMarkdown: mockGetFlowReviewMarkdown,
      } as any)),
    };

    const response = await getSessionFlowReviewTool.handle(
      { sessionId: 'test-session-1' },
      mockContext
    ) as any;

    expect(mockContext.getCodegenService).toHaveBeenCalled();
    expect(mockGetFlowReviewMarkdown).toHaveBeenCalledWith('test-session-1');
    expect(response.content[0].type).toBe('text');

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed._meta.privacy).toBeTruthy();
    expect(parsed.data.markdown).toContain('AIR Flow Review...');
  });

  it('Test 2: invalid args', async () => {
    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: vi.fn(),
    };

    try {
      await getSessionFlowReviewTool.handle({}, mockContext);
      expect.fail('Should have thrown');
    } catch (error: any) {
      expect(error).toBeInstanceOf(McpError);
      expect(error.code).toBe(ErrorCode.InvalidParams);
      expect(error.message).toContain('Invalid arguments');
    }

    try {
      await getSessionFlowReviewTool.handle({ sessionId: '' }, mockContext);
      expect.fail('Should have thrown');
    } catch (error: any) {
      expect(error).toBeInstanceOf(McpError);
      expect(error.code).toBe(ErrorCode.InvalidParams);
      expect(error.message).toContain('Invalid arguments');
    }
  });

  it('Test 3: session not found', async () => {
    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: vi.fn(() => ({
        getFlowReviewMarkdown: vi.fn(() => {
          throw new Error('Session not found: session-x');
        }),
      } as any)),
    };

    try {
      await getSessionFlowReviewTool.handle({ sessionId: 'session-x' }, mockContext);
      expect.fail('Should have thrown');
    } catch (error: any) {
      expect(error).toBeInstanceOf(McpError);
      expect(error.code).toBe(ErrorCode.InvalidRequest);
      expect(error.message).toContain('Session not found: session-x');
    }
  });

  it('Test 4: tool registry', () => {
    const tools = getToolHandlers();
    expect(tools).toContain(getSessionFlowReviewTool);
  });
});
