import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieSession from "cookie-session";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import { type AuthConfig, checkCredentials } from "./auth.js";
import { createApiRouter } from "./router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** public/ lives at the repo root; from dist/api it is ../../public. */
const PUBLIC_DIR = path.resolve(__dirname, "../../public");

export interface AppOptions {
  auth: AuthConfig;
  /** Secret(s) used to sign the session cookie. */
  sessionSecret: string;
  /** Set Secure cookie flag (true behind HTTPS in production). */
  secureCookie?: boolean;
  /**
   * Trust the reverse proxy (e.g. Coolify/Traefik) so Express honours
   * X-Forwarded-Proto and can emit Secure cookies when TLS is terminated at
   * the proxy. Defaults to true whenever secureCookie is enabled — otherwise a
   * Secure cookie would be silently dropped behind an HTTP proxy hop.
   */
  trustProxy?: boolean;
}

/** True if the request carries a valid authenticated session. */
function isAuthed(req: Request): boolean {
  return Boolean((req.session as { user?: string } | undefined)?.user);
}

/**
 * Build the Express app.
 *
 * Auth model (simple, single admin — Rule 7):
 *  - Public: /login, /healthz, /overlay/court/:id, and GET /api reads
 *    (overlays are loaded by OBS and cannot log in).
 *  - Protected: / (dashboard), /control, /score/:id, and all mutating /api
 *    POSTs — these require a valid session or redirect/401.
 */
export function createApp(orch: MatchOrchestrator, opts: AppOptions): Express {
  const app = express();
  const secureCookie = opts.secureCookie ?? false;
  // A Secure cookie is only sent when Express considers the connection secure.
  // Behind a TLS-terminating proxy the app sees plain HTTP, so it must trust
  // the proxy's X-Forwarded-Proto header. Default trustProxy to secureCookie.
  if (opts.trustProxy ?? secureCookie) {
    app.set("trust proxy", 1);
  }
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    cookieSession({
      name: "komet.sid",
      secret: opts.sessionSecret,
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookie,
      maxAge: 12 * 60 * 60 * 1000, // 12h — covers a tournament day
    }),
  );

  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

  // --- Auth routes ---
  app.get("/login", (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "login.html")),
  );
  app.post("/login", (req, res) => {
    const { username = "", password = "" } = req.body ?? {};
    if (checkCredentials(opts.auth, String(username), String(password))) {
      (req.session as { user?: string }).user = opts.auth.username;
      return res.redirect("/");
    }
    return res.redirect("/login?error=1");
  });
  app.post("/logout", (req, res) => {
    req.session = null;
    res.redirect("/login");
  });

  // --- API: reads are public (overlays need them), writes require auth ---
  const requireApiAuth = (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || isAuthed(req)) return next();
    return res.status(401).json({ error: "Authentication required" });
  };
  app.use("/api", requireApiAuth, createApiRouter(orch));

  // --- Public overlay (OBS browser source cannot authenticate) ---
  app.get("/overlay/court/:id", (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "overlay.html")),
  );
  app.get("/overlay/court/:id/ticker", (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "ticker.html")),
  );

  // --- Protected human pages ---
  const requirePageAuth = (req: Request, res: Response, next: NextFunction) => {
    if (isAuthed(req)) return next();
    return res.redirect("/login");
  };
  app.get("/", requirePageAuth, (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "dashboard.html")),
  );
  app.get("/control", requirePageAuth, (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "control.html")),
  );
  app.get("/score/:id", requirePageAuth, (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "score.html")),
  );

  // Static assets only. Block direct access to protected HTML files so the
  // page-auth guards above cannot be bypassed via e.g. /control.html.
  const PROTECTED_FILES = new Set([
    "/dashboard.html",
    "/control.html",
    "/score.html",
  ]);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (PROTECTED_FILES.has(req.path) && !isAuthed(req)) {
      return res.redirect("/login");
    }
    return next();
  });
  app.use(express.static(PUBLIC_DIR, { index: false }));

  return app;
}
