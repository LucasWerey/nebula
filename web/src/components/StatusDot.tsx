import { cn } from "@ledgerhq/lumen-design-core/cn";

const ACTIVE = new Set(["busy", "running"]);
const WAITING = new Set(["idle", "shell", "waiting"]);

export const isActiveStatus = (status: string) => ACTIVE.has(status);

export function statusColor(status: string) {
  if (ACTIVE.has(status)) return "var(--color-background-success)";
  if (WAITING.has(status)) return "var(--color-background-warning)";
  if (status === "error") return "var(--color-background-error)";
  return "var(--color-background-muted-strong)";
}

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return (
    <span
      aria-label={status}
      className={cn("inline-block size-8 shrink-0 rounded-full", ACTIVE.has(status) && "status-pulse", className)}
      style={{ background: statusColor(status) }}
    />
  );
}

export function statusTagAppearance(status: string) {
  if (ACTIVE.has(status)) return "success" as const;
  if (WAITING.has(status)) return "warning" as const;
  return "gray" as const;
}
