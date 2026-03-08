// Purpose: Bottom status bar polling and displaying system health/stats.
// Prototype Origin: New file for React UI architecture.
// Changes: Implements a 3s polling loop for graph statistics.

import { useState, useEffect } from 'react';
import { GraphStats } from '../../../core/types';

export default function StatusBar() {
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await window.airAPI.graph.getStats();
        setStats(data);
        setIsConnected(true);
      } catch (error) {
        setIsConnected(false);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <footer className="h-8 bg-[#1a1a1a] border-t border-slate-700/50 flex items-center px-4 text-xs font-mono text-slate-400 flex-shrink-0">
      <div className="flex items-center space-x-2">
        <span className="relative flex h-2.5 w-2.5">
          {isConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
        </span>
        <span>{isConnected ? 'Backend Connected' : 'Backend Disconnected'}</span>
      </div>

      <div className="flex-1" />

      <div className="flex space-x-6">
        <span>Nodes: <span className="text-slate-50">{stats?.nodes || 0}</span></span>
        <span>Edges: <span className="text-slate-50">{stats?.edges || 0}</span></span>
        <span>Events: <span className="text-slate-50">{stats?.events || 0}</span></span>
      </div>
    </footer>
  );
}