import { Router, type Request, type Response } from "express";
import type { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import { OVERLAY_MODES, type OverlayMode } from "../domain/Streaming.js";
import {
  NoopYouTubeService,
  type YouTubeService,
} from "../integrations/YouTubeService.js";
import {
  NoopMediaGateway,
  type MediaGateway,
} from "../streaming/MediaGatewayClient.js";
import {
  DEFAULT_SCORING,
  type ScoringConfig,
  type Side,
  type Team,
} from "../domain/types.js";

const SIDES: Side[] = ["home", "away"];

function parseCourtId(req: Request): number {
  const id = Number(req.params.courtId);
  if (!Number.isInteger(id) || id < 1) {
    throw new HttpError(400, "courtId must be a positive integer");
  }
  return id;
}

function parseSide(value: unknown): Side {
  if (typeof value !== "string" || !SIDES.includes(value as Side)) {
    throw new HttpError(400, `side must be one of ${SIDES.join(", ")}`);
  }
  return value as Side;
}

function parseOverlayMode(value: unknown): OverlayMode {
  if (typeof value !== "string" || !OVERLAY_MODES.includes(value as OverlayMode)) {
    throw new HttpError(
      400,
      `overlayMode must be one of ${OVERLAY_MODES.join(", ")}`,
    );
  }
  return value as OverlayMode;
}

function parseTeam(value: unknown, label: string): Team {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as Team).players) ||
    (value as Team).players.length === 0
  ) {
    throw new HttpError(400, `${label} must have at least one player`);
  }
  return value as Team;
}

/**
 * Parse an optional partial scoring config from the request body. Any omitted
 * field falls back to DEFAULT_SCORING (15 / win-by-2 / cap 17 / best of 3).
 * Values are range-checked here; the Score constructor enforces invariants too.
 */
function parseScoring(value: unknown): ScoringConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") {
    throw new HttpError(400, "scoring must be an object");
  }
  const v = value as Partial<ScoringConfig>;
  const merged: ScoringConfig = {
    pointsToWin: v.pointsToWin ?? DEFAULT_SCORING.pointsToWin,
    winBy: v.winBy ?? DEFAULT_SCORING.winBy,
    cap: v.cap ?? DEFAULT_SCORING.cap,
    bestOf: v.bestOf ?? DEFAULT_SCORING.bestOf,
  };
  for (const [k, val] of Object.entries(merged)) {
    if (!Number.isInteger(val) || (val as number) < 1) {
      throw new HttpError(400, `scoring.${k} must be a positive integer`);
    }
  }
  if (merged.cap < merged.pointsToWin) {
    throw new HttpError(400, "scoring.cap must be >= scoring.pointsToWin");
  }
  if (merged.bestOf % 2 === 0) {
    throw new HttpError(400, "scoring.bestOf must be an odd number");
  }
  return merged;
}

/** Simple typed HTTP error carried to the error handler. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Builds the REST router. Controllers stay thin: parse/validate input, call the
 * orchestrator, return the resulting snapshot. All logic lives in the domain.
 */
export function createApiRouter(
  orch: MatchOrchestrator,
  youtube: YouTubeService = new NoopYouTubeService(),
  gateway: MediaGateway = new NoopMediaGateway(),
): Router {
  const router = Router();

  const handle = (fn: (req: Request, res: Response) => void) => {
    return (req: Request, res: Response) => {
      try {
        fn(req, res);
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 400;
        res.status(status).json({ error: (err as Error).message });
      }
    };
  };

  // Async variant for routes that call external services (YouTube).
  const handleAsync = (
    fn: (req: Request, res: Response) => Promise<void>,
  ) => {
    return (req: Request, res: Response) => {
      fn(req, res).catch((err) => {
        const status = err instanceof HttpError ? err.status : 400;
        res.status(status).json({ error: (err as Error).message });
      });
    };
  };

  router.get(
    "/courts",
    handle((_req, res) => {
      res.json(
        orch.listCourts().map((c) => ({
          id: c.id,
          naming: c.naming,
          match: c.getMatch()?.snapshot() ?? null,
          streaming: c.streaming.snapshot(),
        })),
      );
    }),
  );

  router.get(
    "/courts/:courtId/match",
    handle((req, res) => {
      const courtId = parseCourtId(req);
      orch.ensureCourt(courtId);
      const snap = orch.snapshot(courtId);
      if (!snap) throw new HttpError(404, `No match on court ${courtId}`);
      res.json(snap);
    }),
  );

  router.post(
    "/courts/:courtId/match",
    handle((req, res) => {
      const courtId = parseCourtId(req);
      const home = parseTeam(req.body?.home, "home");
      const away = parseTeam(req.body?.away, "away");
      const scoring = parseScoring(req.body?.scoring);
      const courtName =
        typeof req.body?.courtName === "string"
          ? req.body.courtName.slice(0, 60)
          : undefined;
      const banner =
        typeof req.body?.banner === "string"
          ? req.body.banner.slice(0, 60)
          : undefined;
      const tickerText =
        typeof req.body?.tickerText === "string"
          ? req.body.tickerText.slice(0, 500)
          : undefined;
      res.status(201).json(
        orch.createMatch({
          courtId,
          home,
          away,
          scoring,
          courtName,
          banner,
          tickerText,
        }),
      );
    }),
  );

  router.post(
    "/courts/:courtId/match/ticker",
    handle((req, res) => {
      const courtId = parseCourtId(req);
      const text =
        typeof req.body?.text === "string"
          ? req.body.text.slice(0, 500)
          : undefined;
      res.json(orch.setTicker(courtId, text));
    }),
  );

  router.post(
    "/courts/:courtId/match/start",
    handle((req, res) => {
      res.json(orch.startMatch(parseCourtId(req)));
    }),
  );

  router.post(
    "/courts/:courtId/match/point",
    handle((req, res) => {
      const courtId = parseCourtId(req);
      res.json(orch.point(courtId, parseSide(req.body?.side)));
    }),
  );

  router.post(
    "/courts/:courtId/match/correct",
    handle((req, res) => {
      const courtId = parseCourtId(req);
      res.json(orch.correct(courtId, parseSide(req.body?.side)));
    }),
  );

  router.post(
    "/courts/:courtId/match/next-game",
    handle((req, res) => {
      res.json(orch.nextGame(parseCourtId(req)));
    }),
  );

  // --- Streaming controls (control-plane state; Rules 2 & 3) -------------
  // Thin controllers over the orchestrator's streaming state machine. These
  // manage YouTube-broadcast/overlay intent only; actual video transport is
  // the separate media gateway's job.

  // Current streaming state for a court (always present, even without a match).
  router.get(
    "/courts/:courtId/streaming",
    handle((req, res) => {
      res.json(orch.streamingSnapshot(parseCourtId(req)));
    }),
  );

  // Suggested YouTube title, derived from the court's match when present.
  router.get(
    "/courts/:courtId/streaming/suggest-title",
    handle((req, res) => {
      const courtId = parseCourtId(req);
      res.json({ courtId, title: orch.suggestTitle(courtId) });
    }),
  );

  // Set/clear the YouTube title (before starting).
  router.post(
    "/courts/:courtId/streaming/title",
    handle((req, res) => {
      const courtId = parseCourtId(req);
      const title =
        typeof req.body?.title === "string" ? req.body.title : undefined;
      res.json(orch.setStreamTitle(courtId, title));
    }),
  );

  // Choose overlay mode (before starting).
  router.post(
    "/courts/:courtId/streaming/overlay",
    handle((req, res) => {
      const courtId = parseCourtId(req);
      res.json(orch.setOverlayMode(courtId, parseOverlayMode(req.body?.overlayMode)));
    }),
  );

  // Report SRT camera connectivity (called by the gateway/health probe).
  router.post(
    "/courts/:courtId/streaming/camera",
    handle((req, res) => {
      const courtId = parseCourtId(req);
      res.json(orch.setCameraConnected(courtId, Boolean(req.body?.connected)));
    }),
  );

  // Begin the start sequence (idle/error -> starting). Title is optional; when
  // omitted an auto-generated title from match info is used. When YouTube is
  // configured, this creates a real broadcast and transitions it live; the
  // returned snapshot is then "live". With no credentials, it falls back to a
  // placeholder broadcast so the UI/state still works.
  router.post(
    "/courts/:courtId/streaming/start",
    handleAsync(async (req, res) => {
      const courtId = parseCourtId(req);
      const title =
        typeof req.body?.title === "string" ? req.body.title : undefined;
      const overlayMode =
        req.body?.overlayMode === undefined
          ? undefined
          : parseOverlayMode(req.body.overlayMode);
      // Enter "starting" first so the state machine validates the transition
      // and the UI reflects progress.
      const starting = orch.requestStreamStart(courtId, { title, overlayMode });
      try {
        const handle = await youtube.createBroadcast({
          title: starting.title ?? orch.suggestTitle(courtId),
        });
        // Tell the media gateway to push this court's SRT input to the
        // broadcast's RTMP target, so video actually reaches YouTube.
        if (gateway.enabled && handle.rtmpUrl) {
          await gateway.startCourt(courtId, handle.rtmpUrl);
        }
        await youtube.transitionToLive(handle.broadcastId);
        res.json(orch.confirmStreamLive(courtId, handle.broadcastId));
      } catch (err) {
        res.status(502).json({
          error: `YouTube start failed: ${(err as Error).message}`,
          streaming: orch.failStream(courtId, (err as Error).message),
        });
      }
    }),
  );

  // Confirm the YouTube broadcast is live (starting -> live). Used when the
  // live transition is driven externally rather than by the start route.
  router.post(
    "/courts/:courtId/streaming/live",
    handle((req, res) => {
      const courtId = parseCourtId(req);
      const broadcastId =
        typeof req.body?.broadcastId === "string" ? req.body.broadcastId : "";
      res.json(orch.confirmStreamLive(courtId, broadcastId));
    }),
  );

  // Begin the stop sequence (live -> stopping) and complete the broadcast.
  router.post(
    "/courts/:courtId/streaming/stop",
    handleAsync(async (req, res) => {
      const courtId = parseCourtId(req);
      const current = orch.streamingSnapshot(courtId);
      const stopping = orch.requestStreamStop(courtId);
      try {
        // Stop the gateway's FFmpeg for this court first (stops pushing video).
        if (gateway.enabled) {
          await gateway.stopCourt(courtId);
        }
        if (current.broadcastId) {
          await youtube.completeBroadcast(current.broadcastId);
        }
        res.json(orch.confirmStreamStopped(courtId));
      } catch (err) {
        // Completing failed, but locally we still stop; surface the error.
        res.status(502).json({
          error: `YouTube stop failed: ${(err as Error).message}`,
          streaming: orch.confirmStreamStopped(courtId),
          hadStopping: stopping.youtubeStatus,
        });
      }
    }),
  );

  // Finalize the stop (stopping -> idle); keeps the camera connection.
  router.post(
    "/courts/:courtId/streaming/stopped",
    handle((req, res) => {
      res.json(orch.confirmStreamStopped(parseCourtId(req)));
    }),
  );

  // Move to error state with a reason.
  router.post(
    "/courts/:courtId/streaming/fail",
    handle((req, res) => {
      const courtId = parseCourtId(req);
      const reason =
        typeof req.body?.reason === "string" ? req.body.reason : "";
      res.json(orch.failStream(courtId, reason));
    }),
  );

  // Recover from error back to idle.
  router.post(
    "/courts/:courtId/streaming/reset",
    handle((req, res) => {
      res.json(orch.resetStream(parseCourtId(req)));
    }),
  );

  return router;
}
