import { cn } from "@ledgerhq/lumen-design-core/cn";
import { tokens } from "../lib/format";

type Props = { used: number; window: number; compactions?: number; compact?: boolean };

export function contextLevel(used: number, window: number) {
  const ratio = window > 0 ? used / window : 0;
  return { ratio, percent: Math.round(ratio * 100), warn: ratio >= 0.8, critical: ratio >= 0.92 };
}

export function ContextGauge({ used, window, compactions = 0, compact = false }: Props) {
  const { ratio, percent, warn, critical } = contextLevel(used, window);
  const fill = critical ? "bg-error" : warn ? "bg-warning" : "bg-accent";
  return (
    <div className="flex min-w-0 flex-col gap-4" title={`${tokens(used)} of ${tokens(window)} tokens${compactions ? ` · compacted ${compactions}×` : ""}`}>
      {!compact && (
        <div className="flex items-baseline justify-between gap-8 body-4 text-muted">
          <span>
            {tokens(used)} / {tokens(window)}
          </span>
          <span className={cn("body-4-semi-bold", critical ? "text-error" : warn ? "text-warning" : "text-base")}>{percent}%</span>
        </div>
      )}
      <div className={cn("w-full overflow-hidden rounded-full bg-muted", compact ? "h-2" : "h-4")} role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Context used">
        <div className={cn("h-full rounded-full", fill)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}
