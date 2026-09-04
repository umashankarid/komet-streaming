import { createServer } from "node:http";
import { createApp } from "./api/app.js";
import { authConfigFromEnv } from "./api/auth.js";
import { attachSockets } from "./api/sockets.js";
import { CourtService } from "./domain/Court.js";
import { MatchOrchestrator } from "./domain/MatchOrchestrator.js";
import { youTubeServiceFromEnv } from "./integrations/YouTubeService.js";
import { SqliteStore } from "./persistence/SqliteStore.js";

const PORT = Number(process.env.PORT ?? 3000);
const COURT_COUNT = Number(process.env.COURT_COUNT ?? 4);
const DB_PATH = process.env.DB_PATH ?? "data/komet.db";

const orch = new MatchOrchestrator(new CourtService(COURT_COUNT));

// Persistence (Rule 12: recovery). Persist every state change.
const store = new SqliteStore(DB_PATH);
store.bind(orch);

const youtube = youTubeServiceFromEnv();

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
});
const httpServer = createServer(app);
attachSockets(httpServer, orch);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Komet control plane listening on http://localhost:${PORT}`);
  console.log(`Courts: ${COURT_COUNT} | DB: ${DB_PATH}`);
  console.log(`YouTube integration: ${youtube.enabled ? "enabled" : "disabled (fallback)"}`);
});

function shutdown(): void {
  httpServer.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
