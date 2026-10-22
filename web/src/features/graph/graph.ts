import type { GraphEdge, GraphNode } from "../../api/types";

const AGENT_COLORS = [1, 2, 3, 4, 5, 6, 7].map(i => `var(--agent-${i})`);
export const MAIN_COLOR = "var(--agent-main)";
export const MESSAGE_COLOR = "var(--flow-message)";
export const RETURN_COLOR = "var(--flow-return)";
export const ACCENT_COLOR = "var(--agent-1)";

export type OrderedNode = GraphNode & { depth: number; color: string; children: string[] };
export type Point = { x: number; y: number };

export const nodeName = (n: GraphNode) => (n.id === "main" ? "main" : (n.name ?? n.description ?? n.type));

export function orderNodes(nodes: GraphNode[]): OrderedNode[] {
  const ids = new Set(nodes.map(n => n.id));
  const kids = new Map<string, GraphNode[]>();
  const roots: GraphNode[] = [];
  for (const n of nodes) {
    if (!n.parent || !ids.has(n.parent)) {
      roots.push(n);
      continue;
    }
    const list = kids.get(n.parent) ?? [];
    list.push(n);
    kids.set(n.parent, list);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const out: OrderedNode[] = [];
  let colorIndex = 0;
  const walk = (n: GraphNode, depth: number) => {
    const children = kids.get(n.id) ?? [];
    const color = n.id === "main" ? MAIN_COLOR : AGENT_COLORS[colorIndex++ % AGENT_COLORS.length];
    out.push({ ...n, depth, color, children: children.map(c => c.id) });
    for (const c of children) walk(c, depth + 1);
  };
  roots.forEach(r => walk(r, 0));
  return out;
}

export function subtreeIds(nodes: OrderedNode[], rootId: string) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parent && ids.has(n.parent) && !ids.has(n.id)) {
        ids.add(n.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function groupMessages(edges: GraphEdge[]) {
  const pairs = new Map<string, { from: string; to: string; messages: GraphEdge[] }>();
  for (const e of edges) {
    if (e.kind !== "message") continue;
    const key = `${e.from}>${e.to}`;
    const pair = pairs.get(key) ?? { from: e.from, to: e.to, messages: [] };
    pair.messages.push(e);
    pairs.set(key, pair);
  }
  return [...pairs.values()];
}
