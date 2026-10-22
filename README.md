# Nebula

A local dashboard for your Claude Code agents: what each running session and subagent is doing, which folder it runs in, how they orchestrate each other, when one needs you, and what it costs.

Nebula only reads the files Claude Code already writes to your machine (read-only), and only listens on `127.0.0.1`.

## Set up on a new machine

You need Docker with Compose v2 (Docker Desktop, OrbStack, or Docker Engine on Linux) and Claude Code installed and run at least once.

```bash
git clone https://github.com/LucasWerey/nebula.git && cd nebula
./scripts/setup.sh            # writes .env for this machine
docker compose up -d --build  # first build downloads npm packages
```

Open http://localhost:7878. The container restarts with Docker, so Nebula is there whenever Docker runs.

```bash
docker compose logs -f   # server logs
docker compose down      # stop
docker compose up -d --build   # after pulling changes
```

To get desktop notifications when a session needs you, click **Alerts off** in the top bar and allow notifications for `localhost` in your browser (and for your browser in your OS notification settings).

## Configuration

`scripts/setup.sh` creates `.env` from what it finds on the machine. To set it by hand, copy `.env.example` to `.env`.

| Variable | Default | What it does |
|---|---|---|
| `NEBULA_PORT` | `7878` | Port on `localhost` |
| `CLAUDE_DIR` | `~/.claude` | Folder Claude Code writes to. Set it if you use `CLAUDE_CONFIG_DIR` |
| `UID` / `GID` | `1000` | User the container runs as. **On Linux it must be your user** (`id -u` / `id -g`) |

Dates (today's spend, daily costs) follow your browser's timezone; nothing to configure.

## Platform notes

- **macOS**: works with Docker Desktop or OrbStack.
- **Linux**: run `scripts/setup.sh` so the container runs as your user. Claude Code's transcripts are only readable by their owner, so with the wrong `UID` Nebula sees no sessions and shows a "permission denied" banner.
- **Windows**: use WSL2 and run Claude Code and Nebula from the same WSL distribution. A native Windows Claude Code install keeps its files under `%USERPROFILE%\.claude`; set `CLAUDE_DIR` to that path.

## Claude Code versions

Nebula reads Claude Code's local files, which are internal and can change between versions:

| File | Used for |
|---|---|
| `~/.claude/sessions/<pid>.json` | Running sessions, busy/idle status, "needs you" alerts |
| `~/.claude/projects/*/<session>.jsonl` | Titles, prompts, tool calls and results, images, token usage, compactions, spawns, messages |
| `~/.claude/projects/*/<session>/subagents/` | Subagent transcripts and which tool call spawned them |

It was built and tested against **Claude Code 2.1.x**. On another version Nebula keeps working with what it can read and shows a banner when it detects a different version, a missing sessions folder, or session files without a status. Running status, subagent returns and compaction counts are the most likely to go missing.

## Costs

Costs are API-equivalent estimates. They are computed from each request's `usage` at list prices: input, output, cache reads, 5-minute and 1-hour cache writes, fast mode at 2x, and web search at $10 per 1k searches. Requests are deduplicated by message id. On a subscription plan, this is not what you are billed. Update `PRICING` in `server.js` when prices change.

## Project layout

| Path | What |
|---|---|
| `server.js` | Node API (`/api/state`, `/api/session/:id`, `/api/costs`, `/api/image/:id`), no dependencies; also serves `web/dist` |
| `web/` | React 19 + Vite + Tailwind v4 front end built on Lumen (`@ledgerhq/lumen-ui-react`, `ledgerLivePreset`) |
| `web/src/features/graph` | Orchestration map (particle streams, draggable) and agent timeline |
| `web/src/features/session` | Session header, stat tiles, agents table, activity log, cost breakdown |
| `web/src/features/alerts` | "Needs you" detection, notifications, dialog, stuck and compatibility banners |
| `web/src/features/costs` | Costs view |
| `scripts/setup.sh` | Writes `.env` for the current machine |

## Develop

```bash
npm run dev                # API on :7878, reading ~/.claude directly
cd web && npm run dev      # front end on :5173 with hot reload, proxies /api to :7878
cd web && npm run build    # typecheck + production build into web/dist
```
