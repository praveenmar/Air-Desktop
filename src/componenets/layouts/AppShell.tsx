// Purpose: Main structural layout wrapper (Sidebar + Content + Status Bar).
// Prototype Origin: New file for React UI architecture.
// Changes: Implements the 64px sidebar and 32px status bar constraints.

import React from 'react';
import { ViewState } from '../../App';
import StatusBar from '../layouts/StatusBar';

interface AppShellProps {
  currentView: ViewState;
  onViewChange: (view: ViewState) => void;
  children: React.ReactNode;
}

export default function AppShell({ currentView, onViewChange, children }: AppShellProps) {
  return (
    <div className="flex h-screen w-screen flex-col bg-[#0f0f0f]">
      <div className="flex flex-1 overflow-hidden">
        {/* 64px Left Sidebar */}
        <nav className="w-16 bg-[#1a1a1a] border-r border-slate-700/50 flex flex-col items-center py-4 space-y-6 flex-shrink-0">
          <button 
            onClick={() => onViewChange('recording')}
            className={`p-3 rounded-xl transition-colors ${currentView === 'recording' ? 'bg-blue-500/20 text-blue-500' : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800'}`}
            title="Recording"
          >
            {/* Record Icon */}
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          </button>
          
          <button 
            onClick={() => onViewChange('sessions')}
            className={`p-3 rounded-xl transition-colors ${currentView === 'sessions' ? 'bg-blue-500/20 text-blue-500' : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800'}`}
            title="Sessions"
          >
            {/* List Icon */}
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
          </button>

          <button 
            onClick={() => onViewChange('graph')}
            className={`p-3 rounded-xl transition-colors ${currentView === 'graph' ? 'bg-blue-500/20 text-blue-500' : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800'}`}
            title="Graph"
          >
            {/* Graph Icon */}
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /></svg>
          </button>

          <div className="flex-1" />

          <button 
            className="p-3 rounded-xl text-slate-400 hover:text-slate-50 hover:bg-slate-800 transition-colors"
            title="Settings"
          >
            {/* Settings Icon */}
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </button>
        </nav>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          {children}
        </main>
      </div>

      {/* 32px Bottom Status Bar */}
      <StatusBar />
    </div>
  );
}