// Purpose: Secure bridge exposing backend API methods to the React renderer.
// Prototype Origin: Replaces direct REST API calls in the Fastify prototype.
// Changes: Uses contextBridge to expose a typed `airAPI` object mapped to IPC channels.

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Expose the API to the renderer process safely
contextBridge.exposeInMainWorld('airAPI', {
  recording: {
    start: (url: string): Promise<{ success: boolean; error?: string }> => 
      ipcRenderer.invoke('recording:start', url),
    stop: (): Promise<{ success: boolean }> => 
      ipcRenderer.invoke('recording:stop'),
    getStatus: (): Promise<{ isRecording: boolean }> => 
      ipcRenderer.invoke('recording:status')
  },
  
  graph: {
    getNodes: (limit: number = 100): Promise<unknown[]> => 
      ipcRenderer.invoke('graph:get-nodes', limit),
    getEdges: (limit: number = 100): Promise<unknown[]> => 
      ipcRenderer.invoke('graph:get-edges', limit),
    getStats: (): Promise<unknown> => 
      ipcRenderer.invoke('graph:get-stats')
  },
  
  session: {
    list: (limit: number = 20): Promise<unknown[]> => 
      ipcRenderer.invoke('session:list', limit),
    getGraph: (sessionId: string): Promise<{ nodes: unknown[]; edges: unknown[] }> => 
      ipcRenderer.invoke('session:get-graph', sessionId)
  },
  
  db: {
    reset: (): Promise<{ success: boolean; error?: string }> => 
      ipcRenderer.invoke('db:reset')
  },

  // Event listener for backend push events (e.g., live graph updates)
  onGraphUpdate: (callback: (data: unknown) => void): (() => void) => {
    const subscription = (_event: IpcRendererEvent, data: unknown): void => {
      callback(data);
    };
    
    ipcRenderer.on('graph:update', subscription);
    
    // Return a cleanup function for React useEffect cleanup
    return (): void => {
      ipcRenderer.removeListener('graph:update', subscription);
    };
  }
});