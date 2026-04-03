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

  public getOrCreateSession(sessionId: string | null | undefined): Session | null {
    if (!sessionId) return null;

    const existing = this.sessionRepo.findById(sessionId);
    if (existing) {
      this.logger.log('SessionManager', 'debug', 'Session already active - reusing existing session pointer', { sessionId });
      return existing;
    }

    const created = this.sessionRepo.getOrCreate(sessionId);
    if (created) {
      this.logger.log('SessionManager', 'info', 'Session created (first event observed for this recording flow)', { sessionId });
    }

    return created;
  }

  public updatePointer(sessionId: string | null | undefined, nodeId: string): void {
    if (!sessionId) return;
    this.sessionRepo.updatePointer(sessionId, nodeId);
  }

  public getLastNode(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null;
    return this.sessionRepo.getLastNode(sessionId);
  }
}
