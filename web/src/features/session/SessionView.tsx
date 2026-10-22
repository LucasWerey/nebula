import { memo, useMemo, useState } from "react";
import { Spinner } from "@ledgerhq/lumen-ui-react";
import type { SessionDetail } from "../../api/types";
import { usePolling } from "../../api/usePolling";
import { withTz } from "../../lib/timezone";
import { AlertBanners } from "../alerts/AlertBanners";
import { OrchestrationMap } from "../graph/OrchestrationMap";
import { AgentTimeline, type TimelineRange } from "../graph/AgentTimeline";
import { orderNodes } from "../graph/graph";
import { ActivityLog } from "./ActivityLog";
import { AgentsTable } from "./AgentsTable";
import { CostBreakdown } from "./CostBreakdown";
import { SessionHeader } from "./SessionHeader";
import { StatTiles } from "./StatTiles";
import { agentsOf } from "./agents";

export const SessionView = memo(function SessionView({ sessionId }: { sessionId: string }) {
  const { data: session, error } = usePolling<SessionDetail>(withTz(`/api/session/${encodeURIComponent(sessionId)}`), 2000);
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [range, setRange] = useState<TimelineRange>("agents");
  const nodes = useMemo(() => (session ? orderNodes(session.graph.nodes) : []), [session]);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center gap-8 body-2 text-muted">
        {error ? `Session unavailable (${error})` : <Spinner size={24} />}
      </div>
    );
  }

  const agents = agentsOf(session);
  const agent = agents.some(a => a.id === selectedAgent) ? selectedAgent : "all";

  return (
    <div className="flex flex-col gap-16">
      <SessionHeader session={session} />
      <AlertBanners alerts={session.alerts} onOpenAgent={setSelectedAgent} />
      <StatTiles session={session} />
      {nodes.length > 1 && (
        <OrchestrationMap
          sessionId={session.sessionId}
          nodes={nodes}
          edges={session.graph.edges}
          now={session.now}
          selectedAgent={agent}
          onSelectAgent={setSelectedAgent}
        />
      )}
      {nodes.length > 0 && (
        <AgentTimeline
          nodes={nodes}
          edges={session.graph.edges}
          now={session.now}
          live={session.status !== "ended"}
          range={range}
          onRangeChange={setRange}
          selectedAgent={agent}
          onSelectAgent={setSelectedAgent}
        />
      )}
      <AgentsTable agents={agents} now={session.now} selected={agent} onSelect={setSelectedAgent} />
      <ActivityLog agents={agents} selected={agent} onSelect={setSelectedAgent} />
      <CostBreakdown breakdown={session.breakdown} totalTokens={session.tokens} />
      <p className="body-4 text-muted-subtle">
        Costs are API-equivalent estimates from token usage at list prices; subscription plans are billed differently.
      </p>
    </div>
  );
});
