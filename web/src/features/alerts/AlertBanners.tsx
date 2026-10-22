import { Banner, Button } from "@ledgerhq/lumen-ui-react";
import type { AgentAlert } from "../../api/types";

const TITLES: Record<AgentAlert["kind"], string> = {
  "long-tool": "Long-running tool call",
  silent: "No activity",
  errors: "Error streak",
  context: "Context almost full",
};

type Props = { alerts: AgentAlert[]; onOpenAgent: (id: string) => void };

export function AlertBanners({ alerts, onOpenAgent }: Props) {
  if (!alerts.length) return null;
  return (
    <div className="flex flex-col gap-8">
      {alerts.map(alert => {
        const agent = alert.agent ?? "main";
        const who = agent === "main" ? "Main agent" : (alert.agentLabel ?? "Subagent");
        return (
          <Banner
            key={`${agent}:${alert.kind}`}
            appearance={alert.kind === "errors" ? "error" : "warning"}
            title={`${TITLES[alert.kind]} · ${alert.message}`}
            description={alert.detail ? `${who} — ${alert.detail}` : who}
            primaryAction={
              <Button size="sm" appearance="transparent" onClick={() => onOpenAgent(agent)}>
                Open log
              </Button>
            }
          />
        );
      })}
    </div>
  );
}
