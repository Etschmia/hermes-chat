# UI lifecycle scripts

Helper commands to build, start, stop and restart the Hermes Chat UI (the
detached **production** server on `:3100`, reverse-proxied by Caddy at
`https://chat.example.com`) **without hunting for PIDs** and **without ever touching
another service** on the box.

The scripts live in [`../scripts/`](../scripts) (version-controlled here) and are
exposed on `PATH` via symlinks in `~/bin`.

## Commands

| Command | What it does |
| --- | --- |
| `ui-build` | `bun run build` in the app dir. Required after **any** source change — it's a production build, so nothing is live until you rebuild. |
| `ui-start` | Start detached on `:3100` (`PORT=3100 NODE_ENV=production bun run start`), write the pidfile, and wait for `HTTP 200` before returning. |
| `ui-stop` | Terminate the tracked process **group** (`SIGTERM`, then `SIGKILL` if it won't go) and remove the pidfile. |
| `ui-restart` | `ui-stop` + `ui-start`. |
| `hermes-ui status` | Is it running? Prints the pid, how it was found, the HTTP code and the log path. (Default when `hermes-ui` is called with no argument.) |
| `hermes-ui log` | `tail -f server.log`. |

`ui-build`/`ui-start`/`ui-stop`/`ui-restart` are thin wrappers; all logic lives in
the `hermes-ui` dispatcher (`hermes-ui {build|start|stop|restart|status|log}`).

### Everyday workflow

```bash
ui-build && ui-restart    # after editing anything (route.ts, page.tsx, …)
hermes-ui status          # sanity check
hermes-ui log             # watch the server log
```

## Files

| Path | Purpose |
| --- | --- |
| `~/.hermes/ui.pid` | PID of the process **we** started (the `setsid` group leader). |
| `server.log` (app dir) | stdout/stderr of the detached server. Gitignored. |
| `scripts/hermes-ui` | The dispatcher — single source of truth. |
| `scripts/ui-*` | Wrappers, one per verb. |

## How it stays safe

This box also runs **depot3** on `:3045`, **Nextra**, and other Next.js apps. A
naïve `pkill -f 'next start'` would kill *all* of them — that is exactly the trap
these scripts avoid.

- **PID tracking.** `start` records the launched PID in `~/.hermes/ui.pid`;
  `stop`/`restart`/`status` read it back. No process searching in the common case.
- **cwd verification.** If the pidfile is missing (e.g. after a reboot, or the
  server was started by hand), the scripts fall back to "who is listening on
  `:3100`?" — but they act **only** if that process's working directory is this
  app dir. Anything else on the port is left alone, and `start` refuses rather
  than fighting over it.
- **Process-group kill.** `start` uses `setsid`, so the `bun → next → next-server`
  tree shares one process group. `stop` derives the PGID (`ps -o pgid=`) and
  signals the whole group, so no orphaned `bun` parent is left behind.
- **Readiness wait.** `start` polls `GET /` until `HTTP 200` (or the process dies,
  in which case it tails the log and fails loudly) — so a green `ui-start` means
  the server actually answered.

## Install / reinstall

The repo is the source of truth; `~/bin` just points at it (and `~/bin` is on
`PATH`). To (re)create the symlinks on a fresh checkout:

```bash
for f in hermes-ui ui-build ui-start ui-stop ui-restart; do
  ln -sfn "/home/librechat/hermes-chat/scripts/$f" "$HOME/bin/$f"
done
```

Edit the scripts in `scripts/` (not in `~/bin`) — the symlinks pick up changes
immediately.

## Troubleshooting

- **`Port 3100 ist belegt — aber NICHT von uns`** — another process holds the
  port. Find it with `ss -ltnp | grep :3100` before doing anything.
- **`status` shows `(port)` instead of `(pidfile)`** — the server is running but
  wasn't started through these scripts (no pidfile). `ui-stop` then `ui-start`
  (or `ui-restart`) re-establishes tracking.
- **Won't start, `ui-start` tails an error** — read `server.log`; a missing
  `HERMES_API_KEY` or a stale `.next` build are the usual causes (`ui-build`).
