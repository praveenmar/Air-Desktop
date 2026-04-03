// Purpose: Global type declarations for the window object in the React Renderer.
// Prototype Origin: N/A - Added for strict TypeScript support in the UI.
// Changes: Strongly types the `window.airAPI` exposed by ui.preload.ts.
// Fix (Bug #7): Added server.getPort() declaration to match the new IPC channel.

import { GraphNode, GraphEdge, GraphStats, Session } from '../../core/types';

export interface SessionDebugLog {
  id: string;
  timestamp: number;
  component: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'decision';
  message: string;
  data: Record<string, unknown>;
  sessionId: string | null;
  traceId: string | null;
}

export interface AirAPI {
  recording: {
    start: (url: string) => Promise<{ success: boolean; error?: string }>;
    stop: () => Promise<{ success: boolean }>;
    getStatus: () => Promise<{ isRecording: boolean }>;
  };
  graph: {
    getNodes: (limit?: number) => Promise<GraphNode[]>;
    getEdges: (limit?: number) => Promise<GraphEdge[]>;
    getStats: () => Promise<GraphStats>;
  };
  session: {
    list: (limit?: number) => Promise<Session[]>;
    getNodes: (sessionId: string) => Promise<GraphNode[]>;
    getEdges: (sessionId: string) => Promise<GraphEdge[]>;
    getGraph: (sessionId: string) => Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
    getDebugLogs: (sessionId: string, limit?: number) => Promise<SessionDebugLog[]>;
  };
  server: {
    // Returns the real OS-assigned ephemeral port the EventServer is listening on.
    // Use this anywhere you need the live port — never rely on a hardcoded 3000.
    getPort: () => Promise<number>;
  };
  db: {
    reset: () => Promise<{ success: boolean; error?: string }>;
  };
  onGraphUpdate: (callback: (data: unknown) => void) => () => void;
}

declare global {
  interface Window {
    airAPI: AirAPI;

    // Configuration injected into recording target windows via interceptor_preload.ts
    __AIR_CONFIG?: {
      eventServerPort: number;
      sessionId: string;
    };
  }
}

export {};
