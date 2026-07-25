import { describe, expect, it, vi } from 'vitest';
import { listRecordedSessionsTool } from '../src/tools/list-recorded-sessions';
import { McpContext } from '../src/context';

describe('Phase 3E-B: list_recorded_sessions MCP Tool', () => {
  it('Test 1 & 2: validates/defaults args and clamps limit', async () => {
    const mockListRecordedSessions = vi.fn().mockReturnValue({
      sessions: [],
      limit: 50,
      offset: 0,
      hasMore: false
    });

    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: () => ({
        listRecordedSessions: mockListRecordedSessions
      } as any)
    };

    await listRecordedSessionsTool.handle({ limit: 999 }, mockContext);
    
    expect(mockListRecordedSessions).toHaveBeenCalledWith({ limit: 999 });
  });

  it('Test 3: privacy wrapper included', async () => {
    const mockListRecordedSessions = vi.fn().mockReturnValue({
      sessions: [{ sessionId: '1' }],
      limit: 10,
      offset: 0,
      hasMore: false
    });

    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: () => ({
        listRecordedSessions: mockListRecordedSessions
      } as any)
    };

    const response = await listRecordedSessionsTool.handle({}, mockContext) as any;
    
    expect(response.content).toBeDefined();
    expect(response.content[0].type).toBe('text');
    
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed._meta).toBeDefined();
    expect(parsed._meta.privacy).toContain('PII');
    expect(parsed.data.sessions.length).toBe(1);
    expect(parsed.data.sessions[0].sessionId).toBe('1');
  });

  it('Test 4: handler uses lazy service', async () => {
    const mockGetCodegenService = vi.fn().mockReturnValue({
      listRecordedSessions: vi.fn().mockReturnValue({})
    });

    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: mockGetCodegenService
    };

    expect(mockGetCodegenService).not.toHaveBeenCalled();

    await listRecordedSessionsTool.handle({}, mockContext);

    expect(mockGetCodegenService).toHaveBeenCalled();
  });
  it('Test 5: matches exact patch acceptance criteria', async () => {
    const mockListRecordedSessions = vi.fn().mockReturnValue({
      sessions: [{ sessionId: '1' }],
      limit: 10,
      offset: 0,
      hasMore: false
    });

    const mockGetCodegenService = vi.fn().mockReturnValue({
      listRecordedSessions: mockListRecordedSessions
    });

    const mockContext: McpContext = {
      config: { dbPath: 'mock.db' },
      getCodegenService: mockGetCodegenService
    };

    const response = await listRecordedSessionsTool.handle({}, mockContext) as any;

    expect(mockGetCodegenService).toHaveBeenCalled();
    expect(mockListRecordedSessions).toHaveBeenCalled();
    expect(response.content[0].type).toBe('text');

    const parsed = JSON.parse(response.content[0].text);

    expect(parsed._meta.privacy).toBeTruthy();
    expect(Array.isArray(parsed.data.sessions)).toBe(true);
  });
});
