import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { YouTubeAuthService } from "../youtube/YouTubeAuthService.js";
import type { YouTubeTokenStore } from "../youtube/YouTubeTokenStore.js";

/**
 * Routes for the interactive "Login with YouTube" flow.
 *
 *   GET  /auth/youtube            -> redirect to Google consent
 *   GET  /auth/youtube/callback   -> exchange code, store token, fetch channel
 *   GET  /api/youtube/status      -> { connected, channelTitle } (no secrets)
 *   POST /api/youtube/disconnect  -> remove the stored account
 *
 * The client secret and refresh token never leave the server. A per-request
 * `state` (CSRF token) is kept in the session and re-checked on callback.
 */
export function createAuthRouter(
  auth: YouTubeAuthService | undefined,
  store: YouTubeTokenStore | undefined,
): Router {
  const router = Router();

  const configured = Boolean(auth && store);

  // Begin OAuth: generate state, stash in session, redirect to Google.
  router.get("/auth/youtube", (req: Request, res: Response) => {
    if (!configured) {
      return res
        .status(503)
        .send("YouTube OAuth is not configured on this server.");
    }
    const state = randomBytes(16).toString("hex");
    (req.session as { ytState?: string }).ytState = state;
    return res.redirect(auth!.buildConsentUrl(state));
  });

  // OAuth callback: validate state, exchange code, fetch channel, persist.
  router.get("/auth/youtube/callback", async (req: Request, res: Response) => {
    if (!configured) {
      return res.status(503).send("YouTube OAuth is not configured.");
    }
    const { code, state, error } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };
    if (error) {
      return res.redirect("/control?youtube=denied");
    }
    const expected = (req.session as { ytState?: string }).ytState;
    if (!state || !expected || state !== expected) {
      return res.redirect("/control?youtube=badstate");
    }
    (req.session as { ytState?: string }).ytState = undefined;
    if (!code) {
      return res.redirect("/control?youtube=nocode");
    }
    try {
      const tokens = await auth!.exchangeCode(code);
      if (!tokens.refreshToken) {
        // Google only returns a refresh token on first consent; prompt=consent
        // in the consent URL forces it, so this is an unexpected edge case.
        return res.redirect("/control?youtube=norefresh");
      }
      const channel = await auth!.fetchChannelInfo(tokens.accessToken);
      store!.save({
        channelId: channel.channelId,
        channelTitle: channel.channelTitle,
        refreshToken: tokens.refreshToken,
      });
      return res.redirect("/control?youtube=connected");
    } catch (err) {
      // Do not leak internals to the browser; log server-side.
      // eslint-disable-next-line no-console
      console.error("YouTube OAuth callback failed:", (err as Error).message);
      return res.redirect("/control?youtube=error");
    }
  });

  // Connection status for the UI — safe fields only.
  router.get("/api/youtube/status", (_req: Request, res: Response) => {
    if (!store) return res.json({ connected: false, configured: false });
    return res.json({ ...store.publicStatus(), configured });
  });

  // Disconnect the account.
  router.post("/api/youtube/disconnect", (_req: Request, res: Response) => {
    if (store) store.clear();
    return res.json({ connected: false });
  });

  return router;
}
