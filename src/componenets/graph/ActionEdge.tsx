import { BaseEdge, EdgeLabelRenderer, getBezierPath, EdgeProps } from 'reactflow';

export default function ActionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Fallback data if the backend hasn't supplied it yet
  const actionType = data?.actionType || 'interaction';
  const selector = data?.selector || 'unknown-element';

  // Choose an icon based on the action
  const icon = actionType === 'click' ? '🖱️' : actionType === 'input' ? '⌨️' : '⚡';

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <div 
            className="bg-gray-800 border border-gray-600 rounded-full px-3 py-1 shadow-lg cursor-pointer hover:bg-gray-700 hover:border-blue-400 transition-all flex items-center gap-2"
            onClick={() => console.log('Edge clicked!', id, data)}
          >
            <span className="text-[10px]">{icon}</span>
            <span className="text-xs font-mono text-gray-200 truncate max-w-[120px]">
              {selector}
            </span>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}