import SelectorViewer from './SelectorViewer';

interface EdgeDetailProps {
  edge: any;
}

export default function EdgeDetail({ edge }: EdgeDetailProps) {
  if (!edge) return null;

  const { data } = edge;
  const actionLabel = (data.actionType || 'interaction').toUpperCase();

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto bg-[#1e1e1e] text-gray-300">
      <div className="border-b border-gray-700 pb-3 flex justify-between items-end">
        <div>
          <h2 className="text-lg font-bold text-white mb-1">User Action</h2>
          <span className="px-2 py-1 bg-blue-900 text-blue-300 text-xs font-bold rounded">
            {actionLabel}
          </span>
        </div>
        <div className="text-right">
          <span className="block text-xs text-gray-500 uppercase">Outcome</span>
          <span className={`text-sm font-semibold ${data.outcomeType === 'navigation' ? 'text-purple-400' : 'text-emerald-400'}`}>
            {data.outcomeType || 'state_refresh'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="flex flex-col bg-gray-900 p-2 rounded border border-gray-800">
          <span className="text-gray-500 text-xs uppercase">Sample Size</span>
          <span>{data.sampleSize || 1} interactions</span>
        </div>
        <div className="flex flex-col bg-gray-900 p-2 rounded border border-gray-800">
          <span className="text-gray-500 text-xs uppercase">Probability</span>
          <span>{data.probability ? `${(data.probability * 100).toFixed(1)}%` : '100%'}</span>
        </div>
      </div>

      {/* Render the exact fingerprint selector to help SDETs write tests */}
      <SelectorViewer fingerprint={data.fingerprint} />
    </div>
  );
}