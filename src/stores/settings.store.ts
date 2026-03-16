// Purpose: Global state management for User Preferences (Persisted).
// Prototype Origin: New file for React UI architecture.
// Changes: Uses Zustand's persist middleware to save settings to localStorage.
// Fix (Bug #7): Removed eventServerPort from persisted settings.
//   The field held a hardcoded default of 3000 and was never updated to reflect the
//   real port assigned by the OS (port 0 → ephemeral). The real port flows through
//   EventServer → ipc-handlers serverPort param → BrowserManager.startRecording() and
//   is now also exposed via the 'server:get-port' IPC channel for any UI that needs
//   to display it. Keeping a stale 3000 in localStorage was actively misleading.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  theme: 'light' | 'dark';
  sidebarOpen: boolean;

  // Actions
  setTheme: (theme: 'light' | 'dark') => void;
  toggleSidebar: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',       // Default to developer dark mode
      sidebarOpen: true,

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    }),
    {
      name: 'air-settings-storage',
    }
  )
);