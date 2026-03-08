interface SelectorViewerProps {
  fingerprint: any;
}

export default function SelectorViewer({ fingerprint }: SelectorViewerProps) {
  if (!fingerprint || !fingerprint.selector) {
    return (
      <div className="text-sm text-gray-500 italic p-2 bg-gray-900 rounded">
        No specific element selector captured for this action.
      </div>
    );
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    // You could add a little toast notification here!
  };

  return (
    <div className="flex flex-col gap-3 mt-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Element Fingerprint</h3>
      
      {/* Primary Selector */}
      <div className="bg-gray-900 border border-gray-700 rounded overflow-hidden">
        <div className="flex justify-between items-center bg-gray-800 px-3 py-1 border-b border-gray-700">
          <span className="text-xs text-gray-400">Primary Selector ({fingerprint.selectorPriority})</span>
          <button 
            onClick={() => handleCopy(fingerprint.selector)}
            className="text-[10px] bg-gray-700 hover:bg-blue-600 text-white px-2 py-1 rounded transition-colors"
          >
            Copy
          </button>
        </div>
        <div className="p-3 text-sm font-mono text-emerald-400 break-all">
          {fingerprint.selector}
        </div>
      </div>

      {/* Text Excerpt */}
      {fingerprint.textExcerpt && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Inner Text:</span>
          <div className="bg-gray-900 px-3 py-2 rounded border border-gray-800 text-sm text-gray-300 italic">
            "{fingerprint.textExcerpt}"
          </div>
        </div>
      )}

      {/* Extracted Attributes */}
      {fingerprint.attributes && Object.keys(fingerprint.attributes).length > 0 && (
        <div className="flex flex-col gap-1 mt-2">
          <span className="text-xs text-gray-500">Attributes:</span>
          <div className="bg-gray-900 rounded border border-gray-800 p-2 grid grid-cols-1 gap-1">
            {Object.entries(fingerprint.attributes).map(([key, val]) => (
              <div key={key} className="text-xs font-mono flex gap-2">
                <span className="text-blue-400">{key}=</span>
                <span className="text-yellow-300">"{String(val)}"</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}