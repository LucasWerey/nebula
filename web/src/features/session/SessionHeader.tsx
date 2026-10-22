import { Tag } from "@ledgerhq/lumen-ui-react";
import type { SessionDetail } from "../../api/types";
import { statusTagAppearance } from "../../components/StatusDot";
import { ago, modelName, money, span } from "../../lib/format";

export function SessionHeader({ session: s }: { session: SessionDetail }) {
  const meta = [
    s.gitBranch && { label: "branch", value: s.gitBranch },
    { label: "model", value: modelName(s.main?.model) },
    s.startedAt && {
      label: "started",
      value: `${new Date(s.startedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} · up ${span(s.now - s.startedAt)}`,
    },
    { label: "last active", value: ago(s.lastActiveMs, s.now) },
    s.name && { label: "name", value: s.name },
    s.pid && { label: "pid", value: String(s.pid) },
    s.version && { label: "version", value: s.version },
  ].filter((m): m is { label: string; value: string } => Boolean(m));

  return (
    <header className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start gap-16">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="flex items-center gap-8">
            <Tag size="sm" appearance={statusTagAppearance(s.status)} label={s.status} />
            <h1 className="min-w-0 truncate heading-3-semi-bold text-base">{s.title ?? s.name ?? s.sessionId}</h1>
          </div>
          <code className="truncate body-3 text-interactive">{s.cwd ?? "unknown folder"}</code>
        </div>
        <span className="heading-2-semi-bold text-base">{money(s.cost)}</span>
      </div>
      <dl className="flex flex-wrap gap-x-16 gap-y-4 body-3">
        {meta.map(m => (
          <div key={m.label} className="flex gap-4">
            <dt className="text-muted">{m.label}</dt>
            <dd className="text-base">{m.value}</dd>
          </div>
        ))}
      </dl>
      {s.lastPrompt && (
        <div className="rounded-md bg-muted-transparent px-12 py-10">
          <div className="body-4-semi-bold text-muted">Last prompt</div>
          <p className="mt-2 line-clamp-3 whitespace-pre-wrap body-3 text-base">{s.lastPrompt}</p>
        </div>
      )}
    </header>
  );
}
