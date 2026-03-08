// Purpose: Global state management for User Preferences (Persisted).
// Prototype Origin: New file for React UI architecture.
// Changes: Uses Zustand's persist middleware to save settings to localStorage.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  theme: 'light' | 'dark';
  eventServerPort: number;
  sidebarOpen: boolean;
  
  // Actions
  setTheme: (theme: 'light' | 'dark') => void;
  setEventServerPort: (port: number) => void;
  toggleSidebar: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark', // Defaulting to developer dark mode
      eventServerPort: 3000,
      sidebarOpen: true,

      setTheme: (theme) => set({ theme }),
      setEventServerPort: (port) => set({ eventServerPort: port }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    }),
    {
      name: 'air-settings-storage', // Key used in localStorage
    }
  )
);