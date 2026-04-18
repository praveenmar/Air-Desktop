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

  public async updatePointer(sessionId: string | null | undefined, nodeId: string): Promise<void> {
    if (!sessionId) return;
    await this.sessionRepo.updatePointer(sessionId, nodeId);
  }

  public async getLastNode(sessionId: string | null | undefined): Promise<string | null> {
    if (!sessionId) return null;
    return this.sessionRepo.getLastNode(sessionId);
  }
}
