// Purpose: Displays a list of recorded sessions and allows navigation to their respective graphs.
// Prototype Origin: New file for React UI architecture.
// Changes: Renders Session cards based on DB data.

import { useEffect, useState } from 'react';
import { Session } from '@core/types';

interface SessionsViewProps {
  onSelectSession: (sessionId: string) => void;
}

export default function SessionsView({ onSelectSession }: SessionsViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const data = await window.airAPI.session.list(50);
        setSessions(data);
      } catch (error) {
        console.error('Failed to load sessions', error);
      } finally {
        setLoading(false);
      }
    };
    fetchSessions();
  }, []);

  if (loading) return <div className="p-8 text-slate-400">Loading sessions...</div>;

  return (
    <div className="p-8 overflow-auto h-full">
      <h2 className="text-xl text-slate-50 mb-6">Recording Sessions</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sessions.map(session => (
          <div key={session.id} className="bg-[#1a1a1a] border border-slate-700/50 rounded-xl p-5 flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <span className="font-mono text-sm text-blue-400 truncate max-w-[180px]">
                {session.id}
              </span>
              <span className={`px-2 py-1 rounded text-xs ${
                session.status === 'active' ? 'bg-green-900/30 text-green-400' : 'bg-slate-800 text-slate-400'
              }`}>
                {session.status.toUpperCase()}
              </span>
            </div>
            
            <div className="space-y-2 text-sm text-slate-400 flex-1">
              <div className="flex justify-between">
                <span>Started</span>
                <span className="text-slate-50">{new Date(session.startedAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Events</span>
                <span className="text-slate-50">{session.eventCount}</span>
              </div>
            </div>

            <button 
              onClick={() => onSelectSession(session.id)}
              className="mt-6 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-50 rounded-lg transition-colors text-sm font-medium"
            >
              View Graph
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="col-span-full text-slate-500 text-center py-12 border border-dashed border-slate-700/50 rounded-xl">
            No sessions recorded.
          </div>
        )}
      </div>
    </div>
  );
}