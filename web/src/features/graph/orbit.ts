import type { GraphEdge } from "../../api/types";
import { groupMessages, type OrderedNode, type Point } from "./graph";
import type { LaneStatus, StreamLane } from "./useParticleStreams";

export type StreamMode = "full" | "quiet" | "lines";
export type View = { x: number; y: number; k: number };

export const HEART_R = 60;
const RING = 230;
const RING_STEP = 180;
const MESSAGE_ACTIVE_MS = 20_000;
const LABEL_GAP = (100 * Math.PI) / 180;

export const heartLabelBox = (center: Point) => ({
  x0: center.x - 130,
  y0: center.y + HEART_R + 8,
  x1: center.x + 130,
  y1: center.y + HEART_R + 92,
});

export const isHub = (n: OrderedNode) => n.id !== "main" && n.children.length > 0;

export const orbRadius = (n: OrderedNode) => (n.id === "main" ? HEART_R : isHub(n) ? 26 : 19);

export function hash01(s: string, salt: number) {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function laneControl(l: Pick<StreamLane, "id" | "kind" | "x1" | "y1" | "x2" | "y2">): Point {
  const dx = l.x2 - l.x1;
  const dy = l.y2 - l.y1;
  const L0 = Math.hypot(dx, dy) || 1;
  const cs = l.x1 > l.x2 || (l.x1 === l.x2 && l.y1 > l.y2) ? -1 : 1;
  const sag = (hash01(l.id, 7) < 0.5 ? -1 : 1) * Math.min(20, (0.03 + 0.07 * hash01(l.id, 91)) * L0) * (l.kind === "message" ? -2 : 1);
  const off = 2 * sag * cs;
  return { x: (l.x1 + l.x2) / 2 + (-dy / L0) * off, y: (l.y1 + l.y2) / 2 + (dx / L0) * off };
}

export function lanePath(l: StreamLane) {
  const c = laneControl(l);
  return `M${l.x1},${l.y1} Q${c.x},${c.y} ${l.x2},${l.y2}`;
}

export function laneMidpoint(l: StreamLane): Point {
  const c = laneControl(l);
  return { x: 0.25 * l.x1 + 0.5 * c.x + 0.25 * l.x2, y: 0.25 * l.y1 + 0.5 * c.y + 0.25 * l.y2 };
}

export function radialLayout(nodes: OrderedNode[]): Record<string, Point> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const childrenOf = (n: OrderedNode) => n.children.map(id => byId.get(id)).filter((c): c is OrderedNode => Boolean(c));
  const leaves = new Map<string, number>();
  const countLeaves = (n: OrderedNode): number => {
    const kids = childrenOf(n);
    const value = kids.length ? kids.reduce((sum, k) => sum + countLeaves(k), 0) : 1;
    leaves.set(n.id, value);
    return value;
  };
  const roots = nodes.filter(n => n.depth === 0);
  roots.forEach(countLeaves);

  const firstRing = roots.length === 1 ? childrenOf(roots[0]).length : roots.length;
  const ring1 = Math.max(RING, (firstRing * 110) / (2 * Math.PI - LABEL_GAP));
  const radiusAt = (depth: number) => (depth === 0 ? 0 : ring1 + (depth - 1) * RING_STEP);
  const pos: Record<string, Point> = {};

  const placeAll = (list: OrderedNode[], a0: number, a1: number, depth: number) => {
    const total = list.reduce((sum, n) => sum + (leaves.get(n.id) ?? 1), 0) || 1;
    let start = a0;
    for (const n of list) {
      const share = ((a1 - a0) * (leaves.get(n.id) ?? 1)) / total;
      place(n, start, start + share, depth);
      start += share;
    }
  };
  const place = (n: OrderedNode, a0: number, a1: number, depth: number) => {
    const a = (a0 + a1) / 2;
    const r = radiusAt(depth);
    pos[n.id] = { x: r * Math.cos(a) * 1.35, y: r * Math.sin(a) * 0.9 };
    placeAll(childrenOf(n), a0, a1, depth + 1);
  };

  const top = -Math.PI / 2;
  if (roots.length === 1) {
    const root = roots[0];
    pos[root.id] = { x: 0, y: 0 };
    const start = Math.PI / 2 + LABEL_GAP / 2;
    placeAll(childrenOf(root), start, start + 2 * Math.PI - LABEL_GAP, 1);
  } else {
    const offset = Math.PI / Math.max(1, roots.length);
    placeAll(roots, top - offset, top - offset + 2 * Math.PI, 1);
  }
  return pos;
}

export type LabelSide = "left" | "right" | "top" | "bottom";
export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type LabelLayout = { side: LabelSide; rect: Rect; lines: string[] };

export const LABEL_LINE_H = 18;

export function wrapName(text: string, max = 22): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length <= max) {
      line = next;
      used++;
      continue;
    }
    if (line) lines.push(line);
    if (lines.length === 2) break;
    line = w;
    used++;
  }
  if (lines.length < 2 && line) lines.push(line);
  const out = lines.slice(0, 2).map(l => (l.length > max ? `${l.slice(0, max - 1)}…` : l));
  if (used < words.length && out.length === 2 && !out[1].endsWith("…")) out[1] = `${out[1].slice(0, max - 1)}…`;
  return out;
}

function preferredSide(p: Point, center: Point): LabelSide {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const c = dx / (Math.hypot(dx, dy) || 1);
  if (c > 0.12) return "right";
  if (c < -0.12) return "left";
  return dy < 0 ? "top" : "bottom";
}

export function labelRect(side: LabelSide, p: Point, r: number, w: number, h: number): Rect {
  const gap = r + 12;
  if (side === "right") return { x0: p.x + gap, y0: p.y - h / 2, x1: p.x + gap + w, y1: p.y + h / 2 };
  if (side === "left") return { x0: p.x - gap - w, y0: p.y - h / 2, x1: p.x - gap, y1: p.y + h / 2 };
  if (side === "top") return { x0: p.x - w / 2, y0: p.y - gap - h, x1: p.x + w / 2, y1: p.y - gap };
  return { x0: p.x - w / 2, y0: p.y + gap, x1: p.x + w / 2, y1: p.y + gap + h };
}

const overlapArea = (a: Rect, b: Rect, pad = 6) =>
  Math.max(0, Math.min(a.x1, b.x1) + pad - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) + pad - Math.max(a.y0, b.y0));

const circleRect = (p: Point, r: number): Rect => ({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });

export function placeLabels(
  nodes: OrderedNode[],
  pos: (id: string) => Point,
  center: Point,
  text: (n: OrderedNode) => { name: string; sub: string },
): Map<string, LabelLayout> {
  const orbs = nodes.filter(n => n.id !== "main");
  const obstacles: Rect[] = nodes.map(n => circleRect(pos(n.id), orbRadius(n) + 4));
  const main = nodes.find(n => n.id === "main");
  if (main) obstacles.push(heartLabelBox(pos(main.id)));
  const placed = new Map<string, LabelLayout>();
  const order = [...orbs].sort((a, b) => pos(a.id).y - pos(b.id).y);
  for (const n of order) {
    const p = pos(n.id);
    const r = orbRadius(n);
    const { name, sub } = text(n);
    const lines = wrapName(name);
    const w = Math.max(...lines.map(l => l.length * 7.2), sub.length * 6.8) + 4;
    const h = lines.length * LABEL_LINE_H + 16;
    const first = preferredSide(p, center);
    const horizontal: LabelSide[] = first === "left" ? ["left", "right"] : ["right", "left"];
    const candidates: LabelSide[] = [first, ...horizontal, "top", "bottom"].filter((s, i, all) => all.indexOf(s) === i) as LabelSide[];
    let best: LabelLayout | null = null;
    let bestCost = Infinity;
    for (const side of candidates) {
      const rect = labelRect(side, p, r, w, h);
      const cost = [...obstacles, ...[...placed.values()].map(l => l.rect)].reduce((sum, o) => sum + overlapArea(rect, o), 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = { side, rect, lines };
      }
      if (cost === 0) break;
    }
    if (best) placed.set(n.id, best);
  }
  return placed;
}

const laneStatus = (status: string): LaneStatus => (status === "running" ? "running" : status === "done" ? "done" : "idle");

export function buildStreamLanes(nodes: OrderedNode[], edges: GraphEdge[], pos: (id: string) => Point, now: number): StreamLane[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const lanes: StreamLane[] = [];
  for (const n of nodes) {
    const parent = n.parent ? byId.get(n.parent) : undefined;
    if (!parent) continue;
    const a = pos(parent.id);
    const b = pos(n.id);
    lanes.push({
      id: `spawn:${n.id}`,
      kind: parent.id === "main" ? "trunk" : "branch",
      status: laneStatus(n.status),
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      r1: orbRadius(parent),
      r2: orbRadius(n),
      spawnTs: edges.find(e => e.kind === "spawn" && e.to === n.id)?.ts ?? null,
      returnTs: edges.find(e => e.kind === "return" && e.from === n.id)?.ts ?? null,
      messageTs: null,
    });
  }
  for (const pair of groupMessages(edges)) {
    const from = byId.get(pair.from);
    const to = byId.get(pair.to);
    if (!from || !to) continue;
    const a = pos(from.id);
    const b = pos(to.id);
    const lastTs = Math.max(...pair.messages.map(m => m.ts ?? 0));
    lanes.push({
      id: `msg:${pair.from}>${pair.to}`,
      kind: "message",
      status: now - lastTs < MESSAGE_ACTIVE_MS ? "running" : "idle",
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      r1: orbRadius(from),
      r2: orbRadius(to),
      spawnTs: null,
      returnTs: null,
      messageTs: lastTs || null,
    });
  }
  return lanes;
}

export function fitView(points: Point[], width: number, height: number, margin = 150): View {
  if (!points.length || !width) return { x: -width / 2, y: -height / 2, k: 1 };
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs) - margin * 1.4;
  const maxX = Math.max(...xs) + margin * 1.4;
  const minY = Math.min(...ys) - margin * 0.6;
  const maxY = Math.max(...ys) + margin * 0.75;
  const k = Math.max(0.3, Math.min(1, width / (maxX - minX), height / (maxY - minY)));
  return { x: (minX + maxX) / 2 - width / (2 * k), y: (minY + maxY) / 2 - height / (2 * k), k };
}
