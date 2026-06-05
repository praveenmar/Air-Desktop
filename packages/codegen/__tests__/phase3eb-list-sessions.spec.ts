import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CodegenService } from '../src/codegen.service';

describe('Phase 3E-B: listRecordedSessions in CodegenService', () => {
  let service: CodegenService;
  let mockDb: any;
  let mockPrepare: any;

  beforeEach(() => {
    service = Object.create(CodegenService.prototype) as CodegenService;
    
    mockPrepare = vi.fn();
    mockDb = {
      prepare: mockPrepare
    };
    (service as any).db = mockDb;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Test 1 & 2: default limits and offset, handles hasMore', () => {
    const mockRows = [
      { sessionId: '1', lastEventAt: 3000, startedAt: 3000, eventCount: 10, status: 'completed' },
      { sessionId: '2', lastEventAt: 2000, startedAt: 2000, eventCount: 5, status: 'completed' },
      { sessionId: '3', lastEventAt: 1000, startedAt: 1000, eventCount: 2, status: 'failed' }
    ];

    const mockAll = vi.fn().mockReturnValue(mockRows);
    mockPrepare.mockReturnValue({ all: mockAll });

    const result = service.listRecordedSessions({ limit: 2, offset: 0 });

    expect(mockPrepare).toHaveBeenCalled();
    const query = mockPrepare.mock.calls[0][0];
    expect(query).toContain('SELECT');
    expect(query).toContain('FROM sessions');
    expect(query).toContain('ORDER BY COALESCE(last_event_at, started_at) DESC');
    expect(query).toContain('LIMIT ? OFFSET ?');
    expect(query).not.toContain('events.payload');
    expect(query).not.toContain('snapshot_html');

    expect(mockAll).toHaveBeenCalledWith(3, 0); // limit + 1 = 3

    expect(result.limit).toBe(2);
    expect(result.offset).toBe(0);
    expect(result.hasMore).toBe(true);
    expect(result.sessions.length).toBe(2);
    expect(result.sessions[0].sessionId).toBe('1');
    expect(result.sessions[1].sessionId).toBe('2');
  });

  it('Test 4: no more rows', () => {
    const mockRows = [
      { sessionId: '1', lastEventAt: 3000, startedAt: 3000, eventCount: 10, status: 'completed' },
      { sessionId: '2', lastEventAt: 2000, startedAt: 2000, eventCount: 5, status: 'completed' }
    ];

    const mockAll = vi.fn().mockReturnValue(mockRows);
    mockPrepare.mockReturnValue({ all: mockAll });

    const result = service.listRecordedSessions({ limit: 2, offset: 0 });

    expect(result.hasMore).toBe(false);
    expect(result.sessions.length).toBe(2);
  });

  it('Test 5: recentDays filter', () => {
    const mockAll = vi.fn().mockReturnValue([]);
    mockPrepare.mockReturnValue({ all: mockAll });

    const mockNow = 1000000000000;
    vi.spyOn(Date, 'now').mockReturnValue(mockNow);

    service.listRecordedSessions({ recentDays: 5 });

    const query = mockPrepare.mock.calls[0][0];
    expect(query).toContain('WHERE started_at >= ?');
    
    // 5 days = 5 * 86400000 = 432000000
    const expectedCutoff = mockNow - 432000000;
    expect(mockAll).toHaveBeenCalledWith(expectedCutoff, 11, 0); // limit 10 + 1
  });

  it('Test 6: missing metadata title/url safely mapped', () => {
    const mockRows = [
      { sessionId: '1', title: null, url: undefined },
      { sessionId: '2', title: 'Valid', url: 'https://test.com' }
    ];

    const mockAll = vi.fn().mockReturnValue(mockRows);
    mockPrepare.mockReturnValue({ all: mockAll });

    const result = service.listRecordedSessions({ limit: 10 });

    expect(result.sessions[0].title).toBeUndefined();
    expect(result.sessions[0].url).toBeUndefined();
    
    expect(result.sessions[1].title).toBe('Valid');
    expect(result.sessions[1].url).toBe('https://test.com');
  });

  it('Test 7: does not call buildSession()', () => {
    const mockAll = vi.fn().mockReturnValue([]);
    mockPrepare.mockReturnValue({ all: mockAll });

    service.buildSession = vi.fn();
    service.listRecordedSessions({});

    expect(service.buildSession).not.toHaveBeenCalled();
  });
});
