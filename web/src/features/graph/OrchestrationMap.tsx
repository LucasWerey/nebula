import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Button, IconButton, SegmentedControl, SegmentedControlButton } from "@ledgerhq/lumen-ui-react";
import { Expand, Minus, Plus, Refresh } from "@ledgerhq/lumen-ui-react/symbols";
import type { GraphEdge } from "../../api/types";
import { Panel } from "../../components/Panel";
import { useHoverTip } from "../../components/HoverTip";
import { useElementWidth } from "../../components/useElementWidth";
import { usePrefersReducedMotion } from "../../components/usePrefersReducedMotion";
import { ago, clock, money, span, truncate } from "../../lib/format";
import { readStored, writeStored } from "../../lib/storage";
import { groupMessages, nodeName, subtreeIds, type OrderedNode, type Point } from "./graph";
import {
  HEART_R,
  buildStreamLanes,
  fitView,
  heartLabelBox,
  isHub,
  LABEL_LINE_H,
  laneMidpoint,
  lanePath,
  orbRadius,
  placeLabels,
  radialLayout,
  type LabelLayout,
  type StreamMode,
  type View,
} from "./orbit";
import { useMapPositions } from "./useMapPositions";
import { useParticleStreams, type StreamLane, type StreamScene } from "./useParticleStreams";

type Props = {
  sessionId: string;
  nodes: OrderedNode[];
  edges: GraphEdge[];
  now: number;
  selectedAgent: string;
  onSelectAgent: (id: string) => void;
};

type Drag =
  | { kind: "node"; nodeId: string; origin: Map<string, Point>; x: number; y: number; moved: boolean }
  | { kind: "pan"; x: number; y: number; view: View; moved: boolean };

const HEIGHT = 600;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const rgb = (token: string, alpha = 1) => `rgb(var(${token}) / ${alpha})`;
const BONE = (a = 1) => rgb("--aos-bone", a);
const RUN = (a = 1) => rgb("--aos-run", a);
const IDLE = (a = 1) => rgb("--aos-idle", a);
const MSG = (a = 1) => rgb("--aos-msg", a);
const ORB = rgb("--aos-orb");

const isActive = (status: string) => status === "running" || status === "busy";
const statusFill = (status: string) => (isActive(status) ? RUN() : status === "done" || status === "ended" ? IDLE(0.45) : IDLE());

export function OrchestrationMap({ sessionId, nodes, edges, now, selectedAgent, onSelectAgent }: Props) {
  const { positions, move, persist, reset, customized } = useMapPositions(`aos:${sessionId}`);
  const layout = useMemo(() => radialLayout(nodes), [nodes]);
  const { ref: boxRef, width } = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [dragging, setDragging] = useState<Set<string>>(new Set());
  const [panning, setPanning] = useState(false);
  const [mode, setMode] = useState<StreamMode>(() => readStored("streams", "full"));
  const reducedMotion = usePrefersReducedMotion();
  const streams: StreamMode = reducedMotion ? "lines" : mode;
  const tip = useHoverTip();

  const pos = useCallback((id: string): Point => positions[id] ?? layout[id] ?? { x: 0, y: 0 }, [positions, layout]);
  const fit = useCallback(() => setView(fitView(nodes.map(n => pos(n.id)), width, HEIGHT, 150)), [nodes, pos, width]);

  useEffect(() => {
    if (width > 0 && !view) fit();
  }, [width, view, fit]);

  useEffect(() => writeStored("streams", mode), [mode]);

  const v = view ?? { x: -width / 2, y: -HEIGHT / 2, k: 1 };
  const lanes = buildStreamLanes(nodes, edges, pos, Date.now());
  const main = nodes.find(n => n.id === "main");
  const scene: StreamScene = {
    lanes,
    nodes: nodes.map(n => ({ ...pos(n.id), r: orbRadius(n) })),
    boxes: main ? [heartLabelBox(pos(main.id))] : [],
    view: v,
    width,
    height: HEIGHT,
    mode: streams,
    heartbeat: main?.status === "busy",
  };
  const sceneRef = useRef<StreamScene>(scene);
  sceneRef.current = scene;
  useParticleStreams(canvasRef, sceneRef, !reducedMotion && width > 0);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setView(prev => {
        const current = prev ?? { x: -width / 2, y: -HEIGHT / 2, k: 1 };
        const factor = Math.min(1.43, Math.max(0.7, Math.exp(-e.deltaY * 0.0015)));
        const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current.k * factor));
        const wx = sx / current.k + current.x;
        const wy = sy / current.k + current.y;
        return { k, x: wx - sx / k, y: wy - sy / k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [width]);

  const zoomBy = (factor: number) =>
    setView(prev => {
      const current = prev ?? v;
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current.k * factor));
      const cx = current.x + width / (2 * current.k);
      const cy = current.y + HEIGHT / (2 * current.k);
      return { k, x: cx - width / (2 * k), y: cy - HEIGHT / (2 * k) };
    });

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const nodeEl = (e.target as Element).closest<SVGGElement>("[data-node]");
    e.currentTarget.setPointerCapture(e.pointerId);
    if (nodeEl?.dataset.node) {
      const ids = e.shiftKey ? subtreeIds(nodes, nodeEl.dataset.node) : new Set([nodeEl.dataset.node]);
      drag.current = { kind: "node", nodeId: nodeEl.dataset.node, origin: new Map([...ids].map(id => [id, pos(id)])), x: e.clientX, y: e.clientY, moved: false };
      setDragging(ids);
      return;
    }
    drag.current = { kind: "pan", x: e.clientX, y: e.clientY, view: v, moved: false };
    setPanning(true);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.kind === "pan") {
      setView({ ...d.view, x: d.view.x - dx / d.view.k, y: d.view.y - dy / d.view.k });
      return;
    }
    const patch: Record<string, Point> = {};
    for (const [id, p] of d.origin) patch[id] = { x: Math.round(p.x + dx / v.k), y: Math.round(p.y + dy / v.k) };
    move(patch);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(new Set());
    setPanning(false);
    if (d?.kind !== "node") return;
    if (d.moved) persist();
    else onSelectAgent(d.nodeId);
  };

  const messages = groupMessages(edges);
  const msgCount = messages.reduce((n, p) => n + p.messages.length, 0);
  const subs = nodes.filter(n => n.id !== "main");
  const running = subs.filter(n => n.status === "running").length;
  const center = pos(nodes.find(n => n.depth === 0)?.id ?? "main");
  const labels = placeLabels(nodes, pos, center, n => ({ name: n.description ?? n.name ?? n.type, sub: orbSubline(n, now) }));

  return (
    <Panel
      title="Orchestration map"
      description={`${subs.length} subagent${subs.length === 1 ? "" : "s"} · ${running} running · ${msgCount} message${msgCount === 1 ? "" : "s"}`}
      actions={
        <>
          {customized && (
            <Button size="sm" appearance="gray" icon={Refresh} onClick={reset}>
              Reset layout
            </Button>
          )}
          <SegmentedControl selectedValue={streams} onSelectedChange={value => setMode(value as StreamMode)} tabLayout="fit" disabled={reducedMotion}>
            <SegmentedControlButton value="full">Full</SegmentedControlButton>
            <SegmentedControlButton value="quiet">Quiet</SegmentedControlButton>
            <SegmentedControlButton value="lines">Lines</SegmentedControlButton>
          </SegmentedControl>
        </>
      }
      footer={<span className="ml-auto">scroll to zoom · drag to pan · drag a node to move it · shift-drag moves its branch · click opens its log</span>}
    >
      <div ref={boxRef} className="relative w-full overflow-hidden" style={{ height: HEIGHT, background: "var(--aos-bg)" }}>
        {width > 0 && (
          <svg
            ref={svgRef}
            width={width}
            height={HEIGHT}
            viewBox={`${v.x} ${v.y} ${width / v.k} ${HEIGHT / v.k}`}
            className="absolute inset-0 block select-none"
            style={{ touchAction: "none", cursor: panning ? "grabbing" : "default" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <defs>
              <radialGradient id="aos-halo-run">
                <stop offset="0%" style={{ stopColor: RUN(0.38) }} />
                <stop offset="55%" style={{ stopColor: RUN(0.12) }} />
                <stop offset="100%" style={{ stopColor: RUN(0) }} />
              </radialGradient>
              <radialGradient id="aos-halo-idle">
                <stop offset="0%" style={{ stopColor: IDLE(0.18) }} />
                <stop offset="100%" style={{ stopColor: IDLE(0) }} />
              </radialGradient>
            </defs>

            {streams === "lines" && lanes.map(l => <LaneLine key={l.id} lane={l} />)}

            {messages.map(pair => {
              const lane = lanes.find(l => l.id === `msg:${pair.from}>${pair.to}`);
              const a = nodes.find(n => n.id === pair.from);
              const b = nodes.find(n => n.id === pair.to);
              if (!lane || !a || !b) return null;
              const mid = laneMidpoint(lane);
              const text = `${nodeName(a)} → ${nodeName(b)} · ${pair.messages.length} message${pair.messages.length > 1 ? "s" : ""}\n${pair.messages
                .slice(-6)
                .map(m => `${clock(m.ts)}  ${truncate(m.label, 90)}`)
                .join("\n")}`;
              return (
                <g key={lane.id} className="cursor-help" {...tip(text)}>
                  <circle cx={mid.x} cy={mid.y} r={9} style={{ fill: ORB, stroke: MSG(0.9) }} strokeWidth={1.2} />
                  <text x={mid.x} y={mid.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fontFamily={MONO} style={{ fill: MSG() }}>
                    {pair.messages.length}
                  </text>
                </g>
              );
            })}

            {nodes.map(n =>
              n.id === "main" ? (
                <Heart key={n.id} node={n} at={pos(n.id)} now={now} subs={subs} selected={selectedAgent === n.id} dragging={dragging.has(n.id)} />
              ) : (
                <Orb key={n.id} node={n} at={pos(n.id)} label={labels.get(n.id)} now={now} selected={selectedAgent === n.id} dragging={dragging.has(n.id)} />
              ),
            )}
          </svg>
        )}
        <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0" style={{ width, height: HEIGHT }} />

        <div className="pointer-events-none absolute left-16 top-12 flex gap-24" style={{ fontFamily: MONO, color: BONE(0.9) }}>
          {[
            { label: "SUBAGENTS", value: String(subs.length), total: null },
            { label: "RUNNING", value: String(running), total: subs.length },
            { label: "MESSAGES", value: String(msgCount), total: null },
          ].map(s => (
            <div key={s.label} className="flex flex-col">
              <span style={{ fontSize: 10.5, letterSpacing: "0.14em", color: BONE(0.55) }}>{s.label}</span>
              <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
                {s.value}
                {s.total != null && <span style={{ fontSize: 14, fontWeight: 500, color: BONE(0.5) }}>{`/${s.total}`}</span>}
              </span>
            </div>
          ))}
        </div>

        <div className="pointer-events-none absolute bottom-12 left-16 flex gap-16" style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.12em", color: BONE(0.8) }}>
          {[
            { label: "RUNNING", color: RUN() },
            { label: "IDLE", color: IDLE() },
            { label: "DONE", color: IDLE(0.45) },
            { label: "MESSAGE", color: MSG() },
          ].map(l => (
            <span key={l.label} className="inline-flex items-center gap-6">
              <span className="inline-block size-6 rounded-full" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>

        <div className="absolute bottom-12 right-12 flex flex-col gap-4">
          <IconButton aria-label="Zoom in" icon={Plus} size="xs" appearance="gray" onClick={() => zoomBy(1.25)} />
          <IconButton aria-label="Zoom out" icon={Minus} size="xs" appearance="gray" onClick={() => zoomBy(0.8)} />
          <IconButton aria-label="Fit to view" icon={Expand} size="xs" appearance="gray" onClick={fit} />
        </div>
      </div>
    </Panel>
  );
}

function LaneLine({ lane: l }: { lane: StreamLane }) {
  const d = lanePath(l);
  if (l.kind === "message") return <path d={d} fill="none" style={{ stroke: MSG(l.status === "running" ? 0.6 : 0.3) }} strokeWidth={1.3} strokeDasharray="1.5 4" strokeLinecap="round" />;
  if (l.status === "running") return <path d={d} fill="none" style={{ stroke: RUN(0.85) }} strokeWidth={1.8} strokeLinecap="round" />;
  if (l.status === "idle") return <path d={d} fill="none" style={{ stroke: IDLE(0.3) }} strokeWidth={1} strokeLinecap="round" />;
  return <path d={d} fill="none" style={{ stroke: IDLE(0.14) }} strokeWidth={1} strokeLinecap="round" />;
}

type HeartProps = { node: OrderedNode; at: Point; now: number; subs: OrderedNode[]; selected: boolean; dragging: boolean };

function Heart({ node: n, at, now, subs, selected, dragging }: HeartProps) {
  const tip = useHoverTip();
  const busy = isActive(n.status);
  const running = subs.filter(s => s.status === "running").length;
  const ring = selected || dragging ? BONE(0.95) : busy ? RUN(0.9) : IDLE(0.6);
  return (
    <g
      data-node={n.id}
      transform={`translate(${at.x} ${at.y})`}
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      {...tip(`main session\n${n.description ?? ""}\nstatus ${n.status} · ${money(n.cost)}`)}
    >
      <circle r={HEART_R + 38} fill={busy ? "url(#aos-halo-run)" : "url(#aos-halo-idle)"} />
      {busy && (
        <>
          <circle r={HEART_R + 8} className="heart-ripple" style={{ fill: "none", stroke: RUN(0.5) }} strokeWidth={1} />
          <circle r={HEART_R + 8} className="heart-ripple delayed" style={{ fill: "none", stroke: RUN(0.5) }} strokeWidth={1} />
        </>
      )}
      <circle r={HEART_R} style={{ fill: ORB, stroke: ring }} strokeWidth={selected || dragging ? 2.2 : 1.6} />
      <circle r={HEART_R + 4} className={busy ? "tick-spin" : undefined} style={{ fill: "none", stroke: ring, opacity: 0.35 }} strokeWidth={1} strokeDasharray="1 5" />
      <circle r={HEART_R * 0.36} style={{ fill: statusFill(n.status) }} />
      <text y={HEART_R + 26} textAnchor="middle" fontFamily={MONO} fontSize={11} letterSpacing={2.2} style={{ fill: BONE(0.75) }}>
        CLAUDE CODE
      </text>
      <text y={HEART_R + 47} textAnchor="middle" fontFamily={MONO} fontSize={16} fontWeight={700} letterSpacing={2.4} style={{ fill: busy ? RUN() : BONE(0.85) }}>
        {`MAIN · ${n.status.toUpperCase()}`}
      </text>
      <text y={HEART_R + 66} textAnchor="middle" fontFamily={MONO} fontSize={11.5} style={{ fill: BONE(0.6) }}>
        {`${subs.length} agents · ${running} running · ${money(n.cost)}`}
      </text>
      <text y={HEART_R + 82} textAnchor="middle" fontFamily={MONO} fontSize={11.5} style={{ fill: BONE(0.45) }}>
        {`last activity ${ago(n.end, now)}`}
      </text>
    </g>
  );
}

function orbSubline(n: OrderedNode, now: number) {
  if (isHub(n)) return `${n.children.length} agents · ${money(n.cost)}`;
  const dur = n.start ? span((n.end ?? now) - n.start) : "";
  return `${truncate(n.type, 16)} · ${n.status.toUpperCase()}${dur ? ` · ${dur}` : ""}`;
}

type OrbProps = { node: OrderedNode; at: Point; label: LabelLayout | undefined; now: number; selected: boolean; dragging: boolean };

function Orb({ node: n, at, label, now, selected, dragging }: OrbProps) {
  const tip = useHoverTip();
  const r = orbRadius(n);
  const running = n.status === "running";
  const hub = isHub(n);
  const highlight = selected || dragging;
  const dur = n.start ? span((n.end ?? now) - n.start) : "";
  const tipText = `${n.type}${n.name ? ` (${n.name})` : ""}\n${n.description ?? ""}\nstatus ${n.status} · ${money(n.cost)}${dur ? ` · ${dur}` : ""}${
    n.start ? `\nstarted ${clock(n.start)}` : ""
  }`;
  const side = label?.side ?? "right";
  const rect = label?.rect;
  const anchor = side === "right" ? "start" : side === "left" ? "end" : "middle";
  const tx = rect ? (side === "right" ? rect.x0 : side === "left" ? rect.x1 : (rect.x0 + rect.x1) / 2) - at.x : r + 12;
  const ty = rect ? rect.y0 - at.y + 13 : 0;
  const lines = label?.lines ?? [];

  return (
    <g data-node={n.id} transform={`translate(${at.x} ${at.y})`} style={{ cursor: dragging ? "grabbing" : "grab" }} {...tip(tipText)}>
      {running && <circle r={r + 22} fill="url(#aos-halo-run)" className="orb-breathe" />}
      <circle
        r={r}
        style={{ fill: ORB, stroke: highlight ? BONE(0.95) : running ? RUN(0.9) : BONE(0.16) }}
        strokeWidth={highlight ? 2.2 : running ? 1.6 : 1.2}
      />
      <circle r={hub ? r * 0.42 : r * 0.62} style={{ fill: statusFill(n.status) }} />
      {running && <path d={`M${-r * 0.72},${-r * 0.92} l4,4 l-4,4 l-4,-4 z`} style={{ fill: rgb("--aos-stall") }} />}
      <g pointerEvents="none">
        {lines.map((line, i) => (
          <text key={i} x={tx} y={ty + i * LABEL_LINE_H} textAnchor={anchor} fontSize={hub ? 14 : 13} fontWeight={hub ? 600 : 500} style={{ fill: BONE(0.95) }}>
            {line}
          </text>
        ))}
        <text x={tx} y={ty + lines.length * LABEL_LINE_H} textAnchor={anchor} fontFamily={MONO} fontSize={11} letterSpacing={0.4}>
          {hub ? (
            <tspan style={{ fill: BONE(0.6) }}>{orbSubline(n, now)}</tspan>
          ) : (
            <>
              <tspan style={{ fill: BONE(0.55) }}>{`${truncate(n.type, 16)} · `}</tspan>
              <tspan style={{ fill: running ? RUN() : BONE(0.55) }}>{n.status.toUpperCase()}</tspan>
              {dur && <tspan style={{ fill: BONE(0.4) }}>{` · ${dur}`}</tspan>}
            </>
          )}
        </text>
      </g>
    </g>
  );
}
