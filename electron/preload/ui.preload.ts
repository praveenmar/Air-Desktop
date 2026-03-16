// Purpose: Secure bridge exposing backend API methods to the React renderer.
// Prototype Origin: Replaces direct REST API calls in the Fastify prototype.
// Changes: Uses contextBridge to expose a typed `airAPI` object mapped to IPC channels.
// Fix (Bug #7): Added server.getPort() so the renderer can read the real OS-assigned
//   ephemeral port when needed (e.g. debug panels), replacing the stale eventServerPort
//   that was hardcoded to 3000 in settings_store.

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('airAPI', {
  recording: {
    start: (url: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('recording:start', url),
    stop: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('recording:stop'),
    getStatus: (): Promise<{ isRecording: boolean }> =>
      ipcRenderer.invoke('recording:status'),
  },

  graph: {
    getNodes: (limit: number = 100): Promise<unknown[]> =>
      ipcRenderer.invoke('graph:get-nodes', limit),
    getEdges: (limit: number = 100): Promise<unknown[]> =>
      ipcRenderer.invoke('graph:get-edges', limit),
    getStats: (): Promise<unknown> =>
      ipcRenderer.invoke('graph:get-stats'),
  },

  session: {
    list: (limit: number = 20): Promise<unknown[]> =>
      ipcRenderer.invoke('session:list', limit),
    getGraph: (sessionId: string): Promise<{ nodes: unknown[]; edges: unknown[] }> =>
      ipcRenderer.invoke('session:get-graph', sessionId),
  },

  server: {
    // FIX (Bug #7): Returns the real OS-assigned ephemeral port the EventServer is
    // listening on. Use this instead of the stale eventServerPort from settings_store.
    getPort: (): Promise<number> =>
      ipcRenderer.invoke('server:get-port'),
  },

  db: {
    reset: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('db:reset'),
  },

  onGraphUpdate: (callback: (data: unknown) => void): (() => void) => {
    const subscription = (_event: IpcRendererEvent, data: unknown): void => {
      callback(data);
    };
    ipcRenderer.on('graph:update', subscription);
    return (): void => {
      ipcRenderer.removeListener('graph:update', subscription);
    };
  },
});