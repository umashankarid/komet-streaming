import { Router, type Request, type Response } from "express";
import type { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
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
export function createApiRouter(orch: MatchOrchestrator): Router {
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

  router.get(
    "/courts",
    handle((_req, res) => {
      res.json(
        orch.listCourts().map((c) => ({
          id: c.id,
          naming: c.naming,
          match: c.getMatch()?.snapshot() ?? null,
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

  return router;
}
