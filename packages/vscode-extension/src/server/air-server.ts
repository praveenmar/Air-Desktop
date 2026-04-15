// Legacy server implementation removed.
// Canonical backend is now bootstrapped from packages/vscode-extension/server-entry.ts
// via EventServer -> GraphBuilder -> core schema.

export interface ServerOptions {
  dbPath: string;
  getActiveSessionId: () => string | null;
}

export class AIRServer {
  constructor(_options: ServerOptions) {
    throw new Error('AIRServer legacy path is disabled. Use server-entry.ts canonical bootstrap.');
  }

  public async start(): Promise<number> {
    throw new Error('Not implemented in legacy shim');
  }

  public async stop(): Promise<void> {
    throw new Error('Not implemented in legacy shim');
  }
}
