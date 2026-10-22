import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Tag } from "@ledgerhq/lumen-ui-react";
import { Warning } from "@ledgerhq/lumen-ui-react/symbols";
import { Markdown } from "../../components/Markdown";
import { clock } from "../../lib/format";
import type { NeedsYouEntry } from "./useAttention";

type Props = {
  items: { id: string; entry: NeedsYouEntry }[];
  onOpen: (id: string) => void;
  onDismiss: (id: string) => void;
  onLater: () => void;
};

function Item({ id, entry, onOpen, onDismiss }: { id: string; entry: NeedsYouEntry; onOpen: (id: string) => void; onDismiss: (id: string) => void }) {
  return (
    <article className="flex flex-col gap-10 rounded-lg border border-muted-subtle p-16">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-8">
          <Tag size="sm" appearance="accent" label={entry.status} />
          <h3 className="min-w-0 truncate body-1-semi-bold text-base">{entry.title}</h3>
          <span className="ml-auto shrink-0 body-4 text-muted">{clock(entry.at)}</span>
        </div>
        {entry.cwd && <code className="truncate body-4 text-interactive">{entry.cwd}</code>}
      </header>

      <p className="body-2-semi-bold text-base">{entry.reason}</p>

      {entry.pendingAction && (
        <div className="rounded-md bg-muted-transparent px-12 py-10">
          <div className="body-4-semi-bold text-muted">Waiting to run</div>
          <code className="mt-2 block whitespace-pre-wrap break-all body-3 text-base">{entry.pendingAction}</code>
        </div>
      )}

      {entry.lastMessage && (
        <div className="rounded-md bg-muted-transparent px-12 py-10">
          <div className="body-4-semi-bold text-muted">Claude said</div>
          <div className="mt-4 max-h-320 overflow-y-auto">
            <Markdown>{entry.lastMessage}</Markdown>
          </div>
        </div>
      )}

      {entry.lastPrompt && (
        <p className="line-clamp-2 body-4 text-muted">
          <span className="body-4-semi-bold">Your last prompt: </span>
          {entry.lastPrompt}
        </p>
      )}

      {entry.alerts.length > 0 && (
        <ul className="flex flex-col gap-4">
          {entry.alerts.map(a => (
            <li key={`${a.agent ?? "main"}:${a.kind}`} className="flex items-center gap-6 body-4 text-warning">
              <Warning size={12} className="shrink-0" />
              {a.agentLabel ? `${a.agentLabel}: ` : ""}
              {a.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-8">
        <Button size="sm" appearance="accent" onClick={() => onOpen(id)}>
          Open session
        </Button>
        <Button size="sm" appearance="gray" onClick={() => onDismiss(id)}>
          Dismiss
        </Button>
      </div>
    </article>
  );
}

export function NeedsYouDialog({ items, onOpen, onDismiss, onLater }: Props) {
  const open = items.length > 0;
  return (
    <Dialog open={open} onOpenChange={next => !next && onLater()}>
      <DialogContent>
        <DialogHeader
          title={items.length > 1 ? `${items.length} sessions need you` : "A session needs you"}
          description="Here is why, as of when it stopped."
          onClose={onLater}
        />
        <DialogBody className="flex flex-col gap-12">
          {items.map(({ id, entry }) => (
            <Item key={id} id={id} entry={entry} onOpen={onOpen} onDismiss={onDismiss} />
          ))}
        </DialogBody>
        <DialogFooter>
          <Button appearance="gray" isFull onClick={onLater}>
            Later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
