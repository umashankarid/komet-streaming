import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type Request, type Response } from "express";
import type { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import type { Side } from "../domain/types.js";
import type { ScorerTokenStore } from "./ScorerTokenStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../../public");

const SIDES: Side[] = ["home", "away"];

/**
 * Token-gated scorer routes. A scorer opens /livescore/:court?token=... and can
 * only +1/-1 that court; games auto-advance. No login, no other access. The
 * token is validated on every scoring POST against the per-court token store.
 *
 *   GET  /livescore/:court                 -> scorer page (public HTML shell)
 *   GET  /livescore/:court/state?token=..   -> current match snapshot (gated)
 *   POST /livescore/:court/point            -> { side } +1 (gated, auto-advance)
 *   POST /livescore/:court/correct          -> { side } -1 (gated)
 */
export function createLiveScoreRouter(
  orch: MatchOrchestrator,
  tokens: ScorerTokenStore,
): Router {
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

  const tokenFrom = (req: Request): string | undefined => {
    const q = req.query.token;
    if (typeof q === "string") return q;
    const h = req.headers["x-scorer-token"];
    return typeof h === "string" ? h : undefined;
  };

  const parseSide = (value: unknown): Side => {
    if (typeof value !== "string" || !SIDES.includes(value as Side)) {
      const e = new Error("side must be home or away") as Error & { status?: number };
      e.status = 400;
      throw e;
    }
    return value as Side;
  };

  const gated = (
    fn: (req: Request, res: Response, courtId: number) => void,
  ) => {
    return (req: Request, res: Response) => {
      try {
        const courtId = parseCourt(req);
        if (!tokens.isValid(courtId, tokenFrom(req))) {
          return res.status(401).json({ error: "Invalid or missing scorer token" });
        }
        fn(req, res, courtId);
      } catch (err) {
        const e = err as Error & { status?: number };
        res.status(e.status ?? 400).json({ error: e.message });
      }
    };
  };

  // Public HTML shell (the page itself validates the token via the API calls).
  router.get("/livescore/:court", (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "livescore.html")),
  );

  router.get(
    "/livescore/:court/state",
    gated((_req, res, courtId) => {
      const snap = orch.snapshot(courtId);
      res.json(snap ?? null);
    }),
  );

  router.post(
    "/livescore/:court/point",
    gated((req, res, courtId) => {
      const side = parseSide(req.body?.side);
      res.json(orch.scorePoint(courtId, side));
    }),
  );

  router.post(
    "/livescore/:court/correct",
    gated((req, res, courtId) => {
      const side = parseSide(req.body?.side);
      res.json(orch.correct(courtId, side));
    }),
  );

  return router;
}
