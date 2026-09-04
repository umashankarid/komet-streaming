# BMK Komet — Streaming Control Plane

Control plane for multi-court badminton streaming. It owns the **authoritative
match and score state** for every court and serves browser pages that OBS renders
as overlays. It does **not** transport video — cameras (Android phones) feed OBS
directly via VDO.Ninja or SRT, and OBS streams to YouTube. See `PROJECT_RULES.md`.

```
Android phones ──video──► OBS Studio ──► YouTube Live
                             ▲
                    browser overlay (this app)
                             │
        control / score / overlay pages + REST + WebSocket
```

## Stack

- Node.js 20 + TypeScript + Express
- Socket.IO for real-time score push
- SQLite (`better-sqlite3`) for state persistence / recovery
- Vitest with an enforced **80% coverage gate** (see `PROJECT_RULES.md`, Rule 1)
- Plain HTML/CSS/JS overlay pages (no framework), transparent for OBS

## Project layout

```
src/
  domain/            Authoritative state (single source of truth)
    types.ts         Shared types + DEFAULT_SCORING (21 / winBy 2 / cap 30 / bo3)
    Score.ts         Rally-point scoring engine
    Match.ts         Match lifecycle (scheduled → live → finished) + snapshot
    Court.ts         Court identity + naming conventions + CourtService registry
    MatchOrchestrator.ts  App facade; mutates state and emits update events
  api/
    router.ts        Thin REST adapter over the orchestrator
    sockets.ts       Socket.IO bridge (per-court rooms, court:update events)
    app.ts           Express app: /api + static pages
  persistence/
    SqliteStore.ts   Persists latest snapshot per court
  server.ts          Entry point (wires everything, reads env)
public/
  overlay.html       Transparent OBS scoreboard (/overlay/court/:id)
  control.html       Operator panel (/control)
  score.html         Large single-court display (/score/:id)
```

## Requirements

- **Node.js 20+** (the app uses ESM + `fetch`; native `better-sqlite3` needs a
  matching ABI). If you have `nvm`: `nvm use 20`.

## Development

```bash
npm install
npm run dev            # tsx watch, http://localhost:3000
npm run build          # tsc -> dist/
npm start              # run compiled server

npm test               # run unit tests
npm run test:coverage  # tests + enforce 80% coverage
npm run verify         # build + coverage (run before committing)
```

### Environment variables

| Var           | Default            | Description                       |
|---------------|--------------------|-----------------------------------|
| `PORT`        | `3000`             | HTTP/WebSocket port               |
| `COURT_COUNT` | `4`                | Courts pre-created at startup     |
| `DB_PATH`     | `data/komet.db`    | SQLite file (`:memory:` for none) |
| `TZ`          | `Europe/Stockholm` | Timezone for timestamps/logs      |
| `NODE_ENV`    | `production`*      | *set to `production` in the image |

## URLs

| Purpose          | URL                       |
|------------------|---------------------------|
| Operator control | `/control`                |
| OBS overlay      | `/overlay/court/{n}`      |
| Score display    | `/score/{n}`              |
| Health check     | `/healthz`                |

## REST API

Base path `/api`. Bodies are JSON; responses return the match snapshot.

| Method | Path                               | Body                         |
|--------|------------------------------------|------------------------------|
| GET    | `/courts`                          | –                            |
| GET    | `/courts/:id/match`                | –                            |
| POST   | `/courts/:id/match`                | `{ home, away, scoring? }`   |
| POST   | `/courts/:id/match/start`          | –                            |
| POST   | `/courts/:id/match/point`          | `{ side: "home"\|"away" }`   |
| POST   | `/courts/:id/match/correct`        | `{ side: "home"\|"away" }`   |
| POST   | `/courts/:id/match/next-game`      | –                            |

A team is `{ "players": [{ "name": "A. Andersson", "affiliation": "BMK" }] }`.

### WebSocket

Connect with Socket.IO, then `emit("join-court", courtId)` to join that court's
room. The server pushes `court:update` events (the match snapshot) on every
change.

## OBS setup (per court)

Following the naming convention (Rule 5), for Court 1:

1. Scene `COURT_01_LIVE`.
2. Camera source `CAM_COURT_01` (VDO.Ninja browser source or SRT Media Source).
3. Add a **Browser Source** `OVERLAY_COURT_01` pointing at
   `https://stream.bmkkomet.se/overlay/court/1`, size `1920×1080`, transparent.

## Deployment — Coolify

The control plane runs as a Docker container on the Komet VPS via Coolify.

1. **New Resource** → Git repository → this repo. Set **Build Pack =
   Dockerfile** (Coolify builds the included multi-stage, non-root image).
2. **Ports Exposes**: `3000`. Set the **Domain** (e.g. `stream.bmkkomet.se`);
   Coolify provisions HTTPS and proxies WebSocket upgrades automatically.
3. **Environment variables**:

   ```
   COURT_COUNT=4
   PORT=3000
   DB_PATH=/app/data/komet.db
   NODE_ENV=production
   TZ=Europe/Stockholm
   ```

   `TZ=Europe/Stockholm` keeps match timestamps, logs and future scheduling
   consistent with the club's operation.
4. **Persistent Storage → Volume Mount** (this is required — without it, match
   state is lost on every redeploy):

   | Field            | Value          |
   |------------------|----------------|
   | Type             | Volume Mount   |
   | Name             | `komet-data`   |
   | Source Path      | *(leave empty)*|
   | Destination Path | `/app/data`    |

   Leaving Source Path empty creates a named Docker volume; Coolify may prefix
   the actual volume name with the application's UUID.
5. **Health check**: the image defines a `HEALTHCHECK` against `/healthz`, so
   Coolify's status reflects real container health.
6. **Deploy**. Optionally enable auto-deploy on push.

### State survives redeploys

The overlay/score pages reload state from SQLite on connect, then subscribe for
live changes:

```
score change ─► backend ─┬─► SQLite (persistent history/state)
                         └─► Socket.IO ─► overlay (live)

on reconnect: overlay GET /api/courts/:id/match  (reload from SQLite)
              then Socket.IO for new changes
```

So a mid-match Coolify redeploy is safe — e.g. at 17–13 the WebSocket drops for
a few seconds, the new container starts, SQLite still holds 17–13, the overlay
reconnects, re-fetches, and shows 17–13 again. **This only holds if the
`/app/data` volume is mounted.**

### Verify persistence (do this before a tournament)

1. Create a match, score to a known value (e.g. 17–13).
2. Trigger a redeploy in Coolify.
3. Confirm the overlay/score page reconnects and still shows 17–13.
4. Confirm `GET /healthz` returns `{"status":"ok"}`.

### Backups (recommended before tournament use)

Persistent storage protects against container replacement but **not** loss of
the VPS itself. Add a nightly backup and copy it off-VPS:

```
/app/data/komet.db ─► nightly ─► /backup/komet-YYYY-MM-DD.db ─► off-VPS copy
```

Because WAL mode is enabled, back up with the SQLite backup API / `.backup`
command rather than copying the file mid-write, e.g.:

```bash
sqlite3 /app/data/komet.db ".backup '/backup/komet-$(date +%F).db'"
```

Then sync `/backup` to object storage or another host (cron + `rclone`/`rsync`).

### Build & run locally with Docker

```bash
docker build -t komet-streaming .
docker run -p 3000:3000 \
  -e COURT_COUNT=4 -e TZ=Europe/Stockholm \
  -v komet_data:/app/data komet-streaming
```

Then open `http://localhost:3000/control`.

## Testing policy

Per `PROJECT_RULES.md` Rule 1, **every change must keep coverage ≥ 80%**
(lines, statements, functions, branches). `npm run verify` enforces this; do not
lower the thresholds in `vitest.config.ts`.

## Roadmap (from the architecture doc)

- Tournamentsoftware import (after manual workflow is stable — Rule 7).
- OBS-WebSocket automation (scene/stream/source control).
- PostgreSQL upgrade path if SQLite becomes a constraint.
- Auth roles (admin/scorer) with session/JWT.
