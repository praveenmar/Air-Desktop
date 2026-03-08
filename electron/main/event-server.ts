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
          const rawEvent = JSON.parse(body);
          // Validate incoming event shape before passing to the GraphBuilder
          const parsedEvent = AIREventSchema.parse(rawEvent);
          
          const result = this.graphBuilder.processEvent(parsedEvent);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, result }));
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