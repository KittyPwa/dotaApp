import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { CommunityGraph } from "@dota/shared";
import { Card } from "./Card";

type GraphNode = CommunityGraph["nodes"][number] & {
  x: number;
  y: number;
  radius: number;
  label: string;
};

const GRAPH_WIDTH = 940;
const GRAPH_HEIGHT = 620;
const CENTER_X = GRAPH_WIDTH / 2;
const CENTER_Y = GRAPH_HEIGHT / 2;

function polarPoint(radius: number, angle: number) {
  return {
    x: CENTER_X + Math.cos(angle) * radius,
    y: CENTER_Y + Math.sin(angle) * radius
  };
}

function nodeLabel(node: CommunityGraph["nodes"][number]) {
  return (node.personaname ?? `Player ${node.playerId}`).trim();
}

function nodeInitials(node: CommunityGraph["nodes"][number]) {
  const label = nodeLabel(node);
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return String(node.playerId).slice(0, 2);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function buildGraphNodes(nodes: CommunityGraph["nodes"]): GraphNode[] {
  const sorted = [...nodes].sort(
    (left, right) =>
      right.degree - left.degree ||
      right.favoredByCount - left.favoredByCount ||
      nodeLabel(left).localeCompare(nodeLabel(right))
  );

  if (sorted.length === 0) return [];

  const maxDegree = Math.max(...sorted.map((node) => node.degree), 1);
  const positioned: GraphNode[] = [];

  sorted.forEach((node, index) => {
    const radius = 24 + (node.degree / maxDegree) * 20;
    if (index === 0) {
      positioned.push({
        ...node,
        x: CENTER_X,
        y: CENTER_Y,
        radius,
        label: nodeLabel(node)
      });
      return;
    }

    let remaining = index - 1;
    let ringIndex = 0;
    let ringSize = 8;
    while (remaining >= ringSize) {
      remaining -= ringSize;
      ringIndex += 1;
      ringSize += 6;
    }
    const ringRadius = 130 + ringIndex * 110;
    const angleOffset = ringIndex % 2 === 0 ? -Math.PI / 2 : -Math.PI / 2 + Math.PI / ringSize;
    const angle = angleOffset + (remaining / ringSize) * Math.PI * 2;
    const point = polarPoint(ringRadius, angle);

    positioned.push({
      ...node,
      x: point.x,
      y: point.y,
      radius,
      label: nodeLabel(node)
    });
  });

  return positioned;
}

export function CommunityGraphView(props: { graph: CommunityGraph }) {
  const [query, setQuery] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);

  const visibleIds = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return new Set(props.graph.nodes.map((node) => node.playerId));
    }
    return new Set(
      props.graph.nodes
        .filter((node) => {
          const label = nodeLabel(node).toLowerCase();
          return label.includes(normalized) || String(node.playerId).includes(normalized);
        })
        .map((node) => node.playerId)
    );
  }, [props.graph.nodes, query]);

  const positionedNodes = useMemo(
    () => buildGraphNodes(props.graph.nodes).filter((node) => visibleIds.has(node.playerId)),
    [props.graph.nodes, visibleIds]
  );

  const nodeMap = useMemo(
    () => new Map(positionedNodes.map((node) => [node.playerId, node])),
    [positionedNodes]
  );

  const visibleEdges = useMemo(
    () =>
      props.graph.edges.filter(
        (edge) => nodeMap.has(edge.sourcePlayerId) && nodeMap.has(edge.targetPlayerId)
      ),
    [props.graph.edges, nodeMap]
  );

  const selectedNode =
    (selectedPlayerId !== null ? positionedNodes.find((node) => node.playerId === selectedPlayerId) : null) ??
    positionedNodes[0] ??
    null;

  const selectedNeighbors = selectedNode
    ? visibleEdges.filter(
        (edge) =>
          edge.sourcePlayerId === selectedNode.playerId || edge.targetPlayerId === selectedNode.playerId
      )
    : [];

  return (
    <div className="stack">
      <div className="community-toolbar">
        <label>
          Search players
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or Steam ID"
          />
        </label>
        <div className="community-meta">
          <span>{positionedNodes.length} visible players</span>
          <span>{visibleEdges.length} visible links</span>
        </div>
      </div>

      <div className="community-layout">
        <Card
          title="Relationship graph"
          extra={
            selectedNode ? (
              <span className="muted-inline">Selected: {selectedNode.label}</span>
            ) : null
          }
        >
          {positionedNodes.length === 0 ? (
            <p className="muted-inline">No players match the current search.</p>
          ) : (
            <div className="community-graph-shell">
              <svg
                className="community-graph"
                viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                role="img"
                aria-label="Community relationship graph"
              >
                <g className="community-rings">
                  {[130, 240, 350].map((radius) => (
                    <circle
                      key={radius}
                      cx={CENTER_X}
                      cy={CENTER_Y}
                      r={radius}
                      className="community-ring"
                    />
                  ))}
                </g>

                <g className="community-links">
                  {visibleEdges.map((edge) => {
                    const source = nodeMap.get(edge.sourcePlayerId);
                    const target = nodeMap.get(edge.targetPlayerId);
                    if (!source || !target) return null;
                    const highlighted =
                      selectedNode &&
                      (selectedNode.playerId === edge.sourcePlayerId ||
                        selectedNode.playerId === edge.targetPlayerId);
                    return (
                      <line
                        key={`${edge.sourcePlayerId}-${edge.targetPlayerId}`}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        className={`community-link${edge.bidirectional ? " bidirectional" : ""}${
                          highlighted ? " highlighted" : ""
                        }`}
                      />
                    );
                  })}
                </g>

                <g className="community-nodes">
                  {positionedNodes.map((node) => {
                    const selected = selectedNode?.playerId === node.playerId;
                    return (
                      <g
                        key={node.playerId}
                        className={`community-node${selected ? " selected" : ""}`}
                        onClick={() => setSelectedPlayerId(node.playerId)}
                      >
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.radius}
                          className="community-node-circle"
                        />
                        <text
                          x={node.x}
                          y={node.y + 4}
                          textAnchor="middle"
                          className="community-node-initials"
                        >
                          {nodeInitials(node)}
                        </text>
                        <text
                          x={node.x}
                          y={node.y + node.radius + 18}
                          textAnchor="middle"
                          className="community-node-label"
                        >
                          {node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>
          )}
        </Card>

        <div className="stack">
          <Card title="Selected player">
            {selectedNode ? (
              <div className="community-detail">
                <div className="player-panel">
                  <div className="player-panel-header">
                    <div className="entity-link">
                      {selectedNode.avatar ? (
                        <img
                          className="avatar avatar-sm"
                          src={selectedNode.avatar}
                          alt={selectedNode.label}
                        />
                      ) : (
                        <div className="avatar avatar-sm avatar-fallback">
                          {nodeInitials(selectedNode)}
                        </div>
                      )}
                      <div className="stack compact">
                        <strong>{selectedNode.label}</strong>
                        <span className="muted-inline">Steam ID {selectedNode.playerId}</span>
                      </div>
                    </div>
                    <div className="player-panel-kda">
                      <strong>{selectedNode.degree} links</strong>
                      <span className="muted-inline">{selectedNode.favoritesCount} outgoing</span>
                      <span className="muted-inline">{selectedNode.favoredByCount} incoming</span>
                    </div>
                  </div>
                </div>
                <div className="action-group">
                  <Link className="inline-link-chip" to={`/players/${selectedNode.playerId}`}>
                    Open player
                  </Link>
                </div>
              </div>
            ) : (
              <p className="muted-inline">Select a player in the graph.</p>
            )}
          </Card>

          <Card title="Connections">
            {selectedNode ? (
              selectedNeighbors.length > 0 ? (
                <div className="roster-list">
                  {selectedNeighbors.map((edge) => {
                    const otherPlayerId =
                      edge.sourcePlayerId === selectedNode.playerId
                        ? edge.targetPlayerId
                        : edge.sourcePlayerId;
                    const otherNode = nodeMap.get(otherPlayerId);
                    if (!otherNode) return null;
                    const direction =
                      edge.sourcePlayerId === selectedNode.playerId ? "Favorites" : "Favored by";
                    return (
                      <Link
                        key={`${selectedNode.playerId}-${otherNode.playerId}-${direction}`}
                        to={`/players/${otherNode.playerId}`}
                        className="community-connection"
                      >
                        <div className="entity-link">
                          {otherNode.avatar ? (
                            <img className="avatar avatar-sm" src={otherNode.avatar} alt={otherNode.label} />
                          ) : (
                            <div className="avatar avatar-sm avatar-fallback">{nodeInitials(otherNode)}</div>
                          )}
                          <div className="stack compact">
                            <strong>{otherNode.label}</strong>
                            <span className="muted-inline">Steam ID {otherNode.playerId}</span>
                          </div>
                        </div>
                        <span className="muted-inline">
                          {edge.bidirectional ? "Mutual favorite" : direction}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="muted-inline">This player has no visible links in the current filter.</p>
              )
            ) : (
              <p className="muted-inline">Select a player to inspect their links.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
