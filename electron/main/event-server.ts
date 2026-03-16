// Purpose: A lightweight HTTP server for the interceptor to POST events to.
// Prototype Origin: routes.js (Fastify implementation)
// Changes: Stripped Fastify dependency, implemented with Node's native HTTP module.

import * as http from 'http';
import { GraphBuilder } from '../../core/graph/graph-builder';
import { AIREventSchema } from '../../core/types';

export class EventServer {
  private server: http.Server;
  private port: number = 0;

  constructor(private graphBuilder: GraphBuilder) {
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      // Listen on port 0 to let the OS assign a random free port
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          console.log(`🚀 AIR Event Server listening on http://127.0.0.1:${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error('Failed to bind to a port.'));
        }
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Dynamic CORS for the interceptor: echo origin and allow credentials when present
    const origin = req.headers && (req.headers.origin as string | undefined);
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
      req.on('data', chunk => { body += chunk.toString(); });

      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);

          // Fix: _beaconFlushAll() sends { events: [...] } (batch format) while
          // flushQueue() sends a single event directly. The server must handle both.
          // A failed event in a batch must NOT block the remaining events —
          // each is processed independently and results collected separately.
          const isBatch = parsed && typeof parsed === 'object' && Array.isArray(parsed.events);

          if (isBatch) {
            // --- BATCH PATH (beacon flush) ---
            const results: Array<{ success: boolean; eventId?: string; error?: string }> = [];

            for (const rawEvent of parsed.events) {
              try {
                const parsedEvent = AIREventSchema.parse(rawEvent);
                const result = this.graphBuilder.processEvent(parsedEvent);
                results.push({ success: true, eventId: rawEvent.id });
              } catch (eventError) {
                console.error('❌ Failed to process batched event:', (eventError as Error).message);
                results.push({ success: false, eventId: rawEvent?.id, error: (eventError as Error).message });
              }
            }

            const allOk = results.every(r => r.success);
            res.writeHead(allOk ? 200 : 207, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: allOk, results }));

          } else {
            // --- SINGLE EVENT PATH (regular flush) ---
            const parsedEvent = AIREventSchema.parse(parsed);
            const result = this.graphBuilder.processEvent(parsedEvent);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, result }));
          }

        } catch (error) {
          console.error('❌ Failed to process event:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: (error as Error).message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  }
}