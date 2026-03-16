import SnapshotViewer from './SnapshotViewer';

interface NodeInspectorProps {
  node: any;
  actions: any[]; // <--- Added this to accept the micro-actions!
}

export default function NodeInspector({ node, actions }: NodeInspectorProps) {
  if (!node) return null;

  const { data } = node;

  // --- THE MAGIC FIX: Event Deduplication ---
  // We squash consecutive actions on the SAME selector to remove DOM noise.
  const deduplicatedActions = actions.reduce((acc, current) => {
    if (acc.length === 0) {
      acc.push(current);
      return acc;
    }

    const prev = acc[acc.length - 1];
    const isSameSelector = prev.data.selector === current.data.selector;

    if (isSameSelector) {
      // Scenario A: User clicked a field, then typed in it. (Keep the Input, discard the Click)
      if (prev.data.actionType === 'click' && current.data.actionType === 'input') {
        acc[acc.length - 1] = current;
      }
      // Scenario B: User typed multiple times rapidly (consecutive inputs). Keep the latest one.
      else if (prev.data.actionType === 'input' && current.data.actionType === 'input') {
        acc[acc.length - 1] = current;
      }
      // Scenario C: The DOM fired an extraneous click after typing, or double click. (Ignore it)
      // Do nothing, the 'current' event is dropped.
    } else {
      // Different selector, meaning it's a completely new user action. Add it.
      acc.push(current);
    }

    return acc;
  }, [] as any[]);

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

      {/* --- MAPPING OVER THE NEW DEDUPLICATED ARRAY --- */}
      {deduplicatedActions && deduplicatedActions.length > 0 && (
        <div className="flex flex-col mt-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recorded Actions (Steps)</h3>
          <div className="flex flex-col gap-2">
            {deduplicatedActions.map((action: any, index: number) => {
              
              const displayBadge = (action.data.intent || action.data.actionType || 'UNKNOWN')
                .replace(/_/g, ' ')
                .toUpperCase();
              
              const semanticIntent = action.data.intent || `generic_${action.data.actionType}`;
              const rawSelector = action.data.selector || '⚠️ Selector generation failed or missing context';

              return (
                <div key={action.id} className="bg-gray-900 border border-gray-800 rounded p-3 text-xs flex flex-col gap-2 shadow-sm">
                  
                  {/* Top Row: Human Readable Intent */}
                  <div className="flex items-center gap-2 border-b border-gray-800 pb-1.5">
                    <span className="text-gray-500 font-mono font-bold">{index + 1}.</span>
                    <span className="bg-blue-900 text-blue-300 px-2 py-0.5 rounded font-bold text-[10px] uppercase">
                      {displayBadge}
                    </span>
                    <span className="text-gray-500 text-[10px] ml-auto font-mono" title="Semantic Intent">
                      {semanticIntent}
                    </span>
                  </div>
                  
                  {/* Middle Row: SDET Selector Validation */}
                  <div className="flex flex-col pl-5 mt-1">
                    <span className="text-gray-500 text-[9px] uppercase tracking-wider mb-0.5">
                      Target Selector:
                    </span>
                    <span className={`font-mono text-[11px] break-all bg-black/50 p-1.5 rounded border ${
                      action.data.selector 
                        ? 'text-emerald-400 border-gray-700' 
                        : 'text-red-400 border-red-900/50 italic'
                    }`}>
                      {rawSelector}
                    </span>
                  </div>

                  {/* Bottom Row: Input Value */}
                  {action.data.fingerprint?.textExcerpt && action.data.actionType === 'input' && (
                    <div className="flex flex-col pl-5 mt-1">
                      <span className="text-gray-500 text-[9px] uppercase tracking-wider mb-0.5">
                        Input Value:
                      </span>
                      <span className="font-mono text-yellow-300 text-[11px] bg-black/50 p-1.5 rounded border border-gray-700">
                        "{action.data.fingerprint.textExcerpt}"
                      </span>
                    </div>
                  )}

                </div>
              );
            })}
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