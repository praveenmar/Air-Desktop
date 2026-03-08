import { useEffect, useRef } from 'react';

interface SnapshotViewerProps {
  html: string | null;
}

export default function SnapshotViewer({ html }: SnapshotViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current && html) {
      // We use srcdoc to render the raw HTML safely without network requests
      iframeRef.current.srcdoc = html;
    }
  }, [html]);

  if (!html) {
    return (
      <div className="flex items-center justify-center h-48 bg-gray-900 border border-gray-700 rounded text-gray-500 text-sm">
        No HTML snapshot available for this state.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">DOM Snapshot</h3>
      <div className="relative w-full h-64 bg-white border border-gray-700 rounded overflow-hidden">
        <iframe
          ref={iframeRef}
          title="DOM Snapshot"
          className="w-full h-full pointer-events-none" // Disable clicking inside the iframe
          sandbox="allow-same-origin" // Block scripts from running maliciously
        />
      </div>
    </div>
  );
}