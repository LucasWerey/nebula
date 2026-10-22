import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 7878);
const PROJECTS_DIR = process.env.PROJECTS_DIR ?? "/data/projects";
const SESSIONS_DIR = process.env.SESSIONS_DIR ?? "/data/sessions";
const HOST_HOME = process.env.HOST_HOME ?? "";
const STATIC_DIR = process.env.STATIC_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "web", "dist");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
const SUBAGENT_ACTIVE_MS = 90_000;
const STALE_MS = 6 * 3600_000;
const INDEX_TTL_MS = 10_000;
const CHUNK = 16 * 1024 * 1024;
const MAX_EVENTS = 300;
const HANDBACK_TOOLS = new Set(["SubagentHandback"]);
const SPAWN_TOOLS = new Set(["Agent", "Task"]);
const SEGMENT_GAP_MS = 60_000;
const MAX_SEGMENTS = 3000;
const LEAD_NAMES = new Set(["team-lead", "main", "lead", "parent"]);
const STUCK_MS = 5 * 60_000;
const ERROR_WINDOW = 10;
const ERROR_STREAK = 3;
const CONTEXT_WARN = 0.8;
const COST_DAYS_MAX = 90;
const LAST_MESSAGE_MAX = 2000;
const TESTED_VERSIONS = new Set(["2.1"]);

// $ per million tokens: [model prefix, input, output, cache read]
const PRICING = [
  ["claude-fable-5-1", 10, 50, 0.25],
  ["claude-mythos-5-1", 10, 50, 0.25],
  ["claude-fable-5", 10, 50, 1],
  ["claude-mythos-5", 10, 50, 1],
  ["claude-opus-5-5", 4, 20, 0.2],
  ["claude-opus-5", 5, 25, 0.5],
  ["claude-opus-4-8", 5, 25, 0.5],
  ["claude-opus-4-7", 5, 25, 0.5],
  ["claude-opus-4-6", 5, 25, 0.5],
  ["claude-opus-4-5", 5, 25, 0.5],
  ["claude-opus-4", 15, 75, 1.5],
  ["claude-sonnet-5-5", 2, 10, 0.2],
  ["claude-sonnet-5", 2, 10, 0.2],
  ["claude-sonnet-4", 3, 15, 0.3],
  ["claude-haiku-5-5", 0.1, 0.5, 0.01],
  ["claude-haiku-4-5", 1, 5, 0.1],
  ["claude-3-5-haiku", 0.8, 4, 0.08],
].sort((a, b) => b[0].length - a[0].length);

function priceFor(model) {
  if (!model) return null;
  const id = model.replace(/\[.*\]$/, "");
  return PRICING.find(([p]) => id === p || id.startsWith(`${p}-`)) ?? null;
}

const emptyBreakdown = () => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, other: 0,
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
});

function breakdownOf(usage, model) {
  const b = emptyBreakdown();
  const cc = usage.cache_creation;
  const write5m = cc ? (cc.ephemeral_5m_input_tokens ?? 0) : (usage.cache_creation_input_tokens ?? 0);
  const write1h = cc ? (cc.ephemeral_1h_input_tokens ?? 0) : 0;
  b.inputTokens = usage.input_tokens ?? 0;
  b.outputTokens = usage.output_tokens ?? 0;
  b.cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  b.cacheWriteTokens = usage.cache_creation_input_tokens ?? write5m + write1h;
  const price = priceFor(model);
  if (price) {
    const [, input, output, read] = price;
    const speed = usage.speed === "fast" ? 2 : 1;
    b.input = (speed * b.inputTokens * input) / 1e6;
    b.output = (speed * b.outputTokens * output) / 1e6;
    b.cacheRead = (speed * b.cacheReadTokens * read) / 1e6;
    b.cacheWrite = (speed * (write5m * 1.25 + write1h * 2) * input) / 1e6;
  }
  b.other = (usage.server_tool_use?.web_search_requests ?? 0) * 0.01;
  return b;
}

const COST_KEYS = ["input", "output", "cacheRead", "cacheWrite", "other"];
const totalCost = b => COST_KEYS.reduce((n, k) => n + b[k], 0);
const totalTokens = b => b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens;

function addInto(target, b, sign = 1) {
  for (const k of Object.keys(target)) target[k] += sign * b[k];
}

const DEFAULT_TZ = process.env.TZ || "UTC";
const tzFormatters = new Map();

function tzFormatter(tz) {
  let fmt = tzFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    tzFormatters.set(tz, fmt);
  }
  return fmt;
}

function validTz(tz) {
  if (!tz) return DEFAULT_TZ;
  try {
    tzFormatter(tz);
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

function tzParts(ts, tz) {
  const parts = {};
  for (const { type, value } of tzFormatter(tz).formatToParts(ts)) parts[type] = value;
  return parts;
}

function tzOffset(ts, tz) {
  const p = tzParts(ts, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}

function dayKey(ts, tz) {
  const p = tzParts(ts, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

function dayStart(ts, tz) {
  const offset = tzOffset(ts, tz);
  const local = ts + offset;
  const midnight = local - (((local % 864e5) + 864e5) % 864e5);
  const start = midnight - offset;
  const startOffset = tzOffset(start, tz);
  return startOffset === offset ? start : midnight - startOffset;
}

function costSince(states, since) {
  let cost = 0;
  for (const st of states) for (const m of st.messages.values()) if (m.ts >= since) cost += totalCost(m.b);
  return cost;
}
const oneLine = (s, n = 240) => String(s).replace(/\s+/g, " ").trim().slice(0, n);

function summarize(input) {
  if (!input || typeof input !== "object") return "";
  const keys = ["description", "command", "file_path", "path", "pattern", "query", "url", "skill", "prompt", "message"];
  const key = keys.find(k => typeof input[k] === "string" && input[k].trim());
  return oneLine(key ? input[key] : JSON.stringify(input));
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(c => (c.type === "text" ? c.text : "")).join(" ");
}

const transcripts = new Map();

function newState() {
  return {
    offset: 0,
    partial: Buffer.alloc(0),
    messages: new Map(),
    breakdown: emptyBreakdown(),
    requests: 0,
    toolCounts: new Map(),
    errors: 0,
    events: [],
    pendingTools: new Map(),
    seenBlocks: new Set(),
    spawns: new Map(),
    notifications: new Map(),
    sent: [],
    segments: [],
    finishedTs: null,
    title: null,
    task: null,
    lastPrompt: null,
    activity: null,
    lastMessage: null,
    finished: false,
    contextTokens: 0,
    firstCwd: null,
    maxContext: 0,
    compactions: 0,
    lastCompactPre: 0,
    cwd: null,
    gitBranch: null,
    model: null,
    firstTs: null,
    lastTs: null,
    mtimeMs: 0,
  };
}

function pushEvent(s, ev) {
  s.events.push(ev);
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
}

function trackActivity(s, ms) {
  if (!Number.isFinite(ms)) return;
  const last = s.segments[s.segments.length - 1];
  if (last && ms - last[1] <= SEGMENT_GAP_MS && ms >= last[0]) {
    last[1] = Math.max(last[1], ms);
    return;
  }
  s.segments.push([ms, ms]);
  if (s.segments.length > MAX_SEGMENTS) s.segments.shift();
}

function recordAssistant(s, e) {
  const m = e.message;
  if (!m) return;
  if (m.model && m.model !== "<synthetic>") s.model = m.model;
  const content = Array.isArray(m.content) ? m.content : [];
  content.forEach((block, i) => {
    const key = block.id ?? `${e.uuid}:${i}`;
    if (s.seenBlocks.has(key)) return;
    if (block.type === "tool_use") {
      s.seenBlocks.add(key);
      const ev = { ts: e.timestamp, kind: "tool", tool: block.name, detail: summarize(block.input), status: "pending" };
      if (SPAWN_TOOLS.has(block.name)) {
        ev.spawn = block.input?.subagent_type ?? "agent";
        s.spawns.set(block.id, { ts: e.timestamp, background: Boolean(block.input?.run_in_background), doneTs: null });
      }
      if (block.name === "SendMessage" && block.input?.to) {
        s.sent.push({ ts: e.timestamp, to: String(block.input.to), summary: oneLine(block.input.summary ?? block.input.message ?? "", 160) });
        if (s.sent.length > MAX_EVENTS) s.sent.shift();
      }
      pushEvent(s, ev);
      s.pendingTools.set(block.id, ev);
      s.toolCounts.set(block.name, (s.toolCounts.get(block.name) ?? 0) + 1);
      s.activity = ev;
      s.finished = HANDBACK_TOOLS.has(block.name);
      if (s.finished) s.finishedTs = e.timestamp;
    } else if (block.type === "text" && block.text?.trim()) {
      s.seenBlocks.add(key);
      const ev = { ts: e.timestamp, kind: "text", detail: oneLine(block.text, 600) };
      pushEvent(s, ev);
      s.activity = ev;
      s.lastMessage = block.text.trim().slice(0, LAST_MESSAGE_MAX);
    }
  });
  if (m.stop_reason === "end_turn") {
    s.finished = true;
    s.finishedTs = e.timestamp;
  }
  if (!m.usage || m.model === "<synthetic>") return;
  const id = m.id ?? e.uuid;
  const prev = s.messages.get(id);
  if (prev) {
    addInto(s.breakdown, prev.b, -1);
  } else {
    s.requests += 1;
  }
  const b = breakdownOf(m.usage, m.model);
  s.messages.set(id, { b, ts: Date.parse(e.timestamp) || Date.now(), model: m.model });
  addInto(s.breakdown, b);
  s.contextTokens = b.inputTokens + b.cacheReadTokens + b.cacheWriteTokens;
  s.maxContext = Math.max(s.maxContext, s.contextTokens);
}

const LARGE_CONTEXT = /fable|mythos|opus-5|sonnet-5|haiku-5|opus-4-[6-9]|sonnet-4-[6-9]/;

function contextWindow(s) {
  if (s.maxContext > 210_000) return 1_000_000;
  if (s.compactions && s.lastCompactPre && s.lastCompactPre < 210_000) return 200_000;
  return s.model && LARGE_CONTEXT.test(s.model) ? 1_000_000 : 200_000;
}

const minutes = ms => Math.max(1, Math.round(ms / 60_000));

function alertsFor(s, now, active) {
  if (!active) return [];
  const alerts = [];
  const pending = [...s.pendingTools.values()].filter(ev => ev.ts && now - Date.parse(ev.ts) < 6 * 3600_000).at(-1);
  if (pending && now - Date.parse(pending.ts) > STUCK_MS) {
    alerts.push({ kind: "long-tool", message: `${pending.tool} running for ${minutes(now - Date.parse(pending.ts))}m`, detail: pending.detail });
  } else if (now - s.mtimeMs > STUCK_MS) {
    alerts.push({ kind: "silent", message: `no activity for ${minutes(now - s.mtimeMs)}m` });
  }
  const recent = s.events.filter(ev => ev.kind === "tool" && ev.status !== "pending").slice(-ERROR_WINDOW);
  const errors = recent.filter(ev => ev.status === "error").length;
  if (errors >= ERROR_STREAK) alerts.push({ kind: "errors", message: `${errors} errors in the last ${recent.length} tool calls` });
  const window = contextWindow(s);
  if (s.contextTokens / window >= CONTEXT_WARN) {
    alerts.push({ kind: "context", message: `context ${Math.round((s.contextTokens / window) * 100)}% full` });
  }
  return alerts;
}

const images = new Map();
let nextImageId = 1;

function registerImages(blocks, loc, prefix) {
  if (!Array.isArray(blocks) || !loc) return [];
  const ids = [];
  blocks.forEach((b, i) => {
    if (b?.type !== "image" || b.source?.type !== "base64") return;
    const id = String(nextImageId++);
    images.set(id, { file: loc.file, offset: loc.offset, length: loc.length, path: [...prefix, i] });
    ids.push(id);
  });
  return ids;
}

function recordUser(s, e, loc) {
  const content = e.message?.content;
  if (Array.isArray(content) && content.some(c => c.type === "tool_result")) {
    content.forEach((c, ci) => {
      if (c.type !== "tool_result") return;
      const spawn = s.spawns.get(c.tool_use_id);
      if (spawn && !spawn.doneTs) spawn.doneTs = e.timestamp;
      const ev = s.pendingTools.get(c.tool_use_id);
      if (!ev) return;
      s.pendingTools.delete(c.tool_use_id);
      ev.status = c.is_error ? "error" : "ok";
      ev.result = oneLine(textOf(c.content), 400);
      ev.doneTs = e.timestamp;
      const ids = registerImages(c.content, loc, [ci]);
      if (ids.length) ev.images = ids;
      if (c.is_error) s.errors += 1;
    });
    return;
  }
  if (e.isMeta) return;
  const text = textOf(content).trim();
  const ids = registerImages(content, loc, []);
  if ((!text && !ids.length) || text.startsWith("<")) return;
  const detail = text ? oneLine(text, 600) : `${ids.length} image${ids.length > 1 ? "s" : ""}`;
  if (!s.task) s.task = oneLine(text || detail, 1200);
  s.lastPrompt = detail;
  s.finished = false;
  pushEvent(s, { ts: e.timestamp, kind: "prompt", detail, ...(ids.length ? { images: ids } : {}) });
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function serveImage(id, res) {
  const ref = images.get(id);
  if (!ref) return sendJson(res, 404, { error: "image not found" });
  let block;
  try {
    const buf = Buffer.alloc(ref.length);
    const fd = fs.openSync(ref.file, "r");
    try {
      fs.readSync(fd, buf, 0, ref.length, ref.offset);
    } finally {
      fs.closeSync(fd);
    }
    let blocks = JSON.parse(buf.toString("utf8")).message?.content;
    for (const idx of ref.path.slice(0, -1)) blocks = blocks?.[idx]?.content;
    block = blocks?.[ref.path[ref.path.length - 1]];
  } catch {
    return sendJson(res, 404, { error: "image no longer available" });
  }
  const type = block?.source?.media_type;
  if (block?.type !== "image" || !IMAGE_TYPES.has(type) || typeof block.source.data !== "string") {
    return sendJson(res, 404, { error: "image not found" });
  }
  res.writeHead(200, { "content-type": type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" });
  res.end(Buffer.from(block.source.data, "base64"));
}

function ingest(s, line, loc) {
  if (!line) return;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (e.cwd) {
    s.cwd = e.cwd;
    s.firstCwd ??= e.cwd;
  }
  if (e.gitBranch) s.gitBranch = e.gitBranch;
  if (e.version) s.version = e.version;
  if (e.timestamp) {
    s.firstTs ??= e.timestamp;
    s.lastTs = e.timestamp;
    if (e.type === "user" || e.type === "assistant") trackActivity(s, Date.parse(e.timestamp));
  }
  switch (e.type) {
    case "queue-operation": {
      const id = line.match(/<tool-use-id>([^<]+)<\/tool-use-id>/)?.[1];
      if (id && line.includes("<task-notification>") && !s.notifications.has(id)) s.notifications.set(id, e.timestamp);
      break;
    }
    case "system":
      if (e.subtype === "compact_boundary") {
        s.compactions += 1;
        s.lastCompactPre = e.compactMetadata?.preTokens ?? 0;
      }
      break;
    case "ai-title":
      s.title = e.aiTitle;
      break;
    case "summary":
      s.title ??= e.summary;
      break;
    case "last-prompt":
      s.lastPrompt = e.lastPrompt;
      break;
    case "user":
      recordUser(s, e, loc);
      break;
    case "assistant":
      recordAssistant(s, e);
      break;
  }
}

function readTranscript(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  let s = transcripts.get(file);
  if (!s || stat.size < s.offset) {
    s = newState();
    transcripts.set(file, s);
  }
  s.mtimeMs = stat.mtimeMs;
  if (stat.size === s.offset) return s;
  const fd = fs.openSync(file, "r");
  try {
    while (s.offset < stat.size) {
      const len = Math.min(CHUNK, stat.size - s.offset);
      const buf = Buffer.alloc(len);
      const read = fs.readSync(fd, buf, 0, len, s.offset);
      if (read <= 0) break;
      const base = s.offset - s.partial.length;
      s.offset += read;
      const data = s.partial.length ? Buffer.concat([s.partial, buf.subarray(0, read)]) : buf.subarray(0, read);
      let pos = 0;
      let nl;
      while ((nl = data.indexOf(10, pos)) !== -1) {
        if (nl > pos) ingest(s, data.toString("utf8", pos, nl), { file, offset: base + pos, length: nl - pos });
        pos = nl + 1;
      }
      s.partial = Buffer.from(data.subarray(pos));
    }
  } finally {
    fs.closeSync(fd);
  }
  return s;
}

let indexCache = { at: 0, map: new Map() };

function transcriptIndex() {
  if (Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.map;
  const map = new Map();
  for (const dir of safeReaddir(PROJECTS_DIR)) {
    const full = path.join(PROJECTS_DIR, dir);
    for (const f of safeReaddir(full)) {
      if (f.endsWith(".jsonl")) map.set(f.slice(0, -6), path.join(full, f));
    }
  }
  indexCache = { at: Date.now(), map };
  return map;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readLiveSessions() {
  return safeReaddir(SESSIONS_DIR)
    .filter(f => /^\d+\.json$/.test(f))
    .map(f => readJson(path.join(SESSIONS_DIR, f)))
    .filter(s => s?.sessionId);
}

const metaCache = new Map();

function subagentsOf(file, now) {
  const dir = path.join(file.slice(0, -6), "subagents");
  return safeReaddir(dir)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => {
      const full = path.join(dir, f);
      const s = readTranscript(full);
      if (!s) return null;
      const metaFile = full.replace(/\.jsonl$/, ".meta.json");
      if (!metaCache.has(metaFile)) metaCache.set(metaFile, readJson(metaFile) ?? {});
      return { id: f.slice(0, -6), meta: metaCache.get(metaFile), state: s, running: !s.finished && now - s.mtimeMs < SUBAGENT_ACTIVE_MS };
    })
    .filter(Boolean)
    .sort((a, b) => b.running - a.running || b.state.mtimeMs - a.state.mtimeMs);
}

const tilde = p => (p && HOST_HOME && p.startsWith(HOST_HOME) ? `~${p.slice(HOST_HOME.length)}` : p);
const topTools = s => [...s.toolCounts].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));

function agentSummary(s, now, active) {
  return {
    model: s.model,
    cost: totalCost(s.breakdown),
    tokens: totalTokens(s.breakdown),
    requests: s.requests,
    toolCalls: [...s.toolCounts.values()].reduce((n, c) => n + c, 0),
    errors: s.errors,
    contextTokens: s.contextTokens,
    contextWindow: contextWindow(s),
    compactions: s.compactions,
    alerts: alertsFor(s, now, active),
    activity: s.activity,
    lastMessage: s.lastMessage,
    firstTs: s.firstTs,
    lastActiveMs: s.mtimeMs,
  };
}

function subagentSummary(a, withEvents, now) {
  return {
    id: a.id,
    type: a.meta.agentType ?? "agent",
    description: a.meta.description ?? null,
    background: a.meta.requestShape === "background",
    running: a.running,
    finished: a.state.finished,
    task: withEvents ? a.state.task : undefined,
    ...agentSummary(a.state, now, a.running),
    tools: withEvents ? topTools(a.state) : undefined,
    events: withEvents ? a.state.events : undefined,
  };
}

const msOf = ts => (ts ? Date.parse(ts) : null);

function buildGraph(s, subs, live, now) {
  const owners = [["main", s], ...subs.map(a => [a.id, a.state])].filter(([, st]) => st);
  const nodes = [];
  const edges = [];
  if (s) {
    nodes.push({
      id: "main",
      parent: null,
      type: "main",
      description: s.title ?? "Main session",
      status: live?.status ?? "ended",
      start: msOf(s.firstTs),
      end: live ? now : s.mtimeMs,
      segments: s.segments,
      cost: totalCost(s.breakdown),
    });
  }
  const resolve = to => {
    if (LEAD_NAMES.has(to)) return "main";
    const hit = subs.find(a => a.id === `agent-${to}` || a.id === to || a.meta.name === to);
    return hit?.id ?? null;
  };
  for (const a of subs) {
    let parent = s ? "main" : null;
    let spawn = null;
    if (a.meta.toolUseId) {
      const owner = owners.find(([, st]) => st.spawns.has(a.meta.toolUseId));
      if (owner) {
        parent = owner[0];
        spawn = owner[1].spawns.get(a.meta.toolUseId);
      }
    }
    const ownerState = owners.find(([id]) => id === parent)?.[1];
    const start = msOf(spawn?.ts) ?? msOf(a.state.firstTs);
    const returnTs =
      msOf(ownerState?.notifications.get(a.meta.toolUseId)) ??
      (spawn && !spawn.background ? msOf(spawn.doneTs) : null) ??
      (a.state.finished ? msOf(a.state.finishedTs) : null);
    nodes.push({
      id: a.id,
      parent,
      type: a.meta.agentType ?? "agent",
      name: a.meta.name ?? null,
      description: a.meta.description ?? null,
      background: spawn?.background ?? a.meta.requestShape === "background",
      teammate: Boolean(a.meta.teamName),
      status: a.running ? "running" : a.state.finished ? "done" : "idle",
      start,
      end: a.running ? now : (returnTs ?? a.state.mtimeMs),
      segments: a.state.segments,
      cost: totalCost(a.state.breakdown),
    });
    if (parent) {
      edges.push({ kind: "spawn", from: parent, to: a.id, ts: start, label: a.meta.description ?? a.meta.agentType });
      if (returnTs) edges.push({ kind: "return", from: a.id, to: parent, ts: returnTs, label: "result handed back" });
    }
  }
  for (const [from, st] of owners) {
    for (const m of st.sent) {
      const to = resolve(m.to);
      if (to && to !== from) edges.push({ kind: "message", from, to, ts: msOf(m.ts), label: m.summary });
    }
  }
  return { nodes, edges };
}

function sessionView(sessionId, file, live, now, withEvents = false, tz = DEFAULT_TZ) {
  const s = file ? readTranscript(file) : null;
  const subs = file ? subagentsOf(file, now) : [];
  const breakdown = emptyBreakdown();
  if (s) addInto(breakdown, s.breakdown);
  for (const a of subs) addInto(breakdown, a.state.breakdown);
  const lastActiveMs = Math.max(s?.mtimeMs ?? 0, live?.updatedAt ?? 0, ...subs.map(a => a.state.mtimeMs));
  const states = [s, ...subs.map(a => a.state)].filter(Boolean);
  const main = s ? agentSummary(s, now, live?.status === "busy") : null;
  const subSummaries = subs.map(a => subagentSummary(a, withEvents, now));
  const alerts = [
    ...(main?.alerts ?? []).map(a => ({ ...a, agent: "main" })),
    ...subSummaries.flatMap(a => a.alerts.map(al => ({ ...al, agent: a.id, agentLabel: a.description ?? a.type }))),
  ];
  return {
    sessionId,
    pid: live?.pid ?? null,
    name: live?.name ?? null,
    status: live ? (now - lastActiveMs > STALE_MS ? "stale" : live.status ?? "unknown") : "ended",
    kind: live?.kind ?? null,
    entrypoint: live?.entrypoint ?? null,
    version: live?.version ?? null,
    cwd: tilde(live?.cwd ?? s?.cwd),
    gitBranch: s?.gitBranch ?? null,
    title: s?.title ?? null,
    lastPrompt: s?.lastPrompt ?? null,
    startedAt: live?.startedAt ?? (s?.firstTs ? Date.parse(s.firstTs) : null),
    lastActiveMs,
    cost: totalCost(breakdown),
    tokens: totalTokens(breakdown),
    todayCost: costSince(states, dayStart(now, tz)),
    breakdown: withEvents ? breakdown : undefined,
    main: main ? { ...main, tools: withEvents ? topTools(s) : undefined, events: withEvents ? s.events : undefined } : null,
    subagents: subSummaries,
    alerts,
    graph: withEvents ? buildGraph(s, subs, live, now) : undefined,
    states,
  };
}

const strip = ({ states, ...rest }) => rest;

function dirProblem(dir) {
  try {
    fs.readdirSync(dir);
    return null;
  } catch (err) {
    return err.code ?? "ERROR";
  }
}

const minor = version => version?.match(/^(\d+\.\d+)\./)?.[1] ?? null;

function compatibility(live, index, states) {
  const issues = [];
  const projects = dirProblem(PROJECTS_DIR);
  if (projects === "ENOENT") {
    issues.push({ level: "error", key: "no-projects", message: "No Claude folder is mounted. Set CLAUDE_DIR in .env to your Claude Code folder (usually ~/.claude), then restart." });
  } else if (projects === "EACCES" || projects === "EPERM") {
    issues.push({ level: "error", key: "projects-permission", message: "Nebula can't read your Claude transcripts (permission denied). On Linux, set UID and GID in .env to your user (run scripts/setup.sh), then restart." });
  } else if (!index.size) {
    issues.push({ level: "warning", key: "no-transcripts", message: "No Claude Code transcripts found yet. Check that CLAUDE_DIR points to the folder Claude Code writes to." });
  }
  const sessions = dirProblem(SESSIONS_DIR);
  if (sessions === "EACCES" || sessions === "EPERM") {
    issues.push({ level: "error", key: "sessions-permission", message: "Nebula can't read the running-sessions folder (permission denied). On Linux, set UID and GID in .env (run scripts/setup.sh)." });
  } else if (sessions === "ENOENT" && index.size) {
    issues.push({ level: "warning", key: "no-sessions-dir", message: "This Claude Code version doesn't write a sessions folder, so running sessions and \"needs you\" alerts can't be detected. Recent sessions still show." });
  } else if (live.length && live.some(l => !("status" in l))) {
    issues.push({ level: "warning", key: "no-status", message: "Running-session files have no status field in this Claude Code version, so busy/idle and \"needs you\" alerts won't work." });
  }
  const versions = new Set([...live.map(l => l.version), ...[...states].map(st => st.version)].filter(Boolean));
  const untested = [...versions].filter(v => !TESTED_VERSIONS.has(minor(v))).sort();
  if (untested.length) {
    const tested = [...TESTED_VERSIONS].map(v => `${v}.x`).join(", ");
    issues.push({
      level: "info",
      key: `version:${untested.join(",")}`,
      message: `Nebula was tested with Claude Code ${tested}; this machine runs ${untested.join(", ")}. Most views should work, but running status, subagent returns or compaction counts may be incomplete.`,
    });
  }
  return issues;
}

function buildState(hours, tz) {
  const now = Date.now();
  const index = transcriptIndex();
  const live = readLiveSessions();
  const liveIds = new Set(live.map(l => l.sessionId));
  const liveViews = live.map(l => sessionView(l.sessionId, index.get(l.sessionId), l, now, false, tz));

  const since = now - hours * 3600_000;
  const recentViews = [];
  for (const [id, file] of index) {
    if (liveIds.has(id)) continue;
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    try {
      mtime = Math.max(mtime, fs.statSync(path.join(file.slice(0, -6), "subagents")).mtimeMs);
    } catch {}
    if (mtime < since) continue;
    recentViews.push(sessionView(id, file, null, now, false, tz));
  }

  const states = new Set([...liveViews, ...recentViews].flatMap(v => v.states));
  const todayCost = costSince(states, dayStart(now, tz));

  const statusRank = { busy: 0, shell: 1, waiting: 1, idle: 2, unknown: 3, stale: 4 };
  return {
    now,
    hours,
    tz,
    todayCost,
    compat: compatibility(live, index, states),
    live: liveViews
      .sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || b.lastActiveMs - a.lastActiveMs)
      .map(strip),
    recent: recentViews
      .filter(v => (v.main?.requests ?? 0) > 0 || v.subagents.length)
      .sort((a, b) => b.lastActiveMs - a.lastActiveMs)
      .map(strip),
  };
}

function buildSession(id, tz) {
  const now = Date.now();
  const file = transcriptIndex().get(id);
  const live = readLiveSessions().find(l => l.sessionId === id) ?? null;
  if (!file && !live) return null;
  return { now, ...strip(sessionView(id, file, live, now, true, tz)) };
}

const warm = { queue: [], queued: new Set(), done: 0, total: 0, running: false };

function startWarm(files) {
  for (const f of files) {
    if (warm.queued.has(f)) continue;
    warm.queued.add(f);
    warm.queue.push(f);
    warm.total += 1;
  }
  if (!warm.running && warm.queue.length) {
    warm.running = true;
    setImmediate(warmStep);
  }
}

function warmStep() {
  const next = warm.queue.shift();
  if (!next) {
    warm.running = false;
    warm.done = 0;
    warm.total = 0;
    return;
  }
  try {
    readTranscript(next);
  } catch (err) {
    console.error(`could not read ${next}: ${err}`);
  }
  warm.done += 1;
  setImmediate(warmStep);
}

const statMs = file => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

function costFiles(since) {
  const files = [];
  for (const file of transcriptIndex().values()) {
    if (statMs(file) >= since) files.push({ file, parent: null });
    const dir = path.join(file.slice(0, -6), "subagents");
    for (const f of safeReaddir(dir)) {
      const full = path.join(dir, f);
      if (f.endsWith(".jsonl") && statMs(full) >= since) files.push({ file: full, parent: file });
    }
  }
  return files;
}

const modelLabel = m => (m ? m.replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/\[.*\]$/, "") : "unknown");

function buildCosts(days, tz) {
  const now = Date.now();
  const starts = [dayStart(now, tz)];
  while (starts.length < days) starts.unshift(dayStart(starts[0] - 1, tz));
  const dayKeys = starts.map(start => dayKey(start + 12 * 3600_000, tz));
  const bucketOf = ts => {
    if (ts < starts[0] || ts > now + 60_000) return -1;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= ts) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const files = costFiles(starts[0] - 864e5);
  startWarm(files.filter(f => !transcripts.has(f.file)).map(f => f.file));

  const daily = dayKeys.map(() => 0);
  const projects = new Map();
  const models = new Map();
  const breakdown = emptyBreakdown();
  for (const f of files) {
    if (!transcripts.has(f.file)) continue;
    const s = readTranscript(f.file);
    if (!s) continue;
    const owner = f.parent ? transcripts.get(f.parent) : s;
    const project = tilde(owner?.firstCwd ?? s.firstCwd ?? s.cwd) ?? "unknown";
    let fileCost = 0;
    for (const m of s.messages.values()) {
      const bucket = bucketOf(m.ts);
      if (bucket < 0) continue;
      const cost = totalCost(m.b);
      daily[bucket] += cost;
      fileCost += cost;
      const model = modelLabel(m.model);
      models.set(model, (models.get(model) ?? 0) + cost);
      addInto(breakdown, m.b);
    }
    if (fileCost > 0) {
      const p = projects.get(project) ?? { project, cost: 0, sessions: 0 };
      p.cost += fileCost;
      if (!f.parent) p.sessions += 1;
      projects.set(project, p);
    }
  }
  return {
    now,
    days,
    warming: warm.running ? { done: warm.done, total: warm.total } : null,
    total: totalCost(breakdown),
    breakdown,
    daily: dayKeys.map((day, i) => ({ day, cost: daily[i] })),
    projects: [...projects.values()].sort((a, b) => b.cost - a.cost),
    models: [...models].map(([model, cost]) => ({ model, cost })).sort((a, b) => b.cost - a.cost),
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/state") {
      const hours = Math.min(Math.max(Number(url.searchParams.get("hours")) || 24, 1), 24 * 30);
      return sendJson(res, 200, buildState(hours, validTz(url.searchParams.get("tz"))));
    }
    if (url.pathname === "/api/costs") {
      const days = Math.min(Math.max(Math.round(Number(url.searchParams.get("days")) || 30), 1), COST_DAYS_MAX);
      return sendJson(res, 200, buildCosts(days, validTz(url.searchParams.get("tz"))));
    }
    const image = url.pathname.match(/^\/api\/image\/(\d+)$/);
    if (image) return serveImage(image[1], res);
    const match = url.pathname.match(/^\/api\/session\/([\w-]+)$/);
    if (match) {
      const data = buildSession(match[1], validTz(url.searchParams.get("tz")));
      return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "session not found" });
    }
  } catch (err) {
    return sendJson(res, 500, { error: String(err) });
  }
  serveStatic(url.pathname, res);
});

function serveStatic(pathname, res) {
  let decoded = "/";
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = "/";
  }
  const requested = path.normalize(path.join(STATIC_DIR, decoded));
  const inside = requested.startsWith(STATIC_DIR + path.sep);
  const file = inside && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(STATIC_DIR, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("Front end not built. Run `npm run build` in web/.");
    return;
  }
  const hashed = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  fs.createReadStream(file).pipe(res);
}

server.listen(PORT, () => console.log(`nebula listening on :${PORT}`));
