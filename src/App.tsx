// Purpose: Root application component managing the primary view state.
// Prototype Origin: New file for React UI architecture.
// Changes: Minimal view switcher without a heavy router library.

import { useState } from 'react';
import AppShell from '../src/componenets/layouts/AppShell';
import RecordingView from '../src/componenets/recording/RecordingView';
import SessionsView from '../src/componenets/sessions/SessionsView';
import GraphView from '../src/componenets/graph/GraphView';

export type ViewState = 'recording' | 'sessions' | 'graph';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewState>('recording');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const handleViewChange = (view: ViewState) => {
    setCurrentView(view);
    if (view !== 'graph') {
      setSelectedSessionId(null);
    }
  };

  const handleSessionSelect = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setCurrentView('graph');
  };

  return (
    <AppShell currentView={currentView} onViewChange={handleViewChange}>
      {currentView === 'recording' && <RecordingView />}
      {currentView === 'sessions' && <SessionsView onSelectSession={handleSessionSelect} />}
      {currentView === 'graph' && <GraphView sessionId={selectedSessionId} />}
    </AppShell>
  );
}