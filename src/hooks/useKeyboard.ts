// Purpose: Global keyboard shortcut management for the AIR application.
// Prototype Origin: New file for React UI architecture.
// Changes: Implements cross-platform modifiers (Cmd/Ctrl) for global actions.

import { useEffect } from 'react';

interface KeyboardActions {
  onRecord?: () => void;
  onStop?: () => void;
  onGraphView?: () => void;
}

export function useKeyboard(actions: KeyboardActions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Determine if modifier key is pressed (Cmd on Mac, Ctrl on Windows/Linux)
      const isModifier = event.metaKey || event.ctrlKey;

      if (!isModifier) return;

      switch (event.key.toLowerCase()) {
        case 'r':
          event.preventDefault();
          if (actions.onRecord) actions.onRecord();
          break;
        case 's':
          event.preventDefault();
          if (actions.onStop) actions.onStop();
          break;
        case 'g':
          event.preventDefault();
          if (actions.onGraphView) actions.onGraphView();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [actions]);
}