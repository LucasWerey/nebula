import type { ReactNode } from "react";

type LegendProps = { color: string; children: ReactNode };

export function LegendLine({ color, dashed, faint, children }: LegendProps & { dashed?: boolean; faint?: boolean }) {
  return (
    <span className="inline-flex items-center gap-6">
      <svg width="18" height="10" aria-hidden>
        <line
          x1="0"
          x2="18"
          y1="5"
          y2="5"
          style={{ stroke: color }}
          strokeWidth={2}
          strokeDasharray={dashed ? "4 3" : faint ? "2 3" : undefined}
          opacity={faint ? 0.45 : 1}
        />
      </svg>
      {children}
    </span>
  );
}

export function LegendBar({ color, children }: LegendProps) {
  return (
    <span className="inline-flex items-center gap-6">
      <svg width="18" height="10" aria-hidden>
        <rect x="0" y="1" width="18" height="8" rx="2" style={{ fill: color }} />
      </svg>
      {children}
    </span>
  );
}
