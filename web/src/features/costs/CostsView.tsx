import { useState } from "react";
import {
  Banner,
  Button,
  SegmentedControl,
  SegmentedControlButton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableHeaderRow,
  TableRoot,
  TableRow,
} from "@ledgerhq/lumen-ui-react";
import { LineChart, Scrubber } from "@ledgerhq/lumen-ui-react/visualization";
import type { CostReport } from "../../api/types";
import { usePolling } from "../../api/usePolling";
import { withTz } from "../../lib/timezone";
import { Panel } from "../../components/Panel";
import { money, tokens } from "../../lib/format";
import { readStored, writeStored } from "../../lib/storage";

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];
const BAR_COLOR = "var(--agent-1)";
const MAX_BARS = 8;

const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" });

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-muted-subtle bg-canvas-sheet px-16 py-12">
      <div className="body-4 text-muted">{label}</div>
      <div className="heading-3-semi-bold text-base">{value}</div>
      <div className="min-h-16 body-4 text-muted-subtle">{hint}</div>
    </div>
  );
}

type Bar = { key: string; label: string; value: number; hint?: string };

function BarList({ rows, total, mono }: { rows: Bar[]; total: number; mono?: boolean }) {
  const shown = rows.slice(0, MAX_BARS);
  const rest = rows.slice(MAX_BARS);
  const all = rest.length ? [...shown, { key: "__other", label: `Other (${rest.length})`, value: rest.reduce((n, r) => n + r.value, 0) }] : shown;
  const max = Math.max(...all.map(r => r.value), 0.0001);
  if (!all.length) return <p className="px-16 py-24 text-center body-3 text-muted">No spend in this range</p>;
  return (
    <ul className="flex flex-col gap-12 p-16">
      {all.map(r => (
        <li key={r.key} className="flex flex-col gap-4" title={`${r.label}: ${money(r.value)}`}>
          <div className="flex items-baseline justify-between gap-12 body-3">
            {mono ? <code className="min-w-0 truncate text-base">{r.label}</code> : <span className="min-w-0 truncate text-base">{r.label}</span>}
            <span className="shrink-0 text-muted">
              <span className="body-3-semi-bold text-base">{money(r.value)}</span> · {total ? Math.round((r.value / total) * 100) : 0}%{r.hint ? ` · ${r.hint}` : ""}
            </span>
          </div>
          <div className="h-8 w-full rounded-xs bg-muted-transparent">
            <div className="h-full rounded-xs" style={{ width: `${(r.value / max) * 100}%`, background: BAR_COLOR, minWidth: 2 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CostsView() {
  const [days, setDays] = useState(() => readStored("costDays", 30));
  const [showTable, setShowTable] = useState(false);
  const { data, error, stale } = usePolling<CostReport>(withTz(`/api/costs?days=${days}`), 5000);

  const changeDays = (value: number) => {
    setDays(value);
    writeStored("costDays", value);
  };

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center gap-8 body-2 text-muted">
        {error ? `Costs unavailable (${error})` : <Spinner size={24} />}
      </div>
    );
  }

  const b = data.breakdown;
  const today = data.daily[data.daily.length - 1]?.cost ?? 0;
  const activeDays = data.daily.filter(d => d.cost > 0);
  const busiest = data.daily.reduce((best, d) => (d.cost > best.cost ? d : best), data.daily[0] ?? { day: "", cost: 0 });
  const cacheCost = b.cacheRead + b.cacheWrite;
  const inputTokens = b.inputTokens + b.cacheReadTokens + b.cacheWriteTokens;
  const hitRate = inputTokens ? b.cacheReadTokens / inputTokens : 0;
  const labels = data.daily.map(d => dayLabel(d.day));
  const tickStep = Math.max(1, Math.ceil(labels.length / 10));

  return (
    <div className="flex flex-col gap-16">
      <header className="flex flex-wrap items-end gap-16">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <h1 className="heading-3-semi-bold text-base">Costs</h1>
          <p className="body-3 text-muted">API-equivalent spend across every session and subagent, from local transcripts.</p>
        </div>
        <SegmentedControl selectedValue={String(days)} onSelectedChange={v => changeDays(Number(v))} tabLayout="fit">
          {RANGES.map(r => (
            <SegmentedControlButton key={r.value} value={r.value}>
              {r.label}
            </SegmentedControlButton>
          ))}
        </SegmentedControl>
      </header>

      {data.warming && (
        <Banner
          appearance="info"
          title={`Reading transcripts… ${data.warming.done}/${data.warming.total}`}
          description="Figures fill in as older sessions are read. This only happens once."
        />
      )}
      {stale && !data.warming && <p className="flex items-center gap-6 body-4 text-muted"><Spinner size={12} /> Updating…</p>}

      <div className="grid grid-cols-2 gap-12 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={`Total · ${days} days`} value={money(data.total)} hint={`${tokens(b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens)} tokens`} />
        <Stat label="Average per day" value={money(data.total / Math.max(1, data.daily.length))} hint={`${activeDays.length} days with activity`} />
        <Stat label="Today" value={money(today)} />
        <Stat label="Busiest day" value={money(busiest.cost)} hint={busiest.day ? dayLabel(busiest.day) : ""} />
        <Stat label="Cache share of cost" value={`${data.total ? Math.round((cacheCost / data.total) * 100) : 0}%`} hint={`reads ${money(b.cacheRead)} · writes ${money(b.cacheWrite)}`} />
        <Stat label="Cache hit rate" value={`${Math.round(hitRate * 100)}%`} hint="input tokens served from cache" />
      </div>

      <Panel
        title="Spend per day"
        description="hover for daily values"
        actions={
          <Button size="sm" appearance="gray" onClick={() => setShowTable(v => !v)}>
            {showTable ? "Show chart" : "Show table"}
          </Button>
        }
      >
        {showTable ? (
          <TableRoot appearance="no-background">
            <Table>
              <TableHeader>
                <TableHeaderRow>
                  <TableHeaderCell>Day</TableHeaderCell>
                  <TableHeaderCell align="end">Spend</TableHeaderCell>
                </TableHeaderRow>
              </TableHeader>
              <TableBody>
                {[...data.daily].reverse().map(d => (
                  <TableRow key={d.day}>
                    <TableCell>{dayLabel(d.day)}</TableCell>
                    <TableCell align="end">{money(d.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        ) : (
          <div className="px-8 py-12">
            <LineChart
              series={[{ id: "spend", label: "Spend", data: data.daily.map(d => Math.round(d.cost * 100) / 100), stroke: BAR_COLOR, curve: "linear" }]}
              height={260}
              inset={{ right: 28 }}
              showArea
              areaType="gradient"
              showXAxis
              showYAxis
              xAxis={{
                data: labels,
                ticks: labels.map((_, i) => i).filter(i => i % tickStep === 0 || i === labels.length - 1),
                tickLabelFormatter: v => (typeof v === "number" ? (labels[v] ?? "") : v),
              }}
              yAxis={{ showGrid: true, gridLineStyle: "dashed", tickLabelFormatter: v => money(Number(v)) }}
              enableScrubbing
            >
              <Scrubber showBeacons tooltip={i => ({ title: labels[i] ?? "", items: [{ label: "Spend", value: money(data.daily[i]?.cost ?? 0) }] })} />
            </LineChart>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-16 xl:grid-cols-2">
        <Panel title="By project" description={`${data.projects.length} folders`}>
          <BarList
            mono
            total={data.total}
            rows={data.projects.map(p => ({ key: p.project, label: p.project, value: p.cost, hint: `${p.sessions} session${p.sessions === 1 ? "" : "s"}` }))}
          />
        </Panel>
        <Panel title="By model" description={`${data.models.length} model${data.models.length === 1 ? "" : "s"}`}>
          <BarList total={data.total} rows={data.models.map(m => ({ key: m.model, label: m.model, value: m.cost }))} />
        </Panel>
      </div>

      <p className="body-4 text-muted-subtle">
        Costs are API-equivalent estimates from token usage at list prices; subscription plans are billed differently.
      </p>
    </div>
  );
}
