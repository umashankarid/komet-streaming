import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type Request, type Response } from "express";
import type { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import type { Side } from "../domain/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../../public");

const SIDES: Side[] = ["home", "away"];

/**
 * Fixed per-court scorer links (fully open URLs, no tokens):
 *
 *   GET  /score-link/court:court            -> scorer page shell
 *   GET  /score-link/court:court/state      -> current snapshot (+ active flag)
 *   POST /score-link/court:court/point      -> { side } +1 (auto-advances sets)
 *   POST /score-link/court:court/correct    -> { side } -1
 *
 * Scoring is only accepted while the court's match is LIVE (started by the
 * admin on /control). Otherwise the link is "inactive": the page shows a
 * waiting state and scoring POSTs are rejected with 409. This keeps the links
 * stable/printable while ensuring random visitors can't score outside a live
 * match.
 */
export function createLiveScoreRouter(orch: MatchOrchestrator): Router {
  const router = Router();

  const parseCourt = (req: Request): number => {
    const id = Number(req.params.court);
    if (!Number.isInteger(id) || id < 1) {
      const e = new Error("court must be a positive integer") as Error & { status?: number };
      e.status = 400;
      throw e;
    }
    return id;
  };

  const parseSide = (value: unknown): Side => {
    if (typeof value !== "string" || !SIDES.includes(value as Side)) {
      const e = new Error("side must be home or away") as Error & { status?: number };
      e.status = 400;
      throw e;
    }
    return value as Side;
  };

  /** Snapshot that tolerates a court that was never created (returns null). */
  const safeSnapshot = (courtId: number) => {
    try {
      return orch.snapshot(courtId) ?? null;
    } catch {
      return null;
    }
  };

  /** Scoring is active only while the court's match is live. */
  const isActive = (courtId: number): boolean => {
    const snap = safeSnapshot(courtId);
    return Boolean(snap && snap.status === "live");
  };

  const handle = (fn: (req: Request, res: Response, courtId: number) => void) => {
    return (req: Request, res: Response) => {
      try {
        fn(req, res, parseCourt(req));
      } catch (err) {
        const e = err as Error & { status?: number };
        res.status(e.status ?? 400).json({ error: e.message });
      }
    };
  };

  const scoringAction = (
    fn: (req: Request, res: Response, courtId: number) => void,
  ) => {
    return handle((req, res, courtId) => {
      if (!isActive(courtId)) {
        return res.status(409).json({
          error: "Scoring is not active for this court (no live match).",
          active: false,
        });
      }
      fn(req, res, courtId);
    });
  };

  // Public scorer page shell.
  router.get("/score-link/court:court", (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "livescore.html")),
  );

  // Current state + whether scoring is active right now.
  router.get(
    "/score-link/court:court/state",
    handle((_req, res, courtId) => {
      res.json({ active: isActive(courtId), match: safeSnapshot(courtId) });
    }),
  );

  router.post(
    "/score-link/court:court/point",
    scoringAction((req, res, courtId) => {
      res.json(orch.scorePoint(courtId, parseSide(req.body?.side)));
    }),
  );

  router.post(
    "/score-link/court:court/correct",
    scoringAction((req, res, courtId) => {
      res.json(orch.correct(courtId, parseSide(req.body?.side)));
    }),
  );

  return router;
}
