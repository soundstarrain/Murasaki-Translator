import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import dagre from "dagre";
import { LayoutGrid, Maximize2 } from "lucide-react";
import { Button } from "./ui/core";
import { cn } from "../lib/utils";

export type PipelineGraphNodeItem = {
  id: string;
  label: string;
  value: string;
  muted?: boolean;
};

type PipelineGraphActions = {
  autoLayout: string;
  fitView: string;
};

type PipelineGraphViewProps = {
  nodes: PipelineGraphNodeItem[];
  actions: PipelineGraphActions;
  dragHint: string;
  className?: string;
};

type PipelineNodeData = {
  label: string;
  value: string;
  muted?: boolean;
};

const nodeWidth = 190;
const nodeHeight = 74;

const getLayoutedElements = (
  nodes: Array<Node<PipelineNodeData>>,
  edges: Edge[],
  direction: "LR" | "TB" = "LR",
) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 32,
    ranksep: 42,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const isHorizontal = direction === "LR";

  const layoutedNodes = nodes.map((node) => {
    const dagreNode = dagreGraph.node(node.id);
    if (!dagreNode) return node;
    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: dagreNode.x - nodeWidth / 2,
        y: dagreNode.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

const PipelineNode = ({ data }: NodeProps<PipelineNodeData>) => {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs shadow-sm backdrop-blur-md transition-all hover:border-primary/30 hover:shadow-md",
        data.muted ? "opacity-60" : "",
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {data.label}
      </div>
      <div className="mt-1 font-semibold text-foreground break-words">
        {data.value}
      </div>
    </div>
  );
};

const nodeTypes = { pipeline: PipelineNode };

export function PipelineGraphView({
  nodes: items,
  actions,
  dragHint,
  className,
}: PipelineGraphViewProps) {
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);

  const baseNodes = useMemo<Array<Node<PipelineNodeData>>>(
    () =>
      items.map((item, index) => ({
        id: item.id,
        type: "pipeline",
        position: { x: index * (nodeWidth + 40), y: 0 },
        data: {
          label: item.label,
          value: item.value,
          muted: item.muted,
        },
      })),
    [items],
  );

  const baseEdges = useMemo<Edge[]>(
    () =>
      items.slice(1).map((item, index) => ({
        id: `edge-${items[index].id}-${item.id}`,
        source: items[index].id,
        target: item.id,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "hsl(var(--border))", strokeWidth: 1.2 },
      })),
    [items],
  );

  const layouted = useMemo(
    () => getLayoutedElements(baseNodes, baseEdges),
    [baseNodes, baseEdges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layouted.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layouted.edges);

  useEffect(() => {
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
  }, [layouted.nodes, layouted.edges, setNodes, setEdges]);

  const handleAutoLayout = useCallback(() => {
    const nextLayout = getLayoutedElements(baseNodes, baseEdges);
    setNodes(nextLayout.nodes);
    setEdges(nextLayout.edges);
    requestAnimationFrame(() => {
      reactFlowInstance?.fitView({ padding: 0.2, duration: 300 });
    });
  }, [baseNodes, baseEdges, setNodes, setEdges, reactFlowInstance]);

  const handleFitView = useCallback(() => {
    reactFlowInstance?.fitView({ padding: 0.2, duration: 300 });
  }, [reactFlowInstance]);

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-background/70 shadow-sm backdrop-blur-md",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border/60 bg-background/70">
        <div className="text-[11px] text-muted-foreground">{dragHint}</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleAutoLayout}>
            <LayoutGrid className="w-4 h-4 mr-1.5" />
            {actions.autoLayout}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleFitView}>
            <Maximize2 className="w-4 h-4 mr-1.5" />
            {actions.fitView}
          </Button>
        </div>
      </div>
      <div className="h-[260px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onInit={setReactFlowInstance}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          fitView
          minZoom={0.3}
          maxZoom={1.6}
        >
          <Background gap={16} size={1} />
          <MiniMap zoomable pannable className="bg-background/80" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
