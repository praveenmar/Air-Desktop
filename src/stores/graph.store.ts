// Purpose: Global state management for Graph Nodes, Edges, and Selections.
// Prototype Origin: New file for React UI architecture.
// Changes: Implements Zustand 5 for reactive graph state mapped to backend IPC.

import { create } from 'zustand';
import { GraphNode, GraphEdge } from '@core/types';

interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchGraph: () => Promise<void>;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  clearSelection: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  isLoading: false,
  error: null,

  fetchGraph: async () => {
    set({ isLoading: true, error: null });
    try {
      // In a full implementation, we might fetch by session ID. 
      // For now, we pull the global graph via the exposed API.
      const [nodes, edges] = await Promise.all([
        window.airAPI.graph.getNodes(500),
        window.airAPI.graph.getEdges(500)
      ]);
      
      set({ 
        nodes: nodes as GraphNode[], 
        edges: edges as GraphEdge[], 
        isLoading: false 
      });
    } catch (err) {
      set({ 
        error: err instanceof Error ? err.message : 'Failed to fetch graph', 
        isLoading: false 
      });
    }
  },

  selectNode: (id) => set({ selectedNodeId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),
  clearSelection: () => set({ selectedNodeId: null, selectedEdgeId: null }),
}));