import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import type { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import { createApiRouter } from "./router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** public/ lives at the repo root; from dist/api it is ../../public. */
const PUBLIC_DIR = path.resolve(__dirname, "../../public");

/**
 * Build the Express app: JSON API under /api and static overlay/control/score
 * pages from public/. Kept separate from server startup so it can be tested.
 */
export function createApp(orch: MatchOrchestrator): Express {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", createApiRouter(orch));

  // Static browser pages: /overlay/court/:id, /control, /score/:id
  app.use(express.static(PUBLIC_DIR));
  app.get("/overlay/court/:id", (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "overlay.html")),
  );
  app.get("/control", (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "control.html")),
  );
  app.get("/score/:id", (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "score.html")),
  );

  return app;
}
