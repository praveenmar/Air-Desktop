// Purpose: A lightweight HTTP server for the interceptor to POST events to.
// Prototype Origin: routes.js (Fastify implementation)
// Changes: Stripped Fastify dependency, implemented with Node's native HTTP module.

import * as http from 'http';
import { GraphBuilder } from '../../core/graph/graph-builder';
import { AIREventSchema } from '../../core/types';

export class EventServer {
  private server: http.Server;
  private port: number = 0;
  private activeSessionIdGetter: () => string | null;

  constructor(
    private graphBuilder: GraphBuilder,
    activeSessionIdGetter: () => string | null
  ) {
    this.activeSessionIdGetter = activeSessionIdGetter;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      // Listen on port 0 to let the OS assign a random free port
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          console.log(`AIR Event Server listening on http://127.0.0.1:${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error('Failed to bind to a port.'));
        }
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Dynamic CORS for the interceptor: echo origin and allow credentials when present
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
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', port: this.port }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/events') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          const parsed: unknown = JSON.parse(body);
          const isBatch =
            typeof parsed === 'object' &&
            parsed !== null &&
            'events' in parsed &&
            Array.isArray((parsed as { events?: unknown }).events);

          if (isBatch) {
            const activeSessionId = this.activeSessionIdGetter();
            if (!activeSessionId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'No active recording session' }));
              return;
            }

            const results = [];
            let anyInvalid = false;
            const batchEvents = (parsed as { events: unknown[] }).events;

            const getEventId = (rawEvent: unknown): string | undefined => {
              if (!rawEvent || typeof rawEvent !== 'object' || !('id' in rawEvent)) return undefined;
              const idValue = (rawEvent as { id?: unknown }).id;
              return typeof idValue === 'string' ? idValue : undefined;
            };

            for (const rawEvent of batchEvents) {
              try {
                const parsedEvent = AIREventSchema.parse(rawEvent);

                if (parsedEvent.sessionId !== activeSessionId) {
                  results.push({ success: false, eventId: parsedEvent.id, error: 'Session mismatch' });
                  anyInvalid = true;
                  continue;
                }

                const result = this.graphBuilder.processEvent(parsedEvent);
                if (result.success) {
                  results.push({ success: true, eventId: parsedEvent.id });
                } else {
                  results.push({ success: false, eventId: parsedEvent.id, error: result.error || 'Event processing failed' });
                  anyInvalid = true;
                }
              } catch (eventError) {
                results.push({ success: false, eventId: getEventId(rawEvent), error: (eventError as Error).message });
                anyInvalid = true;
              }
            }

            res.writeHead(anyInvalid ? 207 : 200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: !anyInvalid, results }));
            return;
          }

          const parsedEvent = AIREventSchema.parse(parsed);
          const activeSessionId = this.activeSessionIdGetter();
          if (!activeSessionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'No active recording session' }));
            return;
          }

          if (parsedEvent.sessionId !== activeSessionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Session mismatch' }));
            return;
          }

          const result = this.graphBuilder.processEvent(parsedEvent);
          if (result.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, result }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: result.error }));
          }
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: (error as Error).message }));
        }
      });
    }
  }
}
