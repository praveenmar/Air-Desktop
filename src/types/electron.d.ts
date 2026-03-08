// Purpose: Global type declarations for the window object in the React Renderer.
// Prototype Origin: N/A - Added for strict TypeScript support in the UI.
// Changes: Strongly types the `window.airAPI` exposed by ui.preload.ts.

import { GraphNode, GraphEdge, GraphStats, Session } from '../../core/types';

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
    getGraph: (sessionId: string) => Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  };
  db: {
    reset: () => Promise<{ success: boolean; error?: string }>;
  };
  onGraphUpdate: (callback: (data: unknown) => void) => () => void;
}

declare global {
  interface Window {
    airAPI: AirAPI;
    
    // Optional configuration exposed if running the interceptor inside a managed view
    __AIR_CONFIG?: {
      eventServerPort: number;
      sessionId: string;
    };
  }
}

// Make this a module to ensure it augments the global scope
export {};