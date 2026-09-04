import { Router, type Request, type Response } from "express";
import type { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import type { Side, Team } from "../domain/types.js";

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
      res.status(201).json(
        orch.createMatch({ courtId, home, away, scoring: req.body?.scoring }),
      );
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
