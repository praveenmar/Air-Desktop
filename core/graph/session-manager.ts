// Purpose: Business logic wrapper for Session management.
// Prototype Origin: graph-builder.js (getOrCreateSession, updateSessionPointer, getSessionLastNode)
// Changes: Now uses injected SessionRepository and DebugLogger.

import { SessionRepository } from '../db/repositories/session.repository';
import { DebugLogger } from '../logger/debug-logger';
import { Session } from '../types';

export class SessionManager {
  constructor(
    private sessionRepo: SessionRepository,
    private logger: DebugLogger
  ) {}

  private async logWithContext(
    level: 'debug' | 'info' | 'warn' | 'error' | 'decision',
    message: string,
    data: Record<string, unknown> = {},
    sessionId: string | null = null,
    traceId: string | null = null
  ): Promise<void> {
    const resolvedSessionId = sessionId ?? null;
    const resolvedTraceId = traceId ?? null;
    await this.logger.log(
      'SessionManager',
      level,
      message,
      {
        ...data,
        sessionId: resolvedSessionId,
        traceId: resolvedTraceId,
      },
      resolvedSessionId,
      resolvedTraceId
    );
  }

  public async getOrCreateSession(sessionId: string | null | undefined): Promise<Session | null> {
    if (!sessionId) return null;

    const existing = await this.sessionRepo.findById(sessionId);
    if (existing) {
      await this.logWithContext('debug', 'Session already active - reusing existing session pointer', {}, sessionId, null);
      return existing;
    }

    const created = await this.sessionRepo.getOrCreate(sessionId);
    if (created) {
      await this.logWithContext('info', 'Session created (first event observed for this recording flow)', {}, sessionId, null);
    }

    return created;
  }

  public async updatePointer(
    sessionId: string | null | undefined,
    tabId: string | null | undefined,
    nodeId: string,
    eventTimestamp: number | null | undefined
  ): Promise<void> {
    if (!sessionId || !tabId) return;
    const safeEventTimestamp = typeof eventTimestamp === 'number' && Number.isFinite(eventTimestamp)
      ? eventTimestamp
      : Date.now();
    if (tabId === 'tab-legacy') {
      await this.logWithContext('info', 'TAB_LEGACY_FALLBACK_USED', {
        reason: 'missing_tab_id_on_event',
        tabId,
        nodeId,
        eventTimestamp: safeEventTimestamp,
      }, sessionId, null);
    }
    await this.sessionRepo.updatePointerForTab(sessionId, tabId, nodeId, safeEventTimestamp);
    await this.logWithContext('info', 'TAB_NODE_POINTER_UPDATED', {
      tabId,
      nodeId,
      source: 'session_tab_state',
      eventTimestamp: safeEventTimestamp,
    }, sessionId, null);
  }

  public async getLastNode(sessionId: string | null | undefined, tabId: string | null | undefined): Promise<string | null> {
    if (!sessionId || !tabId) return null;
    if (tabId === 'tab-legacy') {
      await this.logWithContext('info', 'TAB_LEGACY_FALLBACK_USED', {
        reason: 'missing_tab_id_on_event',
        tabId,
      }, sessionId, null);
    }
    const nodeId = await this.sessionRepo.getLastNodeForTab(sessionId, tabId);
    if (nodeId) {
      await this.logWithContext('debug', 'TAB_NODE_POINTER_READ', {
        tabId,
        nodeId,
        source: 'session_tab_state',
      }, sessionId, null);
      return nodeId;
    }
    await this.logWithContext('debug', 'TAB_NODE_POINTER_MISSING', {
      tabId,
      source: 'session_tab_state',
    }, sessionId, null);
    return null;
  }

  public async getTabState(
    sessionId: string | null | undefined,
    tabId: string | null | undefined
  ): Promise<{ lastNodeId: string | null; lastEventAt: number | null } | null> {
    if (!sessionId || !tabId) return null;
    if (tabId === 'tab-legacy') {
      await this.logWithContext('info', 'TAB_LEGACY_FALLBACK_USED', {
        reason: 'missing_tab_id_on_event',
        tabId,
      }, sessionId, null);
    }

    const tabState = await this.sessionRepo.getTabState(sessionId, tabId);
    if (tabState) {
      await this.logWithContext('debug', 'TAB_STATE_READ', {
        tabId,
        nodeId: tabState.lastNodeId,
        lastEventAt: tabState.lastEventAt,
        source: 'session_tab_state',
      }, sessionId, null);
      return tabState;
    }

    await this.logWithContext('debug', 'TAB_STATE_MISSING', {
      tabId,
      source: 'session_tab_state',
    }, sessionId, null);
    return null;
  }
}
