// Purpose: Minimal preload for the recording target window/BrowserView.
// Prototype Origin: N/A - Required for Electron integration if CDP is not strictly used for config.
// Changes: Exposes the dynamic event server port and session ID to the injected script.

import { contextBridge, ipcRenderer } from 'electron';

// Fetch the configuration synchronously so the interceptor has it immediately upon loading
const config = ipcRenderer.sendSync('get-interceptor-config') as { 
  eventServerPort: number; 
  sessionId: string; 
};

// Expose configuration to the global window object for interceptor.js to consume
contextBridge.exposeInMainWorld('__AIR_CONFIG', {
  eventServerPort: config?.eventServerPort || 3000,
  sessionId: config?.sessionId || ''
});