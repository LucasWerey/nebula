import type { AgentEvent, AgentSummary, SessionDetail } from "../../api/types";

export type AgentView = AgentSummary & {
  id: string;
  type: string;
  description: string | null;
  status: string;
  background: boolean;
  task?: string | null;
};

export function agentsOf(session: SessionDetail): AgentView[] {
  const main: AgentView[] = session.main
    ? [
        {
          ...session.main,
          id: "main",
          type: "main",
          description: session.title ?? "Main session",
          status: session.status,
          background: false,
        },
      ]
    : [];
  return [
    ...main,
    ...session.subagents.map(a => ({
      ...a,
      status: a.running ? "running" : a.finished ? "done" : "idle",
    })),
  ];
}

export type LoggedEvent = { event: AgentEvent; agent: AgentView | null };

export function eventsFor(agents: AgentView[], selected: string): LoggedEvent[] {
  if (selected !== "all") {
    const agent = agents.find(a => a.id === selected);
    return [...(agent?.events ?? [])].reverse().map(event => ({ event, agent: null }));
  }
  return agents
    .flatMap(agent => (agent.events ?? []).map(event => ({ event, agent })))
    .sort((a, b) => b.event.ts.localeCompare(a.event.ts))
    .slice(0, 400);
}
