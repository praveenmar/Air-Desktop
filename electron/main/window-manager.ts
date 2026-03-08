// Purpose: Manages Electron BrowserWindow lifecycles (Main UI and Recording Target).
// Prototype Origin: New file for Electron architecture (replaces browser tabs).
// Changes: Implemented as a class for dependency injection and lifecycle tracking.

import { BrowserWindow, app } from 'electron';
import * as path from 'path';

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private recordingWindow: BrowserWindow | null = null;

  public createMainWindow(): BrowserWindow {
    if (this.mainWindow) return this.mainWindow;

    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      autoHideMenuBar: true, // Keeps it clean but leaves the Close/Min/Max buttons!
      webPreferences: {
        preload: path.join(__dirname, '../preload/ui.preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    return this.mainWindow;
  }

  public createRecordingWindow(url: string): BrowserWindow {
    if (this.recordingWindow) {
      this.recordingWindow.loadURL(url);
      return this.recordingWindow;
    }

    this.recordingWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    this.recordingWindow.loadURL(url);

    this.recordingWindow.on('closed', () => {
      this.recordingWindow = null;
    });

    return this.recordingWindow;
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  public getRecordingWindow(): BrowserWindow | null {
    return this.recordingWindow;
  }
}