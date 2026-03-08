import SnapshotViewer from './SnapshotViewer';

interface NodeInspectorProps {
  node: any;
  actions: any[]; // <--- Added this to accept the micro-actions!
}

export default function NodeInspector({ node, actions }: NodeInspectorProps) {
  if (!node) return null;

  const { data } = node;

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto bg-[#1e1e1e] text-gray-300">
      <div className="border-b border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-white mb-1">Page State</h2>
        <p className="text-xs font-mono text-blue-400 break-all">{data.pageUrl || 'Unknown URL'}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="flex flex-col bg-gray-900 p-2 rounded border border-gray-800">
          <span className="text-gray-500 text-xs uppercase">Title</span>
          <span className="truncate" title={data.pageTitle}>{data.pageTitle || 'N/A'}</span>
        </div>
        <div className="flex flex-col bg-gray-900 p-2 rounded border border-gray-800">
          <span className="text-gray-500 text-xs uppercase">Observed</span>
          <span>{data.observationCount} times</span>
        </div>
      </div>

      {/* --- THIS IS THE MAGIC: RENDERING THE MICRO ACTIONS --- */}
      {actions && actions.length > 0 && (
        <div className="flex flex-col mt-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recorded Actions (Steps)</h3>
          <div className="flex flex-col gap-2">
            {actions.map((action, index) => (
              <div key={action.id} className="bg-gray-900 border border-gray-800 rounded p-2 text-xs flex flex-col gap-1 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 font-mono">{index + 1}.</span>
                  <span className="bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded font-bold text-[10px] uppercase">
                    {action.data.actionType}
                  </span>
                </div>
                <span className="font-mono text-emerald-400 break-all pl-5">
                  {action.data.selector}
                </span>
                {/* --- ADD THIS BLOCK TO SHOW THE TYPED TEXT --- */}
                {action.data.fingerprint?.textExcerpt && (
                  <div className="pl-5 mt-1">
                    <span className="text-gray-500 text-[10px]">Typed: </span>
                    <span className="font-mono text-yellow-300 text-[11px] bg-black/50 px-1 py-0.5 rounded">
                      "{action.data.fingerprint.textExcerpt}"
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.canonicalHash && (
        <div className="flex flex-col mt-2">
          <span className="text-gray-500 text-xs uppercase mb-1">Canonical Hash</span>
          <code className="text-[10px] bg-gray-900 p-2 rounded border border-gray-800 text-emerald-400 break-all">
            {data.canonicalHash}
          </code>
        </div>
      )}

      {/* Renders the HTML snapshot if the backend provided it */}
      <div className="mt-2">
        <SnapshotViewer html={data.snapshotHtml} />
      </div>
    </div>
  );
}