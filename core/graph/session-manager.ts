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

    const session = this.sessionRepo.getOrCreate(sessionId);
    
    // If it was just created (event_count === 0), log it.
    if (session && session.eventCount === 0) {
      this.logger.log('SessionManager', 'info', 'Created new session', { sessionId });
    }
    
    return session;
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