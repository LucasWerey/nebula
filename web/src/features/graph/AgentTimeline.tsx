import { useMemo } from "react";
import { SegmentedControl, SegmentedControlButton } from "@ledgerhq/lumen-ui-react";
import type { GraphEdge } from "../../api/types";
import { Panel } from "../../components/Panel";
import { useHoverTip } from "../../components/HoverTip";
import { useElementWidth } from "../../components/useElementWidth";
import { isActiveStatus } from "../../components/StatusDot";
import { clock, span, truncate } from "../../lib/format";
import { ACCENT_COLOR, MESSAGE_COLOR, RETURN_COLOR, nodeName, type OrderedNode } from "./graph";
import { LegendBar, LegendLine } from "./Legend";

export type TimelineRange = "agents" | "1h" | "6h" | "all";

type Props = {
  nodes: OrderedNode[];
  edges: GraphEdge[];
  now: number;
  live: boolean;
  range: TimelineRange;
  onRangeChange: (range: TimelineRange) => void;
  selectedAgent: string;
  onSelectAgent: (id: string) => void;
};

const LABEL = 200;
const RIGHT = 16;
const LANE = 30;
const CONC = 40;
const AXIS = 22;
const TOP = CONC + AXIS + 6;
const MIN_SEGMENT = 15_000;
const HOUR = 3_600_000;
const TICK_STEPS = [5e3, 1e4, 3e4, 6e4, 12e4, 3e5, 6e5, 9e5, 18e5, 36e5, 72e5, 108e5, 216e5, 432e5, 864e5];

function computeRange(nodes: OrderedNode[], now: number, range: TimelineRange): [number, number] {
  const started = nodes.filter(n => n.start != null);
  const subs = started.filter(n => n.id !== "main");
  const latest = Math.max(...started.map(n => n.end ?? now), 0) || now;
  if (range === "1h") return [latest - HOUR, latest];
  if (range === "6h") return [latest - 6 * HOUR, latest];
  if (range === "all") return [Math.min(...started.map(n => n.start ?? latest)), latest];
  if (!subs.length) return [latest - HOUR, latest];
  const t0 = Math.min(...subs.map(n => n.start ?? latest));
  const t1 = Math.max(...subs.map(n => n.end ?? now));
  const pad = Math.max((t1 - t0) * 0.04, 20_000);
  return [t0 - pad, t1 + pad];
}

function activeSegments(n: OrderedNode, now: number): [number, number][] {
  const list = n.segments.map(([a, b]): [number, number] => [a, Math.max(b, a + MIN_SEGMENT)]);
  if (isActiveStatus(n.status) && list.length) list[list.length - 1][1] = now;
  return list;
}

export function AgentTimeline({ nodes, edges, now, live, range, onRangeChange, selectedAgent, onSelectAgent }: Props) {
  const { ref, width: measured } = useElementWidth<HTMLDivElement>();
  const tip = useHoverTip();
  const W = Math.max(measured, 560);
  const plotW = W - LABEL - RIGHT;
  const [t0, t1] = computeRange(nodes, now, range);
  const duration = Math.max(t1 - t0, 1);
  const X = (t: number) => LABEL + ((t - t0) / duration) * plotW;
  const laneY = new Map(nodes.map((n, i) => [n.id, TOP + i * LANE]));
  const H = TOP + nodes.length * LANE + 6;
  const segments = useMemo(() => nodes.map(n => activeSegments(n, now)), [nodes, now]);

  const concurrency = useMemo(() => {
    const bins = Math.max(60, Math.floor(plotW / 3));
    const counts = Array.from({ length: bins }, (_, i) => {
      const t = t0 + ((i + 0.5) / bins) * duration;
      return segments.reduce((c, list) => c + (list.some(([a, b]) => a <= t && t <= b) ? 1 : 0), 0);
    });
    return { bins, counts };
  }, [segments, t0, duration, plotW]);

  const peak = Math.max(0, ...concurrency.counts);
  const peakAt = t0 + ((concurrency.counts.indexOf(peak) + 0.5) / concurrency.bins) * duration;
  const cy = (c: number) => CONC - 4 - (c / Math.max(1, peak)) * (CONC - 14);
  const area =
    `M${LABEL},${CONC - 4} ` +
    concurrency.counts
      .map((c, i) => `L${LABEL + (i / concurrency.bins) * plotW},${cy(c)} L${LABEL + ((i + 1) / concurrency.bins) * plotW},${cy(c)}`)
      .join(" ") +
    ` L${LABEL + plotW},${CONC - 4} Z`;

  const step = TICK_STEPS.find(s => duration / s <= plotW / 95) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const multiDay = duration > 864e5 || new Date(t0).toDateString() !== new Date(t1).toDateString();
  const tickLabel = (t: number) => {
    const d = new Date(t);
    const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: step < 6e4 ? "2-digit" : undefined });
    return multiDay && (step >= HOUR || d.getHours() === 0) ? `${d.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} ${hm}` : hm;
  };
  const offset = new Date(t0).getTimezoneOffset() * 6e4;
  const ticks: number[] = [];
  for (let t = Math.ceil((t0 - offset) / step) * step + offset; t <= t1; t += step) ticks.push(t);

  const colors = new Map(nodes.map(n => [n.id, n.color]));
  const names = new Map(nodes.map(n => [n.id, nodeName(n)]));
  const visible = edges.filter(e => e.ts != null && e.ts >= t0 && e.ts <= t1 && laneY.has(e.from) && laneY.has(e.to));
  const hidden = edges.filter(e => e.ts != null && (e.ts < t0 || e.ts > t1)).length;

  return (
    <Panel
      title="Timeline"
      description={`who works when, and how agents interact${hidden ? ` · ${hidden} interactions outside this range` : ""}`}
      actions={
        <SegmentedControl selectedValue={range} onSelectedChange={v => onRangeChange(v as TimelineRange)} tabLayout="fit">
          <SegmentedControlButton value="agents">Subagent window</SegmentedControlButton>
          <SegmentedControlButton value="1h">1h</SegmentedControlButton>
          <SegmentedControlButton value="6h">6h</SegmentedControlButton>
          <SegmentedControlButton value="all">Whole session</SegmentedControlButton>
        </SegmentedControl>
      }
      footer={
        <>
          <LegendBar color={ACCENT_COLOR}>working</LegendBar>
          <LegendLine color={ACCENT_COLOR} faint>
            alive, waiting
          </LegendLine>
          <LegendLine color={ACCENT_COLOR}>spawn</LegendLine>
          <LegendLine color={RETURN_COLOR}>result back to parent</LegendLine>
          <LegendLine color={MESSAGE_COLOR} dashed>
            message
          </LegendLine>
          {live && <LegendLine color="var(--color-background-error)" dashed>now</LegendLine>}
        </>
      }
    >
      <div ref={ref} className="w-full">
        {measured > 0 && (
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block">
            <defs>
              <marker id="tl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" style={{ fill: "context-stroke" }} />
              </marker>
              <linearGradient id="tl-conc" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" style={{ stopColor: ACCENT_COLOR, stopOpacity: 0.55 }} />
                <stop offset="100%" style={{ stopColor: ACCENT_COLOR, stopOpacity: 0.05 }} />
              </linearGradient>
            </defs>

            <line x1={LABEL} x2={LABEL + plotW} y1={CONC - 4} y2={CONC - 4} style={{ stroke: "var(--color-border-muted-subtle)" }} />
            {ticks.map(t => (
              <g key={t}>
                <line x1={X(t)} x2={X(t)} y1={CONC + 2} y2={H} style={{ stroke: "var(--color-border-muted-subtle)" }} />
                <text x={X(t)} y={CONC + AXIS - 6} fontSize={10.5} textAnchor="middle" style={{ fill: "var(--color-text-muted-subtle)" }}>
                  {tickLabel(t)}
                </text>
              </g>
            ))}

            <text x={8} y={16} fontSize={11} fontWeight={600} style={{ fill: "var(--color-text-muted)" }}>
              Agents working at once
            </text>
            <text x={8} y={31} fontSize={10.5} style={{ fill: "var(--color-text-muted-subtle)" }}>
              {`peak ${peak}${peak ? ` at ${clock(peakAt)}` : ""}`}
            </text>
            <path
              d={area}
              style={{
                fill: "url(#tl-conc)",
                stroke: ACCENT_COLOR,
              }}
              strokeWidth={1.2}
            />

            {nodes.map((n, i) => {
              const y = laneY.get(n.id) ?? 0;
              const mid = y + LANE / 2;
              const selected = selectedAgent === n.id;
              return (
                <g key={n.id}>
                  {i % 2 === 0 && <rect x={LABEL} y={y} width={plotW} height={LANE} style={{ fill: "var(--color-background-muted-transparent)", opacity: 0.45 }} />}
                  <g className="cursor-pointer" onClick={() => onSelectAgent(n.id)} {...tip(`${n.type}\n${n.description ?? ""}`)}>
                    <rect x={0} y={y} width={LABEL - 6} height={LANE} fill="transparent" />
                    <rect x={8 + n.depth * 12} y={mid - 5} width={10} height={10} rx={2} style={{ fill: n.color }} />
                    <text
                      x={24 + n.depth * 12}
                      y={mid + 4}
                      fontSize={11.5}
                      fontWeight={selected ? 650 : 500}
                      style={{ fill: selected ? "var(--color-text-base)" : "var(--color-text-muted)" }}
                    >
                      {truncate(nodeName(n), Math.max(10, 25 - n.depth * 2))}
                    </text>
                  </g>
                  {n.start != null && n.id !== "main" && (
                    <line
                      x1={X(Math.max(n.start, t0))}
                      x2={X(Math.min(n.end ?? now, t1))}
                      y1={mid}
                      y2={mid}
                      style={{ stroke: n.color }}
                      strokeWidth={2}
                      opacity={0.35}
                      strokeDasharray="2 3"
                    />
                  )}
                  {segments[i]
                    .filter(([a, b]) => b >= t0 && a <= t1)
                    .map(([a, b]) => {
                      const x1 = X(Math.max(a, t0));
                      const x2 = X(Math.min(b, t1));
                      return (
                        <rect
                          key={a}
                          x={x1}
                          y={mid - 5}
                          width={Math.max(3, x2 - x1)}
                          height={10}
                          rx={5}
                          style={{ fill: n.color }}
                          className="cursor-help"
                          {...tip(`${nodeName(n)} active\n${clock(a)} → ${clock(b)} (${span(b - a)})`)}
                        />
                      );
                    })}
                </g>
              );
            })}

            {visible.map((e, i) => {
              const x = X(e.ts ?? 0);
              const y1 = (laneY.get(e.from) ?? 0) + LANE / 2;
              const y2 = (laneY.get(e.to) ?? 0) + LANE / 2;
              const dir = y2 > y1 ? 1 : -1;
              const color = e.kind === "spawn" ? colors.get(e.to) : e.kind === "return" ? RETURN_COLOR : MESSAGE_COLOR;
              const label = e.kind === "spawn" ? "spawn" : e.kind === "return" ? "result" : "message";
              const text = `${label} · ${clock(e.ts)}\n${names.get(e.from)} → ${names.get(e.to)}${e.label ? `\n${truncate(e.label, 140)}` : ""}`;
              return (
                <g key={`${e.kind}-${e.from}-${e.to}-${e.ts}-${i}`}>
                  {e.kind === "spawn" && <circle cx={x} cy={y1} r={3} style={{ fill: color }} />}
                  <line
                    x1={x}
                    x2={x}
                    y1={y1}
                    y2={y2 - dir * 7}
                    style={{ stroke: color }}
                    strokeWidth={1.2}
                    opacity={0.6}
                    strokeDasharray={e.kind === "message" ? "2 4" : undefined}
                    strokeLinecap="round"
                    markerEnd="url(#tl-arrow)"
                  />
                  <line x1={x} x2={x} y1={Math.min(y1, y2)} y2={Math.max(y1, y2)} stroke="transparent" strokeWidth={9} className="cursor-help" {...tip(text)} />
                </g>
              );
            })}

            {live && now >= t0 && now <= t1 && (
              <line x1={X(now)} x2={X(now)} y1={CONC + 2} y2={H} style={{ stroke: "var(--color-background-error)" }} strokeWidth={1.2} strokeDasharray="3 3" />
            )}
          </svg>
        )}
      </div>
    </Panel>
  );
}
