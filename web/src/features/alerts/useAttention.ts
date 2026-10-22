import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentAlert, Overview, SessionSummary } from "../../api/types";
import { readStored, writeStored } from "../../lib/storage";

const NEEDS_KEY = "needsYou.v2";
const NOTIFY_KEY = "notify";
const NOTIFIED_ALERT_KINDS = new Set(["long-tool", "silent", "errors"]);

export type NotifyState = "off" | "on" | "blocked" | "ask";

export type NeedsYouEntry = {
  at: number;
  title: string;
  cwd: string | null;
  status: string;
  reason: string;
  lastMessage: string | null;
  pendingAction: string | null;
  lastPrompt: string | null;
  alerts: AgentAlert[];
};

type NeedsYou = Record<string, NeedsYouEntry>;

function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.16 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.32);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    return;
  }
}

const label = (s: SessionSummary) => s.title ?? s.name ?? s.sessionId.slice(0, 8);

function entryFor(s: SessionSummary, at: number): NeedsYouEntry {
  const activity = s.main?.activity ?? null;
  const pending = activity?.kind === "tool" && activity.status === "pending" ? activity : null;
  const reason = pending
    ? `Waiting for your permission to run ${pending.tool}`
    : s.status === "idle"
      ? "Finished its turn and is waiting for your reply"
      : s.status === "shell"
        ? "Stopped and dropped into shell mode"
        : `Stopped working (${s.status})`;
  return {
    at,
    title: label(s),
    cwd: s.cwd,
    status: s.status,
    reason,
    lastMessage: s.main?.lastMessage ?? (activity?.kind === "text" ? activity.detail : null),
    pendingAction: pending ? `${pending.tool}: ${pending.detail}` : null,
    lastPrompt: s.lastPrompt,
    alerts: s.alerts,
  };
}

function useTabVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, []);
  return visible;
}

export function useAttention(overview: Overview | null, selected: string | null, onOpen: (id: string) => void) {
  const [needsYou, setNeedsYouState] = useState<NeedsYou>(() => {
    const stored = readStored<NeedsYou>(NEEDS_KEY, {});
    return Object.fromEntries(Object.entries(stored).filter(([, v]) => v && typeof v === "object"));
  });
  const [unseen, setUnseen] = useState<string[]>([]);
  const [notify, setNotify] = useState<NotifyState>(() => {
    if (typeof Notification === "undefined") return "off";
    if (Notification.permission === "denied") return "blocked";
    const wanted = readStored<boolean>(NOTIFY_KEY, false);
    if (wanted && Notification.permission === "granted") return "on";
    return wanted ? "ask" : "off";
  });
  const visible = useTabVisible();
  const statuses = useRef(new Map<string, string>());
  const seenAlerts = useRef(new Set<string>());
  const primed = useRef(false);

  const setNeedsYou = useCallback((next: NeedsYou) => {
    setNeedsYouState(next);
    writeStored(NEEDS_KEY, next);
  }, []);

  const send = useCallback(
    (title: string, body: string, sessionId: string) => {
      if (notify !== "on") return;
      chime();
      const n = new Notification(title, { body, tag: `${sessionId}:${title}` });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    },
    [notify],
  );

  useEffect(() => {
    if (!overview) return;
    const watching = (id: string) => id === selected && document.visibilityState === "visible";
    const next = { ...needsYou };
    const added: string[] = [];
    let changed = false;
    const liveIds = new Set(overview.live.map(s => s.sessionId));

    for (const s of overview.live) {
      const before = statuses.current.get(s.sessionId);
      statuses.current.set(s.sessionId, s.status);
      if (s.status === "busy" && next[s.sessionId]) {
        delete next[s.sessionId];
        changed = true;
      }
      if (primed.current && before === "busy" && s.status !== "busy" && !watching(s.sessionId)) {
        const entry = entryFor(s, overview.now);
        next[s.sessionId] = entry;
        added.push(s.sessionId);
        changed = true;
        send(`Needs you: ${entry.title}`, entry.reason, s.sessionId);
      }
      for (const alert of s.alerts) {
        const key = `${s.sessionId}:${alert.agent ?? "main"}:${alert.kind}`;
        if (seenAlerts.current.has(key)) continue;
        seenAlerts.current.add(key);
        if (primed.current && NOTIFIED_ALERT_KINDS.has(alert.kind)) {
          send(`Check ${label(s)}`, `${alert.agentLabel ? `${alert.agentLabel}: ` : ""}${alert.message}`, s.sessionId);
        }
      }
    }
    for (const id of Object.keys(next)) {
      if (!liveIds.has(id)) {
        delete next[id];
        changed = true;
      }
    }
    for (const key of [...seenAlerts.current]) {
      const [id] = key.split(":");
      const s = overview.live.find(x => x.sessionId === id);
      if (!s || !s.alerts.some(a => key === `${id}:${a.agent ?? "main"}:${a.kind}`)) seenAlerts.current.delete(key);
    }
    primed.current = true;
    if (changed) setNeedsYou(next);
    if (added.length) setUnseen(prev => [...prev.filter(id => !added.includes(id)), ...added]);
  }, [overview]);

  useEffect(() => {
    if (!selected || !needsYou[selected]) return;
    const next = { ...needsYou };
    delete next[selected];
    setNeedsYou(next);
  }, [selected, needsYou, setNeedsYou]);

  const toggleNotify = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    if (notify === "on") {
      setNotify("off");
      writeStored(NOTIFY_KEY, false);
      return;
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission === "granted") {
      setNotify("on");
      writeStored(NOTIFY_KEY, true);
      chime();
    } else if (permission === "denied") {
      setNotify("blocked");
      writeStored(NOTIFY_KEY, false);
    } else {
      setNotify("ask");
      writeStored(NOTIFY_KEY, true);
    }
  }, [notify]);

  useEffect(() => {
    if (!navigator.permissions) return;
    let status: PermissionStatus | null = null;
    const sync = () => {
      const wanted = readStored<boolean>(NOTIFY_KEY, false);
      if (Notification.permission === "denied") setNotify("blocked");
      else if (Notification.permission === "granted") setNotify(wanted ? "on" : "off");
      else setNotify(wanted ? "ask" : "off");
    };
    void navigator.permissions.query({ name: "notifications" }).then(s => {
      status = s;
      s.addEventListener("change", sync);
    });
    window.addEventListener("focus", sync);
    return () => {
      status?.removeEventListener("change", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      const next = { ...needsYou };
      delete next[id];
      setNeedsYou(next);
      setUnseen(prev => prev.filter(x => x !== id));
    },
    [needsYou, setNeedsYou],
  );

  const open = useCallback(
    (id: string) => {
      setUnseen(prev => prev.filter(x => x !== id));
      onOpen(id);
    },
    [onOpen],
  );

  const later = useCallback(() => setUnseen([]), []);

  const dialog = visible ? unseen.filter(id => needsYou[id]).map(id => ({ id, entry: needsYou[id] })) : [];

  return { needsYou, notify, toggleNotify, dialog, open, dismiss, later };
}
