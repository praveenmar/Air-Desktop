// Purpose: A lightweight HTTP server for the interceptor to POST events to.

import * as http from 'http';
import { GraphBuilder } from '../../core/graph/graph-builder';
import { AIREventSchema } from '../../core/types';

export interface EventServerExtraHandler {
  (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> | boolean;
}

export interface EventServerOptions {
  getActiveSessionId: () => string | null;
  extraHandler?: EventServerExtraHandler;
}

export class EventServer {
  private server: http.Server;
  private port = 0;
  private activeSessionIdGetter: () => string | null;
  private extraHandler?: EventServerExtraHandler;

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
          console.log(`[EventServer] Started`, { port: this.port });
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
      console.warn(`[EventServer] Invalid request payload - ${(error as Error).message}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: (error as Error).message }));
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
      let anyInvalid = false;

      for (const rawEvent of events) {
        const eventId = this.extractEventId(rawEvent);
        try {
          const parsedEvent = AIREventSchema.parse(rawEvent);
          if (parsedEvent.sessionId !== activeSessionId) {
            console.warn('[EventServer] Session mismatch in batch', {
              incoming: parsedEvent.sessionId,
              active: activeSessionId,
              eventId: parsedEvent.id,
            });
            anyInvalid = true;
            results.push({ success: false, eventId: parsedEvent.id, error: 'Session mismatch' });
            continue;
          }

          console.log('[EventServer] [EVENT_RECEIVED]', { eventId: parsedEvent.id, type: parsedEvent.type });
          const result = await this.graphBuilder.processEvent(parsedEvent);
          if (!result.success) {
            anyInvalid = true;
            results.push({ success: false, eventId: parsedEvent.id, error: result.error || 'Event processing failed' });
            console.warn('[EventServer] [GRAPH_PROCESS_FAIL]', {
              eventId: parsedEvent.id,
              error: result.error || 'Event processing failed',
            });
            continue;
          }

          console.log('[EventServer] [EVENT_STORED]', { eventId: parsedEvent.id, type: parsedEvent.type });
          console.log('[EventServer] [GRAPH_PROCESSED]', { eventId: parsedEvent.id, stage: result.stage || 'ok' });
          console.log('[EventServer] [PIPELINE_OK]', { eventId: parsedEvent.id, type: parsedEvent.type });
          results.push({ success: true, eventId: parsedEvent.id });
        } catch (error) {
          anyInvalid = true;
          console.error('[EventServer] [SCHEMA_FAIL]', { eventId: eventId || 'unknown', error: (error as Error).message });
          results.push({ success: false, eventId, error: (error as Error).message });
        }
      }

      res.writeHead(anyInvalid ? 207 : 202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: !anyInvalid, queued: events.length, results }));
      return;
    }

    const eventId = this.extractEventId(parsed);
    let parsedEvent;
    try {
      parsedEvent = AIREventSchema.parse(parsed);
    } catch (error) {
      console.error('[EventServer] [SCHEMA_FAIL]', { eventId: eventId || 'unknown', error: (error as Error).message });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: (error as Error).message }));
      return;
    }

    if (parsedEvent.sessionId !== activeSessionId) {
      console.warn('[EventServer] Session mismatch', {
        incoming: parsedEvent.sessionId,
        active: activeSessionId,
        eventId: parsedEvent.id,
      });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Session mismatch' }));
      return;
    }

    console.log('[EventServer] [EVENT_RECEIVED]', { eventId: parsedEvent.id, type: parsedEvent.type });
    const result = await this.graphBuilder.processEvent(parsedEvent);
    if (!result.success) {
      console.warn('[EventServer] [GRAPH_PROCESS_FAIL]', {
        eventId: parsedEvent.id,
        error: result.error || 'Event processing failed',
      });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: result.error || 'Event processing failed' }));
      return;
    }

    console.log('[EventServer] [EVENT_STORED]', { eventId: parsedEvent.id, type: parsedEvent.type });
    console.log('[EventServer] [GRAPH_PROCESSED]', { eventId: parsedEvent.id, stage: result.stage || 'ok' });
    console.log('[EventServer] [PIPELINE_OK]', { eventId: parsedEvent.id, type: parsedEvent.type });

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, queued: 1, result }));
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

  private extractEventId(rawEvent: unknown): string | undefined {
    if (!rawEvent || typeof rawEvent !== 'object' || !('id' in rawEvent)) return undefined;
    const idValue = (rawEvent as { id?: unknown }).id;
    return typeof idValue === 'string' ? idValue : undefined;
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
