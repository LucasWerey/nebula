import type { Breakdown } from "../../api/types";
import { Panel } from "../../components/Panel";
import { money, tokens } from "../../lib/format";

export function CostBreakdown({ breakdown: b, totalTokens }: { breakdown: Breakdown; totalTokens: number }) {
  const parts = [
    { label: "Input", cost: b.input, tokens: b.inputTokens, color: "var(--color-background-decorative-blue)" },
    { label: "Output", cost: b.output, tokens: b.outputTokens, color: "var(--color-background-decorative-turquoise)" },
    { label: "Cache read", cost: b.cacheRead, tokens: b.cacheReadTokens, color: "var(--color-background-muted-strong)" },
    { label: "Cache write", cost: b.cacheWrite, tokens: b.cacheWriteTokens, color: "var(--color-background-decorative-orange)" },
    { label: "Web search", cost: b.other, tokens: null, color: "var(--color-background-decorative-pink)" },
  ].filter(p => p.cost > 0);
  const total = parts.reduce((n, p) => n + p.cost, 0) || 1;

  return (
    <Panel title="Cost breakdown" description={`${tokens(totalTokens)} tokens in total`}>
      <div className="flex flex-col gap-12 p-16">
        <div className="flex h-10 overflow-hidden rounded-full bg-muted">
          {parts.map(p => (
            <span key={p.label} title={p.label} style={{ width: `${(p.cost / total) * 100}%`, background: p.color }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-24 gap-y-6 body-3 text-muted">
          {parts.map(p => (
            <span key={p.label} className="inline-flex items-center gap-6">
              <span className="size-8 rounded-xs" style={{ background: p.color }} />
              {p.label}
              <span className="body-3-semi-bold text-base">{money(p.cost)}</span>
              {p.tokens != null && <span className="text-muted-subtle">· {tokens(p.tokens)} tok</span>}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}
