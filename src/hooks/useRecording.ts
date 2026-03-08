// Purpose: Specialized hook wrapping recording session actions with localized UI state.
// Prototype Origin: New file for React UI architecture.
// Changes: Provides an easy-to-use interface for React components to manage recordings.

import { useState } from 'react';
import { useSessionStore } from '../stores/session.store';

export function useRecording() {
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const recordingStatus = useSessionStore((state) => state.recordingStatus);
  const storeStartRecording = useSessionStore((state) => state.startRecording);
  const storeStopRecording = useSessionStore((state) => state.stopRecording);

  const startRecording = async (url: string) => {
    setLoading(true);
    setError(null);
    setCurrentUrl(url);
    
    try {
      await storeStartRecording(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording');
    } finally {
      setLoading(false);
    }
  };

  const stopRecording = async () => {
    setLoading(true);
    setError(null);
    
    try {
      await storeStopRecording();
      setCurrentUrl(''); // Clear URL on stop
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop recording');
    } finally {
      setLoading(false);
    }
  };

  return {
    startRecording,
    stopRecording,
    isRecording: recordingStatus === 'recording',
    loading,
    error,
    currentUrl,
  };
}