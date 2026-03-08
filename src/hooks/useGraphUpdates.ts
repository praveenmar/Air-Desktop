// Purpose: React hook that subscribes to live backend graph updates.
// Prototype Origin: New file for React UI architecture.
// Changes: Utilizes the `onGraphUpdate` listener exposed in ui.preload.ts.

import { useEffect } from 'react';
import { useGraphStore } from '../stores/graph.store';
import { useSessionStore } from '../stores/session.store';

export function useGraphUpdates() {
  const fetchGraph = useGraphStore((state) => state.fetchGraph);
  const fetchSessions = useSessionStore((state) => state.fetchSessions);

  useEffect(() => {
    // Subscribe to graph updates pushed from the Electron Main Process
    const unsubscribe = window.airAPI.onGraphUpdate((data) => {
      console.log('📡 Received live graph update:', data);
      
      // Auto-refresh the stores when new data arrives
      fetchGraph().catch(console.error);
      fetchSessions().catch(console.error);
    });

    // Cleanup subscription on unmount
    return () => {
      unsubscribe();
    };
  }, [fetchGraph, fetchSessions]);
}