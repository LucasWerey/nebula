import type { ReactNode } from "react";
import type { SessionDetail } from "../../api/types";
import { ContextGauge } from "../../components/ContextGauge";
import { money } from "../../lib/format";

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-muted-subtle bg-canvas-sheet px-16 py-12">
      <div className="body-4 text-muted">{label}</div>
      <div className="heading-4-semi-bold text-base">{value}</div>
      <div className="min-h-16 body-4 text-muted-subtle">{hint}</div>
    </div>
  );
}

export function StatTiles({ session: s }: { session: SessionDetail }) {
  const subs = s.subagents;
  const sum = (pick: (a: { requests: number; toolCalls: number; errors: number }) => number) =>
    (s.main ? pick(s.main) : 0) + subs.reduce((n, a) => n + pick(a), 0);
  const running = subs.filter(a => a.running).length;
  const subCost = subs.reduce((n, a) => n + a.cost, 0);
  const main = s.main;

  return (
    <div className="grid grid-cols-2 gap-12 md:grid-cols-3 xl:grid-cols-6">
      <Tile label="Total cost" value={money(s.cost)} hint={subs.length ? `main ${money(main?.cost ?? 0)} · subagents ${money(subCost)}` : ""} />
      <Tile label="Today" value={money(s.todayCost)} />
      <Tile label="Requests" value={String(sum(a => a.requests))} />
      <Tile label="Tool calls" value={String(sum(a => a.toolCalls))} hint={`${sum(a => a.errors)} errors`} />
      <div className="flex flex-col gap-6 rounded-lg border border-muted-subtle bg-canvas-sheet px-16 py-12">
        <div className="body-4 text-muted">Context (main agent)</div>
        {main ? <ContextGauge used={main.contextTokens} window={main.contextWindow} compactions={main.compactions} /> : <span className="body-3 text-muted">—</span>}
        <div className="body-4 text-muted-subtle">{main?.compactions ? `auto-compacted ${main.compactions}×` : "never compacted"}</div>
      </div>
      <Tile label="Subagents" value={String(subs.length)} hint={running ? `${running} running` : "none running"} />
    </div>
  );
}
