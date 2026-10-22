import {
  SegmentedControl,
  SegmentedControlButton,
  Tag,
  Timeline,
  TimelineItem,
  TimelineItemBody,
  TimelineItemCaption,
  TimelineItemDescription,
  TimelineItemHeader,
  TimelineItemLeading,
  TimelineItemTitle,
  TimelineItemTrailing,
} from "@ledgerhq/lumen-ui-react";
import type { AgentEvent } from "../../api/types";
import { ImageStrip } from "../../components/ImagePreview";
import { Panel } from "../../components/Panel";
import { clock, span, truncate } from "../../lib/format";
import { eventsFor, type AgentView } from "./agents";

type Props = { agents: AgentView[]; selected: string; onSelect: (id: string) => void };

type TimelineStatus = "idle" | "success" | "error" | "pending" | "loading";

function itemStatus(event: AgentEvent): TimelineStatus | undefined {
  if (event.kind === "text") return "idle";
  if (event.kind === "prompt") return undefined;
  if (event.status === "error") return "error";
  if (event.status === "pending") return "loading";
  return "success";
}

function itemTitle(event: AgentEvent) {
  if (event.kind === "prompt") return "Prompt";
  if (event.kind === "text") return "Message";
  return event.tool ?? "Tool";
}

const agentLabel = (a: AgentView) => (a.id === "main" ? "main" : truncate(a.description ?? a.type, 28));

export function ActivityLog({ agents, selected, onSelect }: Props) {
  const events = eventsFor(agents, selected);
  const agent = agents.find(a => a.id === selected);

  return (
    <Panel
      title="Activity log"
      description="newest first · last 300 events per agent"
      footer={
        <div className="w-full overflow-x-auto">
          <SegmentedControl selectedValue={selected} onSelectedChange={onSelect} tabLayout="fit" appearance="no-background">
            <SegmentedControlButton value="all">All agents</SegmentedControlButton>
            {agents.map(a => (
              <SegmentedControlButton key={a.id} value={a.id}>
                {agentLabel(a)}
              </SegmentedControlButton>
            ))}
          </SegmentedControl>
        </div>
      }
    >
      {agent && (agent.task || agent.tools?.length) ? (
        <div className="flex flex-col gap-10 border-b border-muted-subtle px-16 py-12">
          {agent.task && (
            <div className="max-h-160 overflow-y-auto rounded-md bg-muted-transparent px-12 py-10">
              <div className="body-4-semi-bold text-muted">Task</div>
              <p className="mt-2 whitespace-pre-wrap body-3 text-base">{agent.task}</p>
            </div>
          )}
          {agent.tools?.length ? (
            <div className="flex flex-wrap gap-6">
              {agent.tools.map(t => (
                <Tag key={t.name} size="sm" appearance="gray" label={`${t.name} ×${t.count}`} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="max-h-560 overflow-y-auto px-16">
        {events.length ? (
          <Timeline>
            {events.map(({ event, agent: who }) => (
              <TimelineItem key={`${event.ts}-${event.tool ?? event.kind}-${event.detail.slice(0, 40)}`} status={itemStatus(event)}>
                <TimelineItemHeader>
                  <TimelineItemLeading>
                    {who && <TimelineItemCaption>{agentLabel(who)}</TimelineItemCaption>}
                    <TimelineItemTitle>
                      {event.kind === "tool" ? <code>{itemTitle(event)}</code> : itemTitle(event)}
                      {event.spawn && <span className="ml-6 text-muted">→ spawns {event.spawn}</span>}
                    </TimelineItemTitle>
                    <TimelineItemDescription>{event.detail}</TimelineItemDescription>
                  </TimelineItemLeading>
                  <TimelineItemTrailing>
                    <span className="flex flex-col items-end body-4 text-muted">
                      <span>{clock(event.ts)}</span>
                      {event.doneTs && <span className="text-muted-subtle">{span(Date.parse(event.doneTs) - Date.parse(event.ts))}</span>}
                    </span>
                  </TimelineItemTrailing>
                </TimelineItemHeader>
                {event.images?.length ? (
                  <TimelineItemBody>
                    <ImageStrip ids={event.images} />
                  </TimelineItemBody>
                ) : null}
                {event.result && (
                  <TimelineItemBody>
                    <details className="pb-8">
                      <summary className={event.status === "error" ? "cursor-pointer truncate body-4 text-error" : "cursor-pointer truncate body-4 text-muted"}>
                        {truncate(event.result, 160)}
                      </summary>
                      <pre className="mt-4 whitespace-pre-wrap rounded-sm bg-muted-transparent px-8 py-6 body-4 text-muted">{event.result}</pre>
                    </details>
                  </TimelineItemBody>
                )}
              </TimelineItem>
            ))}
          </Timeline>
        ) : (
          <p className="py-24 text-center body-3 text-muted">No activity yet</p>
        )}
      </div>
    </Panel>
  );
}
