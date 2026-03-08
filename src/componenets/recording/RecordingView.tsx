// Purpose: Main UI for initiating a recording session and watching live events.
// Prototype Origin: New file for React UI architecture.
// Changes: Replaces the fastify console logs with a reactive auto-scrolling table.

import { useState, useEffect, useRef } from 'react';
import { useRecording } from '../../hooks/useRecording';
import { AIREvent } from '@core/types';

export default function RecordingView() {
  const [urlInput, setUrlInput] = useState('https://example.com');
  const { startRecording, stopRecording, isRecording, loading, error } = useRecording();
  const [events, setEvents] = useState<AIREvent[]>([]);
  const tableRef = useRef<HTMLDivElement>(null);

  // Poll for recent events every 2s
useEffect(() => {
    const fetchEvents = async () => {
      try {
        // Cast window to any temporarily to access the injected but untyped method
        const api = (window as any).airAPI;
        if (api?.graph?.getRecentEvents) {
          const recent = await api.graph.getRecentEvents(50);
          setEvents(recent);
        }
      } catch (e) {
        console.error('Failed to fetch events', e);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 2000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (tableRef.current) {
      tableRef.current.scrollTop = tableRef.current.scrollHeight;
    }
  }, [events]);

  const handleToggleRecord = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording(urlInput);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Top Bar */}
      <div className="p-4 border-b border-slate-700/50 flex space-x-4 items-center bg-[#1a1a1a]">
        <input 
          type="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={isRecording || loading}
          className="flex-1 bg-[#0f0f0f] border border-slate-700/50 rounded-lg px-4 py-2 text-slate-50 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          placeholder="Enter target URL..."
        />
        
        <button
          onClick={handleToggleRecord}
          disabled={loading}
          className={`flex items-center px-6 py-2 rounded-lg font-medium transition-colors ${
            isRecording 
              ? 'bg-slate-800 text-slate-50 hover:bg-slate-700' 
              : 'bg-blue-600 text-white hover:bg-blue-500'
          }`}
        >
          {isRecording ? (
            <>
              <div className="w-2.5 h-2.5 bg-red-500 rounded-sm mr-2 animate-pulse" />
              Stop
            </>
          ) : (
            <>
              <div className="w-2.5 h-2.5 bg-red-500 rounded-full mr-2" />
              Record
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-900/20 border-b border-red-900/50 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Live Event Stream */}
      <div className="flex-1 overflow-auto" ref={tableRef}>
        <table className="w-full text-sm text-left font-mono">
          <thead className="text-xs text-slate-400 bg-[#1a1a1a] sticky top-0 border-b border-slate-700/50">
            <tr>
              <th className="px-6 py-3 font-normal">Time</th>
              <th className="px-6 py-3 font-normal">Type</th>
              <th className="px-6 py-3 font-normal">Element</th>
              <th className="px-6 py-3 font-normal">Intent</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-slate-700/30 hover:bg-slate-800/30">
                <td className="px-6 py-3 text-slate-500">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </td>
                <td className="px-6 py-3">
                  <span className={`px-2 py-1 rounded text-xs ${
                    event.type === 'click' ? 'bg-blue-900/30 text-blue-400' :
                    event.type === 'input' ? 'bg-amber-900/30 text-amber-400' :
                    event.type === 'outcome' ? 'bg-emerald-900/30 text-emerald-400' :
                    'bg-slate-800 text-slate-300'
                  }`}>
                    {event.type.toUpperCase()}
                  </span>
                </td>
                <td className="px-6 py-3 text-slate-300 truncate max-w-xs">
                  {('fingerprint' in event && event.fingerprint?.selector) 
                    ? event.fingerprint.selector.slice(0, 40) + '...' 
                    : '-'}
                </td>
                <td className="px-6 py-3 text-slate-300">
                  {(event as any).intent || '-'}
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                  No events recorded yet. Start recording to see the live stream.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}