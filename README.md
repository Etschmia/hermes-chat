# Hermes Chat

A lightweight, mobile-friendly web UI for chatting with a **local Hermes agent**
(an OpenAI-compatible agent gateway). It's a thin client: you bring your own
Hermes gateway, point this app at it, and get a clean multi-chat interface in the
browser.

> Built with Next.js 16 (App Router) + React 19 + Tailwind CSS v4.

## Features

- **Multi-chat** sidebar — create, rename (double-click), pin, and delete chats.
- **Cross-device history** — chats are persisted **server-side** (a JSON file),
  so they follow you between desktop and phone. `localStorage` is just a cache.
- **Mobile-first** — the sidebar collapses into an off-canvas drawer; full-width
  conversation, safe-area aware, no iOS zoom-on-focus.
- **Attachments** — add images and text files three ways:
  - paste an image from the clipboard,
  - the **+** button file picker,
  - drag & drop onto the window.
  Images are downscaled in-browser and sent as OpenAI multimodal `image_url`
  parts (the agent actually sees them); text files are inlined into the message.
- **Generated images** — when the agent returns an image, it's rendered inline
  with a one-click **download the original** link.
- **Depot Design System** styling — Schibsted Grotesk / Bricolage Grotesque, a
  warm, calm palette, and a custom loading spinner.

## How it works

```
Browser (app/page.tsx)
  → POST /api/chat   (same-origin proxy; the API key stays server-side)
    → POST http://127.0.0.1:8081/v1/chat/completions   (your Hermes gateway)

Chat history:   GET/PUT /api/chats     → a JSON file on the server
Generated imgs: GET     /api/genimage  → serves agent-written image files
```

The `/api/chat` route is an OpenAI-compatible proxy to a **local** gateway — the
key never reaches the browser. See [`CLAUDE.md`](CLAUDE.md) for the full
architecture (gateway expectations, attachment format, persistence, image
serving).

## Requirements

- [Bun](https://bun.sh) (or Node 20+) for building/running.
- A running **Hermes gateway** (or any OpenAI-compatible `/v1/chat/completions`
  endpoint) reachable from the server, advertising a model id you configure.

## Configuration

Create `.env.local` (server-side only — **never** use a `NEXT_PUBLIC_` prefix,
that would ship the key to the browser):

| Var                 | Purpose                                   | Default                      |
| ------------------- | ----------------------------------------- | ---------------------------- |
| `HERMES_API_BASE`   | gateway base URL                          | `http://127.0.0.1:8081/v1`   |
| `HERMES_MODEL`      | model id sent upstream                    | `hermes-agent`               |
| `HERMES_API_KEY`    | bearer token for the gateway              | —                            |
| `HERMES_TIMEOUT_MS` | per-turn timeout                          | `180000`                     |
| `HERMES_CHATS_FILE` | server-side chat store path               | `~/.hermes/ui-chats.json`    |
| `HERMES_IMAGE_DIRS` | allowlist of dirs `/api/genimage` may serve | Hermes image cache dirs    |

## Develop & run

```bash
bun install
bun run dev          # http://localhost:3000

# production:
bun run build
PORT=3100 NODE_ENV=production bun run start
```

## ⚠️ Security — your responsibility

**This app ships with NO authentication, authorization, or transport security of
its own, and adding it is intentionally out of scope.** Anyone who can reach the
port can use the chat, read the **entire stored history**, and drive your agent
(which can run tools). The chat history is also stored **unencrypted** on the
server and cached in each browser's `localStorage`.

**Securing this UI is entirely the operator's responsibility.** Before exposing
it beyond `localhost`, you should put it behind protection you control — for
example:

- A reverse proxy with authentication and TLS. With **[Caddy](https://caddyserver.com)**
  this is a few lines:

  ```caddy
  chat.example.com {
      # HTTP basic auth (generate the hash with: caddy hash-password)
      basicauth {
          youruser JDJhJDE0...your-bcrypt-hash...
      }
      reverse_proxy 127.0.0.1:3100
  }
  ```

  (Caddy provisions HTTPS automatically.) Prefer stronger auth — an OAuth/OIDC
  forward-auth proxy, mTLS, a VPN/Tailscale, or an SSO gateway — where you can.
- **Bind the app to `localhost`** and never expose the raw port publicly; let the
  proxy be the only public entry point.
- Restrict network access (firewall / private network) as appropriate.

Treat the absence of built-in auth as deliberate: this is a personal tool meant
to sit behind your own protection, not a hardened public service.

---

Personal project — no warranty. Use at your own risk.
