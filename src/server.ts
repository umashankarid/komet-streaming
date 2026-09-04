import { createServer } from "node:http";
import { createApp } from "./api/app.js";
import { authConfigFromEnv } from "./api/auth.js";
import { createAuthRouter } from "./api/authRoutes.js";
import { attachSockets } from "./api/sockets.js";
import { CourtService } from "./domain/Court.js";
import { MatchOrchestrator } from "./domain/MatchOrchestrator.js";
import { youTubeServiceFromEnv } from "./integrations/YouTubeService.js";
import { SqliteStore } from "./persistence/SqliteStore.js";
import { YouTubeAuthService } from "./youtube/YouTubeAuthService.js";
import { YouTubeTokenStore } from "./youtube/YouTubeTokenStore.js";

const PORT = Number(process.env.PORT ?? 3000);
const COURT_COUNT = Number(process.env.COURT_COUNT ?? 4);
const DB_PATH = process.env.DB_PATH ?? "data/komet.db";

const orch = new MatchOrchestrator(new CourtService(COURT_COUNT));

// Persistence (Rule 12: recovery). Persist every state change.
const store = new SqliteStore(DB_PATH);
store.bind(orch);

// --- YouTube "Login with YouTube" OAuth wiring ---
// The encrypted token store shares the same SQLite database.
const ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY ?? process.env.SESSION_SECRET ?? "";
let tokenStore: YouTubeTokenStore | undefined;
let authRouter: ReturnType<typeof createAuthRouter> | undefined;

if (ENCRYPTION_KEY) {
  tokenStore = new YouTubeTokenStore(store.database, ENCRYPTION_KEY);
}

// The YouTube API service reads its refresh token dynamically from the store,
// so a "Login with YouTube" reconnect is picked up without a restart. Falls
// back to YOUTUBE_REFRESH_TOKEN env if present.
const youtube = youTubeServiceFromEnv(
  process.env,
  undefined,
  tokenStore ? () => tokenStore!.getRefreshToken() : undefined,
);

// Interactive OAuth service (needs client id/secret + redirect uri).
const oauthClientId = process.env.YOUTUBE_CLIENT_ID;
const oauthClientSecret = process.env.YOUTUBE_CLIENT_SECRET;
const oauthRedirectUri = process.env.YOUTUBE_REDIRECT_URI;
if (oauthClientId && oauthClientSecret && oauthRedirectUri && tokenStore) {
  const authService = new YouTubeAuthService({
    clientId: oauthClientId,
    clientSecret: oauthClientSecret,
    redirectUri: oauthRedirectUri,
  });
  authRouter = createAuthRouter(authService, tokenStore);
}

const app = createApp(orch, {
  auth: authConfigFromEnv(),
  sessionSecret: process.env.SESSION_SECRET ?? "change-me-in-production",
  secureCookie: process.env.NODE_ENV === "production",
  // Behind Coolify/Traefik, TLS is terminated at the proxy. Trust it so Secure
  // cookies are emitted. Override with TRUST_PROXY=false if running direct.
  trustProxy: process.env.TRUST_PROXY
    ? process.env.TRUST_PROXY !== "false"
    : process.env.NODE_ENV === "production",
  youtube,
  authRouter,
});
const httpServer = createServer(app);
attachSockets(httpServer, orch);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Komet control plane listening on http://localhost:${PORT}`);
  console.log(`Courts: ${COURT_COUNT} | DB: ${DB_PATH}`);
  console.log(`YouTube integration: ${youtube.enabled ? "enabled" : "disabled (fallback)"}`);
  console.log(`YouTube OAuth login: ${authRouter ? "enabled" : "disabled (set YOUTUBE_CLIENT_ID/SECRET/REDIRECT_URI + TOKEN_ENCRYPTION_KEY)"}`);
});

function shutdown(): void {
  httpServer.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
