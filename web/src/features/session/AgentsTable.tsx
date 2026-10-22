import {
  Table,
  TableBody,
  TableCell,
  TableCellContent,
  TableCellContentDescription,
  TableCellContentTitle,
  TableHeader,
  TableHeaderCell,
  TableHeaderRow,
  TableRoot,
  TableRow,
  Tag,
} from "@ledgerhq/lumen-ui-react";
import { Panel } from "../../components/Panel";
import { StatusDot } from "../../components/StatusDot";
import { modelName, money, span, truncate } from "../../lib/format";
import type { AgentView } from "./agents";

type Props = { agents: AgentView[]; now: number; selected: string; onSelect: (id: string) => void };

export function AgentsTable({ agents, now, selected, onSelect }: Props) {
  return (
    <Panel title="Agents" description={`${agents.length} · click one to see its log`}>
      <TableRoot appearance="no-background" horizontalLayout={{ type: "scroll", minWidth: 880 }}>
        <Table>
          <TableHeader>
            <TableHeaderRow>
              <TableHeaderCell>Agent</TableHeaderCell>
              <TableHeaderCell>Model</TableHeaderCell>
              <TableHeaderCell align="end">Tools</TableHeaderCell>
              <TableHeaderCell align="end">Duration</TableHeaderCell>
              <TableHeaderCell align="end">Cost</TableHeaderCell>
              <TableHeaderCell>Last action</TableHeaderCell>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {agents.map(a => {
              const started = a.firstTs ? Date.parse(a.firstTs) : null;
              const end = a.status === "running" || a.status === "busy" ? now : a.lastActiveMs;
              const act = a.activity;
              return (
                <TableRow
                  key={a.id}
                  clickable
                  onClick={() => onSelect(a.id)}
                  className={selected === a.id ? "bg-active-subtle" : undefined}
                >
                  <TableCell>
                    <div className="flex items-center gap-10">
                      <StatusDot status={a.status} />
                      <TableCellContent>
                        <TableCellContentTitle>
                          <span className="inline-flex items-center gap-6">
                            <code>{a.type}</code>
                            {a.background && <Tag size="sm" appearance="gray" label="bg" />}
                          </span>
                        </TableCellContentTitle>
                        <TableCellContentDescription>{truncate(a.description, 56)}</TableCellContentDescription>
                      </TableCellContent>
                    </div>
                  </TableCell>
                  <TableCell>{modelName(a.model)}</TableCell>
                  <TableCell align="end">
                    {a.toolCalls}
                    {a.errors > 0 && <span className="text-error"> ({a.errors}✕)</span>}
                  </TableCell>
                  <TableCell align="end">{started ? span(end - started) : ""}</TableCell>
                  <TableCell align="end">{money(a.cost)}</TableCell>
                  <TableCell>
                    <span className="block max-w-320 truncate text-muted">
                      {act?.kind === "tool" && <code className="mr-4 text-base">{act.tool}</code>}
                      {act?.detail}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableRoot>
    </Panel>
  );
}
