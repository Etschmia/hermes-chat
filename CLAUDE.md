@AGENTS.md

# Hermes Chat — project architecture

A Next.js 16 UI (served at **https://chat.example.com**) for chatting with the
**local Hermes agent**. The chat history is persisted **server-side** (so it
follows the user across devices); the browser's `localStorage` (key
`hermes-chats`) is only a per-device cache for instant paint and offline use.

## How a message flows

```
Browser (app/page.tsx)
  → POST /api/chat            (same-origin, so no CORS, key stays server-side)
    → app/api/chat/route.ts   (proxy)
      → POST http://127.0.0.1:8081/v1/chat/completions   (Hermes gateway)
```

The route is an OpenAI-compatible proxy. **Do not call an external provider
(xAI/OpenAI) from here** — the backend is the local Hermes gateway. Earlier code
pointed at `https://api.x.ai/v1` with no auth, which is the bug that caused
"Fehler bei der Verbindung zu Hermes".

## Chat persistence (cross-device)

```
Browser (app/page.tsx)
  GET  /api/chats  on mount   → loads the history (server is the source of truth)
  PUT  /api/chats  on change  → debounced save; also flushed on tab hide (keepalive)
    → app/api/chats/route.ts  → reads/writes a JSON file (atomic temp+rename)
```

- Store file: **`~/.hermes/ui-chats.json`** (override with `HERMES_CHATS_FILE`),
  kept **outside** the project so a rebuild/redeploy can't wipe it.
- `localStorage` is a cache only. On first run after this shipped, a device whose
  server store is still empty **migrates its cached chats up** (empty-server +
  non-empty-cache ⇒ keep local, then PUT) — so existing desktop chats are not lost.
- Single-user, so writes are last-write-wins; the atomic rename prevents a torn
  file. Returning to a foreground tab with nothing unsynced re-pulls the server
  state so two devices converge.

## The Hermes gateway

- Runs as the systemd **user** service `hermes-gateway.service`
  (`python -m hermes_cli.main gateway run`), listening on `127.0.0.1:8081`.
- OpenAI-compatible: `GET /health` (200), `GET /v1/models`
  (advertises model id `hermes-agent`), `POST /v1/chat/completions`.
- **Auth:** `Authorization: Bearer <API_SERVER_KEY>`. Without it → `401
  {"code":"invalid_api_key"}`.
- The effective key is the **`API_SERVER_KEY` env var** of the gateway, set in
  `~/.config/systemd/user/hermes-gateway.service.d/override.conf`.
  (Note: the `api_server.key` value in `~/.hermes/config.yaml` is stale/unused —
  the env var wins. Don't trust that file's value.)
- It's a full agent (tool use), so a turn injects ~17k prompt tokens and takes a
  few seconds. Keep requests non-streaming and one-at-a-time; don't hammer it.

## Configuration (`.env.local`, gitignored — server-side only)

| Var               | Purpose                          | Default                      |
| ----------------- | -------------------------------- | ---------------------------- |
| `HERMES_API_BASE` | gateway base URL                 | `http://127.0.0.1:8081/v1`   |
| `HERMES_MODEL`    | model id sent upstream           | `hermes-agent`               |
| `HERMES_API_KEY`  | Bearer token (**must** match the gateway's `API_SERVER_KEY`) | — |
| `HERMES_TIMEOUT_MS` | per-turn timeout (optional)    | `180000`                     |
| `HERMES_CHATS_FILE` | server-side chat store path (optional) | `~/.hermes/ui-chats.json` |

Never use a `NEXT_PUBLIC_` prefix for these — that would ship the key to the
browser. If you rotate the gateway key, update `HERMES_API_KEY` here, then
**rebuild and restart** (env is read at runtime, but a rebuild is the safe path).

## Run / deploy

The app runs as a detached **production** build on port 3100, reverse-proxied by
Caddy (`/etc/caddy/sites/chat.example.com.caddy`, behind HTTP basic_auth user
`<basic-auth-user>`).

Manage it with the lifecycle scripts (`~/bin`, dispatcher `hermes-ui`):

```bash
ui-build      # bun run build  (required after editing route.ts / server code)
ui-start      # start detached on :3100, write ~/.hermes/ui.pid, wait for HTTP 200
ui-stop       # kill the tracked process GROUP, remove the pidfile
ui-restart    # stop + start
hermes-ui status   # running? pid, HTTP code, log path
hermes-ui log      # tail -f server.log
```

The scripts track our PID in `~/.hermes/ui.pid` and only ever touch a process
whose **cwd is this app dir** — so they can never hit depot3 (:3045), Nextra,
etc. **Do NOT** use `pkill -f 'next start'` — that matches and kills those other
Next.js apps too. Full reference: [`docs/ui-lifecycle.md`](docs/ui-lifecycle.md)
(scripts live in `scripts/`, symlinked into `~/bin`).

Logs: `server.log`. Health check: `curl localhost:3100/api/chat -d '{"messages":[{"role":"user","content":"ping"}]}' -H 'content-type: application/json'`.
For local dev use `bun run dev` (also reads `.env.local`).
