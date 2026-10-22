export type AgentEvent = {
  ts: string;
  kind: "tool" | "text" | "prompt";
  tool?: string;
  detail: string;
  status?: "pending" | "ok" | "error";
  result?: string;
  doneTs?: string;
  spawn?: string;
  images?: string[];
};

export type ToolCount = { name: string; count: number };

export type AlertKind = "long-tool" | "silent" | "errors" | "context";

export type AgentAlert = {
  kind: AlertKind;
  message: string;
  detail?: string;
  agent?: string;
  agentLabel?: string;
};

export type AgentSummary = {
  model: string | null;
  cost: number;
  tokens: number;
  requests: number;
  toolCalls: number;
  errors: number;
  contextTokens: number;
  contextWindow: number;
  compactions: number;
  alerts: AgentAlert[];
  activity: AgentEvent | null;
  lastMessage: string | null;
  firstTs: string | null;
  lastActiveMs: number;
  tools?: ToolCount[];
  events?: AgentEvent[];
};

export type Subagent = AgentSummary & {
  id: string;
  type: string;
  description: string | null;
  background: boolean;
  running: boolean;
  finished: boolean;
  task?: string | null;
};

export type Breakdown = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  other: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type GraphNode = {
  id: string;
  parent: string | null;
  type: string;
  name?: string | null;
  description: string | null;
  status: string;
  background?: boolean;
  teammate?: boolean;
  start: number | null;
  end: number | null;
  segments: [number, number][];
  cost: number;
};

export type GraphEdge = {
  kind: "spawn" | "return" | "message";
  from: string;
  to: string;
  ts: number | null;
  label?: string | null;
};

export type SessionSummary = {
  sessionId: string;
  pid: number | null;
  name: string | null;
  status: string;
  kind: string | null;
  entrypoint: string | null;
  version: string | null;
  cwd: string | null;
  gitBranch: string | null;
  title: string | null;
  lastPrompt: string | null;
  startedAt: number | null;
  lastActiveMs: number;
  cost: number;
  tokens: number;
  todayCost: number;
  main: AgentSummary | null;
  subagents: Subagent[];
  alerts: AgentAlert[];
};

export type CostReport = {
  now: number;
  days: number;
  warming: { done: number; total: number } | null;
  total: number;
  breakdown: Breakdown;
  daily: { day: string; cost: number }[];
  projects: { project: string; cost: number; sessions: number }[];
  models: { model: string; cost: number }[];
};

export type SessionDetail = SessionSummary & {
  now: number;
  breakdown: Breakdown;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
};

export type CompatIssue = { level: "error" | "warning" | "info"; key: string; message: string };

export type Overview = {
  now: number;
  hours: number;
  tz: string;
  todayCost: number;
  compat: CompatIssue[];
  live: SessionSummary[];
  recent: SessionSummary[];
};
