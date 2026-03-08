import { Handle, Position } from 'reactflow';

export default function StateNode({ data }: { data: any }) {
  // Safely extract a clean path from the URL
  let path = 'Unknown Path';
  try {
    if (data.pageUrl) {
      const urlObj = new URL(data.pageUrl);
      // If it's the root domain, show the domain. Otherwise, show the path.
      path = urlObj.pathname === '/' ? urlObj.hostname : urlObj.pathname;
    }
  } catch (e) {
    // Fallback if URL parsing fails
    path = data.pageUrl || 'Unknown Path';
  }

  return (
    <div className="bg-[#1e1e1e] border border-gray-700 rounded-lg shadow-xl w-64 overflow-hidden">
      {/* Target Handle (Incoming) */}
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-blue-500 border-none" />
      
      {/* Header */}
      <div className="bg-[#252526] px-3 py-2 border-b border-gray-700 flex justify-between items-center">
        <span className="text-xs font-mono text-blue-400 truncate pr-2">{path}</span>
      </div>

      {/* Body */}
      <div className="p-3">
        <p className="text-sm font-semibold text-gray-200 truncate" title={data.pageTitle}>
          {data.pageTitle || 'Untitled Page'}
        </p>
        <div className="mt-3 flex justify-between items-center text-xs text-gray-500">
          <span>Observed: {data.observationCount || 1}x</span>
          <span className="px-2 py-1 bg-gray-800 text-gray-300 text-[10px] rounded">HTML</span>
        </div>
      </div>

      {/* Source Handle (Outgoing) */}
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-emerald-500 border-none" />
    </div>
  );
}