// Purpose: Global state management for Recording Sessions and Status.
// Prototype Origin: New file for React UI architecture.
// Changes: Manages session list and active recording state via Zustand.

import { create } from 'zustand';
import { Session } from '@core/types';

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  recordingStatus: 'idle' | 'recording' | 'error';
  
  // Actions
  fetchSessions: () => Promise<void>;
  startRecording: (url: string) => Promise<void>;
  stopRecording: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  recordingStatus: 'idle',

  fetchSessions: async () => {
    try {
      const sessions = await window.airAPI.session.list(20);
      set({ sessions });
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    }
  },

  startRecording: async (url: string) => {
    set({ recordingStatus: 'idle' }); // Reset state before starting
    try {
      const result = await window.airAPI.recording.start(url);
      if (result.success) {
        set({ recordingStatus: 'recording' });
        // We trigger a session fetch to get the newly created session
        useSessionStore.getState().fetchSessions();
      } else {
        set({ recordingStatus: 'error' });
        throw new Error(result.error || 'Failed to start recording');
      }
    } catch (error) {
      set({ recordingStatus: 'error' });
      throw error;
    }
  },

  stopRecording: async () => {
    try {
      const result = await window.airAPI.recording.stop();
      if (result.success) {
        set({ recordingStatus: 'idle' });
        useSessionStore.getState().fetchSessions();
      } else {
        throw new Error('Failed to stop recording cleanly');
      }
    } catch (error) {
      console.error(error);
      set({ recordingStatus: 'error' });
      throw error;
    }
  }
}));