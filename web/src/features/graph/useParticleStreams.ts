import { useEffect, type RefObject } from "react";
import { laneControl, type StreamMode, type View } from "./orbit";

export type LaneStatus = "running" | "idle" | "done";

export type StreamLane = {
  id: string;
  kind: "trunk" | "branch" | "message";
  status: LaneStatus;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r1: number;
  r2: number;
  spawnTs: number | null;
  returnTs: number | null;
  messageTs: number | null;
};

export type StreamScene = {
  lanes: StreamLane[];
  nodes: { x: number; y: number; r: number }[];
  boxes: { x0: number; y0: number; x1: number; y1: number }[];
  view: View;
  width: number;
  height: number;
  mode: StreamMode;
  heartbeat: boolean;
};

type RGB = [number, number, number];
type Sprite = { disc: { c: HTMLCanvasElement; o: number }[]; glow: { c: HTMLCanvasElement; o: number } };
type Look = "run" | "idle" | "done";

type LaneRec = {
  id: string;
  idx: number;
  kind: StreamLane["kind"];
  status: LaneStatus;
  look: Look;
  pts: Float32Array;
  nrm: Float32Array;
  len: number;
  s0: number;
  s1: number;
  W: number;
  ph: number;
  ph2: number;
  ph3: number;
  acc: [number, number, number];
  thr: [number, number, number];
  rv: [number, number, number];
  filled: boolean;
  dead: boolean;
  deadAt: number;
  sig: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  rs: number;
  rt: number;
};

const POOL = 13000;
const NSEG = 36;
const DISC_CSS = [1.1, 1.6, 2.2];
const GLOW_CSS = 7;
const IDLE_MINLEN = 90;
const EVENT_WINDOW_MS = 12_000;
const HEARTBEAT_S = 4;

const KD = 0;
const KA = 1;
const KR = 2;

const S_DISP = 0;
const S_BACK = 1;
const S_IDLE = 2;
const S_DONE = 3;
const S_MSG_RUN = 4;
const S_MSG = 5;
const S_ACC = 6;
const S_RUN = 7;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] * (1 - t) + b[0] * t),
  Math.round(a[1] * (1 - t) + b[1] * t),
  Math.round(a[2] * (1 - t) + b[2] * t),
];
const soft = (c: RGB): RGB => c.map(n => Math.round(n * 0.86 + 128 * 0.14)) as RGB;

function parseTriple(value: string, fallback: RGB): RGB {
  const parts = value.trim().split(/[\s,/]+/).map(Number);
  return parts.length >= 3 && parts.slice(0, 3).every(n => Number.isFinite(n)) ? [parts[0], parts[1], parts[2]] : fallback;
}

function createStreams(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, getScene: () => StreamScene) {
  const P_on = new Uint8Array(POOL);
  const P_free = new Uint8Array(POOL);
  const P_kind = new Uint8Array(POOL);
  const P_dir = new Int8Array(POOL);
  const P_slot = new Uint8Array(POOL);
  const P_arr = new Uint8Array(POOL);
  const P_e = new Int32Array(POOL);
  const P_u = new Float32Array(POOL);
  const P_speed = new Float32Array(POOL);
  const P_v = new Float32Array(POOL);
  const P_swf = new Float32Array(POOL);
  const P_sph = new Float32Array(POOL);
  const P_swa = new Float32Array(POOL);
  const P_size = new Float32Array(POOL);
  const P_alpha = new Float32Array(POOL);
  const P_delay = new Float32Array(POOL);
  const P_age = new Float32Array(POOL);
  const P_life = new Float32Array(POOL);
  const P_x = new Float32Array(POOL);
  const P_y = new Float32Array(POOL);
  const P_vx = new Float32Array(POOL);
  const P_vy = new Float32Array(POOL);
  const freeStack = new Int32Array(POOL);
  let freeTop = 0;
  for (let i = POOL - 1; i >= 0; i--) freeStack[freeTop++] = i;
  let hi = 0;
  let liveN = 0;
  let liveCap = POOL;

  const lanes = new Map<string, LaneRec>();
  const etab: (LaneRec | null)[] = [];
  const seenEvents = new Set<string>();
  const tmp = { x: 0, y: 0 };
  const T = { t: 0, sm: 1 };
  let nodes: StreamScene["nodes"] = [];
  let boxes: StreamScene["boxes"] = [];
  let slots: Sprite[] = [];
  let colorKey = "";
  let colorsAt = -1e9;
  let light = false;
  let dpr = Math.min(4, window.devicePixelRatio || 1);
  let spriteDpr = 0;
  let quality = 1;
  let throttled = false;
  let warm = 0;
  let gTick = 0;
  const cbuf = new Float32Array(90);
  let cpos = 0;
  let cfill = 0;
  let lastBeat = 0;
  let raf = 0;
  let last = 0;
  let M = [1, 0, 0, 1, 0, 0];

  function mkSprite(glow: RGB, core: RGB): Sprite {
    const fill = mix(core, glow, 0.3);
    const disc = DISC_CSS.map(css => {
      const D = Math.max(1, Math.round(css * dpr));
      const W = D + 2;
      const c = document.createElement("canvas");
      c.width = c.height = W;
      const g = c.getContext("2d");
      if (g) {
        g.fillStyle = `rgb(${fill.join(",")})`;
        g.beginPath();
        g.arc(W / 2, W / 2, D / 2, 0, Math.PI * 2);
        g.fill();
      }
      return { c, o: Math.round(W / 2) };
    });
    const G = Math.round(GLOW_CSS * dpr);
    const gc = document.createElement("canvas");
    gc.width = gc.height = G;
    const gg = gc.getContext("2d");
    if (gg) {
      const gr = gg.createRadialGradient(G / 2, G / 2, 0, G / 2, G / 2, G / 2);
      gr.addColorStop(0, `rgba(${glow.join(",")},0.5)`);
      gr.addColorStop(0.45, `rgba(${glow.join(",")},0.12)`);
      gr.addColorStop(1, `rgba(${glow.join(",")},0)`);
      gg.fillStyle = gr;
      gg.fillRect(0, 0, G, G);
    }
    return { disc, glow: { c: gc, o: Math.round(G / 2) } };
  }

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const get = (name: string, fallback: RGB) => parseTriple(cs.getPropertyValue(name), fallback);
    light = !document.documentElement.classList.contains("dark");
    const bone = get("--aos-bone", light ? [20, 24, 31] : [232, 225, 210]);
    const run = soft(get("--aos-run", [196, 163, 90]));
    const idle = soft(get("--aos-idle", [118, 128, 150]));
    const msg = soft(get("--aos-msg", [170, 140, 230]));
    const key = JSON.stringify([bone, run, idle, msg, light, dpr]);
    if (key === colorKey && spriteDpr === dpr) return;
    colorKey = key;
    spriteDpr = dpr;
    const idleC = light ? mix(idle, bone, 0.6) : mix(idle, bone, 0.15);
    const doneC = light ? mix(idle, bone, 0.35) : mix(idle, [40, 46, 60], 0.35);
    slots = [
      mkSprite(run, bone),
      mkSprite(run, bone),
      mkSprite(idleC, idleC),
      mkSprite(doneC, doneC),
      mkSprite(msg, bone),
      mkSprite(msg, msg),
      mkSprite(run, run),
      mkSprite(run, bone),
    ];
  }

  function reshape(r: LaneRec, l: StreamLane) {
    const sig = `${l.x1},${l.y1},${l.x2},${l.y2},${l.r1},${l.r2}`;
    if (sig === r.sig) return;
    const dx = l.x2 - l.x1;
    const dy = l.y2 - l.y1;
    const L0 = Math.hypot(dx, dy);
    if (L0 < 2) return;
    const oldR = r.s1 - r.s0;
    const { x: qx, y: qy } = laneControl(l);
    let len = 0;
    for (let i = 0; i <= NSEG; i++) {
      const t = i / NSEG;
      const m = 1 - t;
      r.pts[i * 2] = m * m * l.x1 + 2 * m * t * qx + t * t * l.x2;
      r.pts[i * 2 + 1] = m * m * l.y1 + 2 * m * t * qy + t * t * l.y2;
      if (i) len += Math.hypot(r.pts[i * 2] - r.pts[i * 2 - 2], r.pts[i * 2 + 1] - r.pts[i * 2 - 1]);
    }
    for (let i = 0; i <= NSEG; i++) {
      const a = i > 0 ? i - 1 : 0;
      const c = i < NSEG ? i + 1 : NSEG;
      const tx = r.pts[c * 2] - r.pts[a * 2];
      const ty = r.pts[c * 2 + 1] - r.pts[a * 2 + 1];
      const tl = Math.hypot(tx, ty) || 1;
      r.nrm[i * 2] = -ty / tl;
      r.nrm[i * 2 + 1] = tx / tl;
    }
    r.len = len;
    r.s0 = Math.min(l.r1 + 3, len * 0.35);
    r.s1 = Math.max(r.s0 + 12, len - l.r2 - 3);
    r.W = l.kind === "message" ? 9 : Math.min(30, len * 0.1);
    r.sx = l.x1;
    r.sy = l.y1;
    r.tx = l.x2;
    r.ty = l.y2;
    r.rs = l.r1;
    r.rt = l.r2;
    r.sig = sig;
    const newR = r.s1 - r.s0;
    if (oldR > 8 && newR > 8 && Math.abs(newR - oldR) > 0.01) {
      const sc = newR / oldR;
      for (let i = 0; i < hi; i++) if (P_on[i] && !P_free[i] && P_e[i] === r.idx) P_u[i] *= sc;
    }
  }

  function syncLanes(scene: StreamScene) {
    const ids = new Set<string>();
    for (const l of scene.lanes) {
      ids.add(l.id);
      let r = lanes.get(l.id);
      if (!r || r.dead) {
        r = {
          id: l.id,
          idx: etab.length,
          kind: l.kind,
          status: l.status,
          look: "idle",
          pts: new Float32Array((NSEG + 1) * 2),
          nrm: new Float32Array((NSEG + 1) * 2),
          len: 1,
          s0: 0,
          s1: 0,
          W: 10,
          ph: Math.random() * 6.28,
          ph2: Math.random() * 6.28,
          ph3: Math.random() * 6.28,
          acc: [0, 0, 0],
          thr: [1, 1, 1],
          rv: [0, 0, 26],
          filled: false,
          dead: false,
          deadAt: 0,
          sig: "",
          sx: 0,
          sy: 0,
          tx: 0,
          ty: 0,
          rs: 0,
          rt: 0,
        };
        etab.push(r);
        lanes.set(l.id, r);
      }
      if (r.status !== l.status) {
        r.status = l.status;
        r.filled = r.filled && l.status !== "running";
      }
      r.kind = l.kind;
      reshape(r, l);
      triggerEvents(r, l);
    }
    for (const [id, r] of lanes) {
      if (!ids.has(id) && !r.dead) {
        r.dead = true;
        r.deadAt = T.t;
        lanes.delete(id);
      }
    }
  }

  function alloc() {
    if (!freeTop || liveN >= liveCap) return -1;
    const i = freeStack[--freeTop];
    P_on[i] = 1;
    liveN++;
    if (i >= hi) hi = i + 1;
    P_free[i] = 0;
    P_delay[i] = 0;
    P_age[i] = 0;
    P_u[i] = 0;
    P_arr[i] = 0;
    P_kind[i] = KD;
    return i;
  }

  function kill(i: number) {
    P_on[i] = 0;
    liveN--;
    freeStack[freeTop++] = i;
  }

  function spawn(r: LaneRec, dir: 1 | -1, kind: number, slot: number, size: number, speed: number, alpha: number, delay = 0, narrow = false, arrive = 0) {
    if (r.dead || r.s1 - r.s0 < 8) return -1;
    const i = alloc();
    if (i < 0) return -1;
    P_e[i] = r.idx;
    P_dir[i] = dir;
    P_kind[i] = kind;
    P_slot[i] = slot;
    P_size[i] = size;
    P_speed[i] = speed;
    P_alpha[i] = alpha;
    P_delay[i] = delay;
    P_life[i] = 99;
    P_arr[i] = arrive;
    P_v[i] = narrow ? (dir > 0 ? rnd(0.55, 0.8) : rnd(0.2, 0.45)) : dir > 0 ? rnd(0.54, 1) : rnd(0, 0.46);
    P_swf[i] = rnd(0.8, 2.4);
    P_sph[i] = Math.random() * 6.28;
    P_swa[i] = rnd(0.04, 0.14);
    return i;
  }

  function free(x: number, y: number, a: number, v: number, life: number, slot: number, size: number, alpha: number) {
    const i = alloc();
    if (i < 0) return;
    P_free[i] = 1;
    P_x[i] = x;
    P_y[i] = y;
    P_vx[i] = Math.cos(a) * v;
    P_vy[i] = Math.sin(a) * v;
    P_life[i] = life;
    P_size[i] = size;
    P_alpha[i] = alpha;
    P_slot[i] = slot;
    P_sph[i] = Math.random() * 6.28;
  }

  function puff(x: number, y: number, n: number, slot: number, v0: number, v1: number, life: number, alpha: number, rad: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      free(x + Math.cos(a) * rad, y + Math.sin(a) * rad, a, rnd(v0, v1), rnd(life * 0.6, life), slot, rnd(0.6, 1.1), alpha);
    }
  }

  function startBurst(r: LaneRec, slot = S_DISP) {
    puff(r.sx, r.sy, 40, S_ACC, 25, 70, 0.8, 0.6, r.rs + 4);
    for (let i = 0; i < 120; i++) spawn(r, 1, KD, slot, rnd(0.7, 1.3), rnd(170, 240), 1, i * 0.005, true, i === 119 ? 2 : 0);
  }

  function doneBurst(r: LaneRec) {
    puff(r.tx, r.ty, 40, S_RUN, 25, 70, 0.8, 0.7, r.rt + 4);
    for (let i = 0; i < 120; i++) spawn(r, -1, KR, S_BACK, rnd(0.7, 1.3), rnd(190, 250), 1, i * 0.005, true, i === 119 ? 1 : 0);
  }

  function heartbeatWave() {
    const many = lanes.size > 20 ? 0.6 : 1;
    for (const r of lanes.values()) {
      if (r.kind === "message" || r.status === "done") continue;
      const base = r.kind === "branch" ? 0.45 : 0.04;
      const n = Math.round((r.kind === "trunk" ? 150 : 110) * many * Math.max(0.35, quality));
      for (let i = 0; i < n; i++) spawn(r, 1, KD, S_DISP, rnd(0.6, 1.1), rnd(150, 210), 0.95, base + i * 0.0035, true);
    }
  }

  function triggerEvents(r: LaneRec, l: StreamLane) {
    const now = Date.now();
    const fire = (kind: string, ts: number | null, run: () => void) => {
      if (ts == null) return;
      const key = `${l.id}:${kind}:${ts}`;
      if (seenEvents.has(key)) return;
      seenEvents.add(key);
      if (now - ts >= 0 && now - ts < EVENT_WINDOW_MS && r.s1 - r.s0 >= 8) run();
    };
    fire("spawn", l.spawnTs, () => startBurst(r));
    fire("return", l.returnTs, () => doneBurst(r));
    fire("message", l.messageTs, () => startBurst(r, S_MSG_RUN));
  }

  function setRates(r: LaneRec, quiet: boolean) {
    const o = r.rv;
    if (r.kind === "message") {
      o[0] = r.status === "running" ? 60 : quiet ? 0 : 14;
      o[1] = 0;
      o[2] = r.status === "running" ? 72 : 40;
      r.look = r.status === "running" ? "run" : "idle";
      return;
    }
    if (r.status === "running") {
      o[0] = 420;
      o[1] = 230;
      o[2] = 130;
      r.look = "run";
      return;
    }
    const thin = r.status === "done" ? 0.7 : 1;
    o[0] = quiet ? 0 : 29 * thin;
    o[1] = quiet ? 0 : 20 * thin;
    o[2] = 26;
    r.look = r.status === "done" ? "done" : "idle";
  }

  const QI = (q: number) => (q > 0.55 ? q : 0.55 + (q - 0.12) * 0.1);

  function outSlot(r: LaneRec) {
    if (r.kind === "message") return r.look === "run" ? S_MSG_RUN : S_MSG;
    return r.look === "run" ? S_DISP : r.look === "done" ? S_DONE : S_IDLE;
  }

  function mkOut(r: LaneRec, sp: number) {
    if (r.look === "run" && r.kind !== "message") return spawn(r, 1, KD, S_DISP, rnd(0.55, 1.15), sp * rnd(0.6, 1.4), rnd(0.6, 1));
    return spawn(r, 1, KA, outSlot(r), rnd(0.55, 0.95), sp * rnd(0.7, 1.3), r.kind === "message" ? 0.75 : rnd(0.7, 1));
  }

  function mkBack(r: LaneRec, sp: number) {
    if (r.look === "run") return spawn(r, -1, KR, S_BACK, rnd(0.5, 0.95), 105 * rnd(0.7, 1.3), rnd(0.5, 0.8));
    return spawn(r, -1, KA, outSlot(r), rnd(0.5, 0.85), sp * rnd(0.8, 1.2), rnd(0.58, 0.88));
  }

  function steady(r: LaneRec, idx: 0 | 1, rate: number, dt: number, sp: number) {
    r.acc[idx] += rate * dt;
    let n = 0;
    while (r.acc[idx] >= r.thr[idx] && n++ < 260) {
      r.acc[idx] -= r.thr[idx];
      r.thr[idx] = rnd(0.6, 1.4);
      if (idx === 0) mkOut(r, sp);
      else mkBack(r, sp);
    }
  }

  function prefill(r: LaneRec, gs: number) {
    const R = r.s1 - r.s0;
    if (R < 8) return;
    r.filled = true;
    const specs: [number, 1 | -1, number][] = [[r.rv[0], 1, r.rv[2]]];
    if (r.rv[1]) specs.push([r.rv[1], -1, r.rv[2]]);
    for (const [rate, dir, speed] of specs) {
      const travel = dir < 0 && r.look === "run" ? 105 : speed || 60;
      const n = Math.min(3200, Math.round(rate * (R / travel) * (r.look === "run" ? quality : QI(quality)) * gs));
      for (let j = 0; j < n; j++) {
        const i = dir > 0 ? mkOut(r, speed) : mkBack(r, speed);
        if (i < 0) return;
        P_u[i] = rnd(0, R * 0.97);
      }
    }
  }

  function stepSpawn(dt: number, quiet: boolean) {
    let running = 0;
    for (const r of lanes.values()) if (r.status === "running" && r.kind !== "message") running++;
    const inten = Math.min(3, 0.35 * running);
    const rmul = 1 + 0.3 * inten;
    T.sm = 1 + 0.2 * inten;
    let nAct = 0;
    let nIdle = 0;
    const need = new Map<LaneRec, number>();
    for (const r of lanes.values()) {
      setRates(r, quiet);
      const R = r.s1 - r.s0;
      if (R < 8) continue;
      if (r.look !== "run" && R < IDLE_MINLEN) {
        const floor = Math.min(3, IDLE_MINLEN / R);
        r.rv[0] *= floor;
        r.rv[1] *= floor;
      }
      const n = R * (r.rv[0] / r.rv[2] + r.rv[1] / (r.look === "run" ? 105 : r.rv[2])) * (r.look === "run" ? rmul : 1);
      need.set(r, n);
      if (r.look === "run") nAct += n * quality;
      else nIdle += n * QI(quality);
    }
    const B = Math.min(liveCap, POOL) * 0.78;
    const idleUse = Math.min(nIdle, B * 0.6);
    const gsI = nIdle > 1e-6 ? Math.min(1, Math.max(0.6, idleUse / nIdle)) : 1;
    const gsA = nAct > 1e-6 ? Math.min(1, Math.max(0.1, (B - Math.min(nIdle * gsI, B * 0.7)) / nAct)) : 1;
    for (const r of lanes.values()) {
      const act = r.look === "run";
      const gs = act ? gsA : gsI;
      if (!r.filled) prefill(r, gs);
      const m = (act ? rmul * quality : QI(quality)) * gs;
      const sp = r.rv[2] * (act ? T.sm : 1);
      if (r.rv[0]) steady(r, 0, r.rv[0] * m, dt, sp);
      if (r.rv[1]) steady(r, 1, r.rv[1] * m, dt, sp);
    }
  }

  function endPos(r: LaneRec) {
    return { x: r.pts[NSEG * 2], y: r.pts[NSEG * 2 + 1] };
  }

  function stepParts(dt: number) {
    for (let i = 0; i < hi; i++) {
      if (!P_on[i]) continue;
      if (P_delay[i] > 0) {
        P_delay[i] -= dt;
        continue;
      }
      P_age[i] += dt;
      if (P_free[i]) {
        P_x[i] += P_vx[i] * dt;
        P_y[i] += P_vy[i] * dt;
        const drag = Math.exp(-1.5 * dt);
        P_vx[i] *= drag;
        P_vy[i] *= drag;
        if (P_age[i] > P_life[i]) kill(i);
        continue;
      }
      const e = etab[P_e[i]];
      if (!e || (e.dead && T.t - e.deadAt > 0.55)) {
        kill(i);
        continue;
      }
      const R = e.s1 - e.s0;
      P_u[i] += P_speed[i] * T.sm * dt;
      if (P_u[i] >= R) {
        if (P_arr[i] === 1) puff(e.sx, e.sy, 24, S_RUN, 20, 60, 0.7, 0.6, e.rs + 4);
        else if (P_arr[i] === 2) {
          const ep = endPos(e);
          puff(ep.x, ep.y, 24, S_ACC, 15, 50, 0.7, 0.6, e.rt + 4);
        }
        kill(i);
      }
    }
    while (hi > 0 && !P_on[hi - 1]) hi--;
  }

  function atLane(e: LaneRec, d: number, v: number, m: number, sway: number) {
    const dd = d < 0 ? 0 : d > e.len ? e.len : d;
    const s = dd / e.len;
    const f = s * NSEG;
    const i = Math.min(NSEG - 1, f | 0);
    const k = f - i;
    const i2 = i * 2;
    const p = e.pts;
    const n = e.nrm;
    const x = p[i2] + (p[i2 + 2] - p[i2]) * k;
    const y = p[i2 + 1] + (p[i2 + 3] - p[i2 + 1]) * k;
    const nx = n[i2] + (n[i2 + 2] - n[i2]) * k;
    const ny = n[i2 + 1] + (n[i2 + 3] - n[i2 + 1]) * k;
    const W = e.W;
    const tt = T.t;
    const bL = W * (0.55 + 0.45 * Math.sin(6.283 * 1.1 * s + e.ph + tt * 0.35));
    const bR = W * (0.55 + 0.45 * Math.sin(6.283 * 0.8 * s + e.ph2 - tt * 0.3));
    const c0 = W * 0.22 * Math.sin(6.283 * 0.7 * s + e.ph3 + tt * 0.5);
    const vv = 0.5 + (v - 0.5 + sway) * m;
    const off = c0 * m + (vv > 0.5 ? (vv - 0.5) * 2 * bL : (vv - 0.5) * 2 * bR);
    tmp.x = x + nx * off;
    tmp.y = y + ny * off;
  }

  function clearance(x: number, y: number) {
    let best = 99;
    for (const b of boxes) {
      const bx = Math.max(b.x0 - x, 0, x - b.x1);
      const by = Math.max(b.y0 - y, 0, y - b.y1);
      const dd = bx === 0 && by === 0 ? -1 : Math.sqrt(bx * bx + by * by) - 2;
      if (dd < best) best = dd;
    }
    for (const n of nodes) {
      const dx = x - n.x;
      const dy = y - n.y;
      if (Math.abs(dx) > n.r + 12 || Math.abs(dy) > n.r + 12) continue;
      const dd = Math.sqrt(dx * dx + dy * dy) - n.r - 2;
      if (dd < best) best = dd;
    }
    return best;
  }

  function draw() {
    const aK = light ? 1.3 : 1;
    const tt = T.t;
    const [a0, , , d0, e0, f0] = M;
    let glowN = 0;
    for (let i = 0; i < hi; i++) {
      if (!P_on[i] || P_delay[i] > 0) continue;
      let x: number;
      let y: number;
      let al: number;
      if (P_free[i]) {
        const f = 1 - P_age[i] / P_life[i];
        al = P_alpha[i] * f * f * aK;
        x = P_x[i];
        y = P_y[i];
        const cm = clearance(x, y);
        if (cm <= 0) continue;
        if (cm < 8) al *= cm / 8;
      } else {
        const e = etab[P_e[i]];
        if (!e) continue;
        const R = e.s1 - e.s0;
        const u = P_u[i];
        const fr = u / R;
        const sn = Math.sin(Math.PI * (fr < 0 ? 0 : fr > 1 ? 1 : fr));
        const env = Math.pow(sn, 0.55) * (0.6 + 0.4 * sn);
        if (env <= 0.01) continue;
        const a = tt * P_swf[i] + P_sph[i];
        al = P_alpha[i] * env * aK * (0.8 + 0.2 * Math.cos(a * 2.3));
        atLane(e, P_dir[i] > 0 ? e.s0 + u : e.s1 - u, P_v[i], 0.18 + 0.82 * Math.pow(sn, 0.7), Math.sin(a) * P_swa[i]);
        x = tmp.x;
        y = tmp.y;
        if (e.dead) {
          const df = 1 - (tt - e.deadAt) * 2;
          if (df <= 0) continue;
          al *= df;
        }
        const dm = clearance(x, y);
        if (dm <= 0) continue;
        if (dm < 8) al *= dm * 0.125;
      }
      if (al <= 0.02) continue;
      const sprite = slots[P_slot[i]];
      if (!sprite) continue;
      const sz = P_size[i];
      const cls = sz < 0.72 ? 0 : sz < 1.0 ? 1 : 2;
      const X = Math.round(a0 * x + e0);
      const Y = Math.round(d0 * y + f0);
      const disc = sprite.disc[cls];
      ctx.globalAlpha = al > 1 ? 1 : al;
      ctx.drawImage(disc.c, X - disc.o, Y - disc.o);
      if (al > 0.8 && cls === 2 && (i & 3) === 0 && glowN < 500) {
        glowN++;
        ctx.globalAlpha = 0.5 * (al > 1 ? 1 : al);
        ctx.drawImage(sprite.glow.c, X - sprite.glow.o, Y - sprite.glow.o);
      }
    }
  }

  function killAll() {
    for (let i = 0; i < hi; i++) if (P_on[i]) kill(i);
    hi = 0;
    for (const r of lanes.values()) r.filled = false;
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const scene = getScene();
    dpr = Math.min(4, window.devicePixelRatio || 1);
    const w = Math.round(scene.width * dpr);
    const h = Math.round(scene.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (scene.mode === "lines" || !w || !h) {
      if (hi) killAll();
      last = now;
      return;
    }
    const dms = now - last;
    if (throttled && dms < 28) return;
    const dt = Math.min(0.066, last ? dms / 1000 : 0.016);
    last = now;
    const t0 = performance.now();
    T.t += dt;
    if (now - colorsAt > 2000) {
      colorsAt = now;
      readColors();
    }
    const { x: vx, y: vy, k } = scene.view;
    M = [dpr * k, 0, 0, dpr * k, -vx * dpr * k, -vy * dpr * k];
    nodes = scene.nodes;
    boxes = scene.boxes;
    syncLanes(scene);
    if (scene.heartbeat && T.t - lastBeat > HEARTBEAT_S) {
      lastBeat = T.t;
      heartbeatWave();
    }
    stepSpawn(dt, scene.mode === "quiet");
    stepParts(dt);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = light ? "source-over" : "lighter";
    draw();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const cost = performance.now() - t0;
    if (++warm > 90) {
      cbuf[cpos] = cost;
      cpos = (cpos + 1) % cbuf.length;
      if (cfill < cbuf.length) cfill++;
    }
    if (++gTick >= 30 && cfill >= 30) {
      gTick = 0;
      const sorted = Array.from(cbuf.slice(0, cfill)).sort((x, y) => x - y);
      const p95 = sorted[Math.min(cfill - 1, Math.floor(cfill * 0.95))] ?? 0;
      if (p95 > 12) {
        quality = Math.max(0.12, quality * 0.85);
        throttled = quality < 0.4;
      } else if (p95 < 8) {
        quality = Math.min(1, quality * 1.15);
        if (quality > 0.6) throttled = false;
      }
      liveCap = Math.max(4800, Math.round(POOL * Math.min(1, quality * 1.3)));
    }
  }

  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
}

export function useParticleStreams(canvasRef: RefObject<HTMLCanvasElement | null>, sceneRef: RefObject<StreamScene>, enabled: boolean) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !enabled) return;
    return createStreams(canvas, ctx, () => sceneRef.current);
  }, [canvasRef, sceneRef, enabled]);
}
