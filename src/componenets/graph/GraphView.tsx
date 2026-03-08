import { useEffect, useState, useCallback } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap, 
  Node, 
  Edge,
  useNodesState,
  useEdgesState,
  MarkerType
} from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import StateNode from './StateNode';
import ActionEdge from './ActionEdge';

// --- ADD THESE IMPORTS (We will create these files next!) ---
import NodeInspector from '../inspector/NodeInspector';
import EdgeDetail from '../inspector/EdgeDetail';

declare global {
  interface Window {
    AirAPI: {
      session: {
        getGraph: (sessionId: string) => Promise<{ nodes: any[]; edges: any[] }>;
      };
    };
  }
}

const nodeTypes = { stateNode: StateNode };
const edgeTypes = { actionEdge: ActionEdge };

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
  const nodeWidth = 280;
  const nodeHeight = 150;
  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 200 });
  nodes.forEach((node) => dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight }));
  edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target));
  dagre.layout(dagreGraph);
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.position = { x: nodeWithPosition.x - nodeWidth / 2, y: nodeWithPosition.y - nodeHeight / 2 };
    return node;
  });
  return { nodes: layoutedNodes, edges };
};

export default function GraphView({ sessionId }: { sessionId: string | null }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [microActions, setMicroActions] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);

  // --- NEW STATE FOR THE SIDEBAR ---
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);

  const fetchGraphData = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);

    try {
      if (!window.airAPI) throw new Error("Cannot find window.airAPI!");
      const data = await window.airAPI.session.getGraph(sessionId);
      if (!data || !data.nodes) return;

      const rfNodes: Node[] = data.nodes.map((n: any) => ({
        id: String(n.id),
        type: 'stateNode',
        position: { x: 0, y: 0 }, 
        data: {
          pageUrl: n.pageUrl || n.page_url || n.canonicalHash || n.canonical_hash,
          pageTitle: n.pageTitle || n.page_title,
          observationCount: n.observationCount || n.observation_count,
        }
      }));

      const allEdges: Edge[] = data.edges.map((e: any) => ({
        id: String(e.id),
        source: String(e.fromNodeId || e.from_node_id), 
        target: String(e.toNodeId || e.to_node_id),
        type: 'actionEdge',
        data: {
          actionType: e.actionType || e.action_type || 'click',
          selector: e.selector || e.fingerprintHash || e.fingerprint_hash || 'Interact',
          outcomeType: e.outcomeType || e.outcome_type,
          sampleSize: e.sampleSize || e.sample_size,
          fingerprint: e.fingerprint,
        },
        animated: true,
        style: { stroke: '#10b981', strokeWidth: 2 }, 
        markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color: '#10b981' },
      }));

      const macroEdges = allEdges.filter(e => e.data.outcomeType === 'navigation');
      const microEdges = allEdges.filter(e => e.data.outcomeType !== 'navigation');

      setMicroActions(microEdges);

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(rfNodes, macroEdges);
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    } catch (error) {
      console.error("Failed to load graph:", error);
    } finally {
      setLoading(false);
    }
  }, [sessionId, setNodes, setEdges]);

  useEffect(() => {
    fetchGraphData();
    const interval = setInterval(fetchGraphData, 3000);
    return () => clearInterval(interval);
  }, [fetchGraphData]);

  // --- CLICK HANDLERS FOR THE GRAPH ---
  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedEdge(null);
    setSelectedNode(node);
  }, []);

  const onEdgeClick = useCallback((_: any, edge: Edge) => {
    setSelectedNode(null);
    setSelectedEdge(edge);
  }, []);

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Select a session to view the graph.
      </div>
    );
  }

  // --- THE NEW TWO-COLUMN LAYOUT ---
  return (
    <div className="flex-1 w-full h-full flex bg-[#0f0f0f]">
      
      {/* Left Column: The Macro Graph */}
      <div className="flex-1 relative">
        {loading && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/50">
            <span className="text-blue-400 animate-pulse">Mapping User Journey...</span>
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}   // <-- Added Click Handler
          onEdgeClick={onEdgeClick}   // <-- Added Click Handler
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          className="dark"
        >
          <Background color="#333" gap={16} />
          <Controls className="bg-gray-800 border-gray-700 fill-gray-300" />
          <MiniMap nodeColor="#1e1e1e" maskColor="rgba(0, 0, 0, 0.7)" className="bg-gray-900 border-gray-700" />
        </ReactFlow>
      </div>

      {/* Right Column: The Micro Sidebar */}
      <div className="w-96 border-l border-gray-700 bg-[#1e1e1e] flex flex-col shadow-2xl z-20">
        {!selectedNode && !selectedEdge ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 p-8 text-center gap-4">
            <div className="text-4xl">🔍</div>
            <p className="text-sm">Click on a Node (Page) or an Edge (Arrow) to inspect actions and selectors.</p>
          </div>
        ) : selectedNode ? (
          // Pass the specific node AND all the micro actions that belong to it
          <NodeInspector 
            node={selectedNode} 
            actions={microActions.filter(a => a.source === selectedNode.id)} 
          />
        ) : (
          <EdgeDetail edge={selectedEdge} />
        )}
      </div>

    </div>
  );
}