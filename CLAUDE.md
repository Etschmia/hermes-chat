@AGENTS.md

# Hermes Chat — project architecture

A Next.js 16 UI (served at **https://ui.martuni.de**) for chatting with the
**local Hermes agent**. It is a thin chat client; all state lives in the
browser's `localStorage` (key `hermes-chats`).

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

Never use a `NEXT_PUBLIC_` prefix for these — that would ship the key to the
browser. If you rotate the gateway key, update `HERMES_API_KEY` here, then
**rebuild and restart** (env is read at runtime, but a rebuild is the safe path).

## Run / deploy

The app runs as a detached **production** build on port 3100, reverse-proxied by
Caddy (`/etc/caddy/sites/ui.martuni.de.caddy`, behind HTTP basic_auth user
`BotChef`).

```bash
bun run build                                  # required after editing route.ts / server code
# restart:
pkill -f 'next start' ; sleep 1
setsid env PORT=3100 NODE_ENV=production bun run start > server.log 2>&1 < /dev/null &
```

Logs: `server.log`. Health check: `curl localhost:3100/api/chat -d '{"messages":[{"role":"user","content":"ping"}]}' -H 'content-type: application/json'`.
For local dev use `bun run dev` (also reads `.env.local`).
