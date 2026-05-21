// Purpose: A lightweight HTTP server for the interceptor to POST events to.

import * as http from 'http';
import { ZodError } from 'zod';
import { GraphBuilder } from '../../core/graph/graph-builder';
import { AIREventSchema } from '../../core/types';
import {
  isSelectorDiagnosticsEnabled,
  SelectorCaptureDiagnosticsWriter,
  type SelectorCaptureDiagnosticsWriterLike,
} from '../../core/diagnostics/selector-capture-diagnostics';

export interface EventServerExtraHandler {
  (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> | boolean;
}

export interface EventServerOptions {
  getActiveSessionId: () => string | null;
  extraHandler?: EventServerExtraHandler;
  selectorDiagnosticsWriter?: SelectorCaptureDiagnosticsWriterLike;
}

export class EventServer {
  private server: http.Server;
  private port = 0;
  private activeSessionIdGetter: () => string | null;
  private extraHandler?: EventServerExtraHandler;
  private selectorDiagnosticsWriter: SelectorCaptureDiagnosticsWriterLike | null = null;

  constructor(
    private graphBuilder: GraphBuilder,
    activeSessionIdGetterOrOptions: (() => string | null) | EventServerOptions
  ) {
    if (typeof activeSessionIdGetterOrOptions === 'function') {
      this.activeSessionIdGetter = activeSessionIdGetterOrOptions;
      this.extraHandler = undefined;
    } else {
      this.activeSessionIdGetter = activeSessionIdGetterOrOptions.getActiveSessionId;
      this.extraHandler = activeSessionIdGetterOrOptions.extraHandler;
      this.selectorDiagnosticsWriter = activeSessionIdGetterOrOptions.selectorDiagnosticsWriter ?? null;
    }

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          console.log('[EventServer] Started', { port: this.port });
          resolve(this.port);
        } else {
          reject(new Error('Failed to bind EventServer port'));
        }
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  public getPort(): number {
    return this.port;
  }

  private extractValidationIssues(error: unknown): string[] {
    if (!(error instanceof ZodError)) {
      return [];
    }

    return error.issues.slice(0, 8).map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    });
  }

  private extractEventId(rawEvent: unknown): string | undefined {
    if (!rawEvent || typeof rawEvent !== 'object' || !('id' in rawEvent)) return undefined;
    const idValue = (rawEvent as { id?: unknown }).id;
    return typeof idValue === 'string' ? idValue : undefined;
  }

  private extractEventType(rawEvent: unknown): string | undefined {
    if (!rawEvent || typeof rawEvent !== 'object' || !('type' in rawEvent)) return undefined;
    const typeValue = (rawEvent as { type?: unknown }).type;
    return typeof typeValue === 'string' ? typeValue : undefined;
  }

  private extractSessionId(rawEvent: unknown): string | undefined {
    if (!rawEvent || typeof rawEvent !== 'object' || !('sessionId' in rawEvent)) return undefined;
    const sessionValue = (rawEvent as { sessionId?: unknown }).sessionId;
    return typeof sessionValue === 'string' ? sessionValue : undefined;
  }

  private coerceSnapshotField(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value;
    }

    return {
      html: value,
      metrics: {
        coercedFromString: true,
        source: 'event-server-compat',
      },
    };
  }

  private normalizeIncomingEventPayload(rawEvent: unknown): unknown {
    if (!rawEvent || typeof rawEvent !== 'object') {
      return rawEvent;
    }

    const candidate = rawEvent as Record<string, unknown>;
    let coercedFields: string[] = [];
    const normalized: Record<string, unknown> = { ...candidate };

    if ('pageSnapshot' in candidate && typeof candidate.pageSnapshot === 'string') {
      normalized.pageSnapshot = this.coerceSnapshotField(candidate.pageSnapshot);
      coercedFields.push('pageSnapshot');
    }

    if ('pageState' in candidate && typeof candidate.pageState === 'string') {
      normalized.pageState = this.coerceSnapshotField(candidate.pageState);
      coercedFields.push('pageState');
    }

    if ('interactionContext' in candidate && typeof candidate.interactionContext === 'string') {
      normalized.interactionContext = this.coerceSnapshotField(candidate.interactionContext);
      coercedFields.push('interactionContext');
    }

    if (coercedFields.length > 0) {
      console.warn('[EventServer] [COMPAT_SNAPSHOT_COERCE]', {
        eventId: this.extractEventId(rawEvent) || 'unknown',
        type: this.extractEventType(rawEvent) || 'unknown',
        sessionId: this.extractSessionId(rawEvent) || 'unknown',
        coercedFields,
      });
    }

    return normalized;
  }

  private logSchemaFail(rawEvent: unknown, error: unknown): void {
    const issues = this.extractValidationIssues(error);
    console.error('[EventServer] [SCHEMA_FAIL]', {
      eventId: this.extractEventId(rawEvent) || 'unknown',
      type: this.extractEventType(rawEvent) || 'unknown',
      sessionId: this.extractSessionId(rawEvent) || 'unknown',
      error: error instanceof Error ? error.message : String(error),
      issueCount: issues.length,
      issues,
    });
  }

  private logEventDropped(reason: string, rawEvent: unknown, extra: Record<string, unknown> = {}): void {
    console.warn('[EventServer] [EVENT_DROPPED]', {
      reason,
      eventId: this.extractEventId(rawEvent) || 'unknown',
      type: this.extractEventType(rawEvent) || 'unknown',
      sessionId: this.extractSessionId(rawEvent) || 'unknown',
      ...extra,
    });
  }

  private writeSelectorDiagnostics(event: ReturnType<typeof AIREventSchema.parse>): void {
    if (!this.selectorDiagnosticsWriter && isSelectorDiagnosticsEnabled()) {
      this.selectorDiagnosticsWriter = new SelectorCaptureDiagnosticsWriter();
    }
    if (!this.selectorDiagnosticsWriter) return;

    try {
      this.selectorDiagnosticsWriter.writeEventDiagnostic(event);
    } catch (error) {
      console.warn('[EventServer] Selector diagnostics writer failed', {
        eventId: event.id,
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      this.setCorsHeaders(req, res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          port: this.port,
          activeSessionId: this.activeSessionIdGetter(),
          version: 1,
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/events') {
        await this.handleEvents(req, res);
        return;
      }

      if (this.extraHandler) {
        try {
          const handled = await this.extraHandler(req, res);
          if (handled) {
            return;
          }
        } catch (error) {
          console.error('[EventServer] Extra handler failed', error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Internal handler error' }));
          }
          return;
        }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Not found' }));
    } catch (error) {
      console.error('[EventServer] Request handler failure', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Request handling failed' }));
      }
    }
  }

  private async handleEvents(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let parsed: unknown;
    try {
      parsed = await this.readJsonBody(req);
    } catch (error) {
      const message = (error as Error).message;
      console.warn(`[EventServer] Invalid request payload - ${message}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: message }));
      return;
    }

    const activeSessionId = this.activeSessionIdGetter();
    if (!activeSessionId) {
      console.warn('[EventServer] Rejected payload - no active recording session');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'No active recording session' }));
      return;
    }

    const isBatch =
      typeof parsed === 'object' &&
      parsed !== null &&
      'events' in parsed &&
      Array.isArray((parsed as { events?: unknown }).events);

    if (isBatch) {
      const events = (parsed as { events: unknown[] }).events;
      const results: Array<{ success: boolean; eventId?: string; error?: string }> = [];
      let anyFailed = false;
      let anyServerFailure = false;

      for (const rawEvent of events) {
        const eventId = this.extractEventId(rawEvent);
        const normalizedRawEvent = this.normalizeIncomingEventPayload(rawEvent);
        const parseResult = AIREventSchema.safeParse(normalizedRawEvent);

        if (!parseResult.success) {
          anyFailed = true;
          const issues = this.extractValidationIssues(parseResult.error);
          this.logSchemaFail(normalizedRawEvent, parseResult.error);
          this.logEventDropped('schema_validation_failed', normalizedRawEvent, {
            issueCount: issues.length,
            issues,
          });
          results.push({
            success: false,
            eventId,
            error: issues.length > 0 ? issues.join(' | ') : parseResult.error.message,
          });
          continue;
        }

        const parsedEvent = parseResult.data;
        if (parsedEvent.sessionId !== activeSessionId) {
          anyFailed = true;
          console.warn('[EventServer] Session mismatch in batch', {
            incoming: parsedEvent.sessionId,
            active: activeSessionId,
            eventId: parsedEvent.id,
          });
          this.logEventDropped('session_mismatch', rawEvent, {
            incomingSessionId: parsedEvent.sessionId,
            activeSessionId,
          });
          results.push({ success: false, eventId: parsedEvent.id, error: 'Session mismatch' });
          continue;
        }

        try {
          this.writeSelectorDiagnostics(parsedEvent);
          console.log('[EventServer] [EVENT_RECEIVED]', { eventId: parsedEvent.id, type: parsedEvent.type });
          const result = await this.graphBuilder.processEvent(parsedEvent);
          if (!result.success) {
            anyServerFailure = true;
            const graphError = result.error || 'Event processing failed';
            console.warn('[EventServer] [GRAPH_PROCESS_FAIL]', {
              eventId: parsedEvent.id,
              error: graphError,
            });
            this.logEventDropped('graph_processing_failed', normalizedRawEvent, { error: graphError });
            results.push({ success: false, eventId: parsedEvent.id, error: graphError });
            continue;
          }

          console.log('[EventServer] [EVENT_STORED]', { eventId: parsedEvent.id, type: parsedEvent.type });
          console.log('[EventServer] [GRAPH_PROCESSED]', { eventId: parsedEvent.id, stage: result.stage || 'ok' });
          console.log('[EventServer] [PIPELINE_OK]', { eventId: parsedEvent.id, type: parsedEvent.type });
          results.push({ success: true, eventId: parsedEvent.id });
        } catch (error) {
          anyServerFailure = true;
          const message = error instanceof Error ? error.message : String(error);
          console.error('[EventServer] [INTERNAL_FAIL]', {
            eventId: parsedEvent.id,
            type: parsedEvent.type,
            error: message,
          });
          this.logEventDropped('internal_processing_error', normalizedRawEvent, { error: message });
          results.push({ success: false, eventId: parsedEvent.id, error: message });
        }
      }

      const status = anyServerFailure ? 500 : anyFailed ? 400 : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: status === 200, queued: events.length, results }));
      return;
    }

    const normalizedSingleEvent = this.normalizeIncomingEventPayload(parsed);
    const parseResult = AIREventSchema.safeParse(normalizedSingleEvent);
    if (!parseResult.success) {
      const issues = this.extractValidationIssues(parseResult.error);
      this.logSchemaFail(normalizedSingleEvent, parseResult.error);
      this.logEventDropped('schema_validation_failed', normalizedSingleEvent, {
        issueCount: issues.length,
        issues,
      });

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: issues.length > 0 ? issues.join(' | ') : parseResult.error.message,
        issues,
      }));
      return;
    }

    const parsedEvent = parseResult.data;
    if (parsedEvent.sessionId !== activeSessionId) {
      console.warn('[EventServer] Session mismatch', {
        incoming: parsedEvent.sessionId,
        active: activeSessionId,
        eventId: parsedEvent.id,
      });
      this.logEventDropped('session_mismatch', normalizedSingleEvent, {
        incomingSessionId: parsedEvent.sessionId,
        activeSessionId,
      });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Session mismatch' }));
      return;
    }

    this.writeSelectorDiagnostics(parsedEvent);
    console.log('[EventServer] [EVENT_RECEIVED]', { eventId: parsedEvent.id, type: parsedEvent.type });

    try {
      const result = await this.graphBuilder.processEvent(parsedEvent);
      if (!result.success) {
        const graphError = result.error || 'Event processing failed';
        console.warn('[EventServer] [GRAPH_PROCESS_FAIL]', {
          eventId: parsedEvent.id,
          error: graphError,
        });
        this.logEventDropped('graph_processing_failed', normalizedSingleEvent, { error: graphError });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: graphError }));
        return;
      }

      console.log('[EventServer] [EVENT_STORED]', { eventId: parsedEvent.id, type: parsedEvent.type });
      console.log('[EventServer] [GRAPH_PROCESSED]', { eventId: parsedEvent.id, stage: result.stage || 'ok' });
      console.log('[EventServer] [PIPELINE_OK]', { eventId: parsedEvent.id, type: parsedEvent.type });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, queued: 1, result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[EventServer] [INTERNAL_FAIL]', {
        eventId: parsedEvent.id,
        type: parsedEvent.type,
        error: message,
      });
      this.logEventDropped('internal_processing_error', normalizedSingleEvent, { error: message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Internal event processing failure' }));
    }
  }

  private setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
    const originHeader: unknown = req.headers?.origin;
    const origin = Array.isArray(originHeader)
      ? (typeof originHeader[0] === 'string' ? originHeader[0] : undefined)
      : (typeof originHeader === 'string' ? originHeader : undefined);

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  private readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on('error', reject);
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}
