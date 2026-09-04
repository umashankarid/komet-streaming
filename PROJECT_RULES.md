# BMK Komet Streaming — Project Rules

These rules are binding for every change made to this repository. They exist to
keep the control plane correct, testable, and loosely coupled from the video
transport layer.

## Rule 1 — 80% Unit Test Coverage (MANDATORY)

**Every code update MUST keep unit-test coverage at or above 80%.**

- Coverage thresholds are enforced by Vitest (`vitest.config.ts`): lines,
  statements, functions, and branches are all set to **80%**.
- A change is not considered complete until `npm run test:coverage` passes.
- CI and local verification: run `npm run verify` (build + coverage) before
  committing. If coverage drops below 80%, the command fails and the change is
  rejected.
- New features and bug fixes must ship with the tests that cover them. Do not
  lower the thresholds to make a build pass.

## Rule 2 — The Control Plane Never Transports Video

The Komet application owns match state, score state, and overlay rendering only.
Camera video is handled entirely by OBS and the phone senders (VDO.Ninja / SRT).
Never add video ingest/transport code to this application.

## Rule 3 — Camera Layer Independence

The camera + OBS layer must remain fully functional even when this application is
offline. Nothing in this app may become a hard dependency of the video path.

## Rule 4 — Authoritative State in the Domain Layer

`src/domain` holds the single source of truth for courts, matches, and scores.
API, WebSocket, and persistence layers are thin adapters around the domain. Keep
business logic (scoring rules, match lifecycle) out of controllers and sockets.

## Rule 5 — Naming Conventions (per architecture doc)

For court N (zero-padded to 2 digits):

| Concept        | Pattern            | Example (Court 1) |
|----------------|--------------------|-------------------|
| Phone device   | `KOMET-CAM-0N`     | `KOMET-CAM-01`    |
| OBS cam source | `CAM_COURT_0N`     | `CAM_COURT_01`    |
| Overlay source | `OVERLAY_COURT_0N` | `OVERLAY_COURT_01`|
| Scene          | `COURT_0N_LIVE`    | `COURT_01_LIVE`   |
| Overlay URL    | `/overlay/court/N` | `/overlay/court/1`|
| Score URL      | `/score/N`         | `/score/1`        |

## Rule 6 — Badminton Scoring Rules Are Fixed

Rally-point scoring: first to 21 with a 2-point lead; hard cap at 30. Match is
best of 3 games. These rules live in the Score domain and are covered by tests.

## Rule 7 — Manual Workflow First

Tournamentsoftware import and OBS-WebSocket automation are added only after the
manual scoring/overlay workflow is stable. Do not couple the MVP to them.
