import {
  ListItem,
  ListItemContent,
  ListItemDescription,
  ListItemLeading,
  ListItemTitle,
  ListItemTrailing,
  SegmentedControl,
  SegmentedControlButton,
  Spinner,
  Tag,
} from "@ledgerhq/lumen-ui-react";
import { Bell, Warning } from "@ledgerhq/lumen-ui-react/symbols";
import type { Overview, SessionSummary } from "../../api/types";
import { ContextGauge } from "../../components/ContextGauge";
import { StatusDot } from "../../components/StatusDot";
import { ago, money } from "../../lib/format";

type Props = {
  overview: Overview | null;
  loading: boolean;
  needsYou: Record<string, unknown>;
  selected: string | null;
  onSelect: (id: string) => void;
  hours: number;
  onHoursChange: (hours: number) => void;
};

const HOURS = [
  { value: "6", label: "6h" },
  { value: "24", label: "24h" },
  { value: "72", label: "3d" },
  { value: "168", label: "7d" },
];

type RowProps = { session: SessionSummary; now: number; selected: boolean; needsYou: boolean; onSelect: (id: string) => void };

function SessionRow({ session: s, now, selected, needsYou, onSelect }: RowProps) {
  const running = s.subagents.filter(a => a.running).length;
  const act = s.main?.activity;
  const ended = s.status === "ended";
  const alert = s.alerts.find(a => a.kind !== "context") ?? s.alerts[0];
  return (
    <ListItem active={selected} onClick={() => onSelect(s.sessionId)} className="items-start">
      <ListItemLeading>
        <StatusDot status={s.status} className="mt-6" />
        <ListItemContent>
          <ListItemTitle>{s.title ?? s.name ?? s.sessionId.slice(0, 8)}</ListItemTitle>
          <ListItemDescription>
            <code className="block truncate">{s.cwd ?? "—"}</code>
          </ListItemDescription>
          {!ended && alert ? (
            <ListItemDescription>
              <span className="flex items-center gap-4 truncate text-warning">
                <Warning size={12} className="shrink-0" />
                {alert.agentLabel ? `${alert.agentLabel}: ` : ""}
                {alert.message}
              </span>
            </ListItemDescription>
          ) : !ended && act ? (
            <ListItemDescription>
              <span className="block truncate">
                {act.kind === "tool" && <code className="mr-4 text-base">{act.tool}</code>}
                {act.detail}
              </span>
            </ListItemDescription>
          ) : null}
          {!ended && s.main && (
            <div className="mt-4 w-full max-w-160">
              <ContextGauge used={s.main.contextTokens} window={s.main.contextWindow} compactions={s.main.compactions} compact />
            </div>
          )}
        </ListItemContent>
      </ListItemLeading>
      <ListItemTrailing>
        <span className="flex flex-col items-end gap-2">
          <span className="body-2-semi-bold text-base">{money(s.cost)}</span>
          {needsYou ? (
            <Tag size="sm" appearance="accent" icon={Bell} label="Needs you" />
          ) : (
            <span className="body-4 text-muted">{ended ? ago(s.lastActiveMs, now) : running ? `${running} sub running` : s.status}</span>
          )}
        </span>
      </ListItemTrailing>
    </ListItem>
  );
}

export function SessionList({ overview, loading, needsYou, selected, onSelect, hours, onHoursChange }: Props) {
  const now = overview?.now ?? Date.now();
  const row = (s: SessionSummary) => (
    <SessionRow key={s.sessionId} session={s} now={now} selected={selected === s.sessionId} needsYou={Boolean(needsYou[s.sessionId])} onSelect={onSelect} />
  );
  return (
    <nav className="flex flex-col gap-4 overflow-y-auto px-8 py-12">
      <h3 className="px-8 pt-4 body-4-semi-bold uppercase text-muted">Running · {overview?.live.length ?? 0}</h3>
      {overview?.live.length ? overview.live.map(row) : <p className="px-8 py-12 body-3 text-muted">No running session</p>}
      <div className="mt-12 flex items-center justify-between gap-8 px-8">
        <h3 className="flex items-center gap-6 body-4-semi-bold uppercase text-muted">
          Recent
          {loading && <Spinner size={12} aria-label="Loading sessions" />}
        </h3>
        <SegmentedControl selectedValue={String(hours)} onSelectedChange={v => onHoursChange(Number(v))} tabLayout="fit">
          {HOURS.map(h => (
            <SegmentedControlButton key={h.value} value={h.value}>
              {h.label}
            </SegmentedControlButton>
          ))}
        </SegmentedControl>
      </div>
      {overview?.recent.length ? overview.recent.map(row) : <p className="px-8 py-12 body-3 text-muted">Nothing in this window</p>}
    </nav>
  );
}
