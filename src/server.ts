import { createServer } from "node:http";
import { createApp } from "./api/app.js";
import { authConfigFromEnv } from "./api/auth.js";
import { attachSockets } from "./api/sockets.js";
import { CourtService } from "./domain/Court.js";
import { MatchOrchestrator } from "./domain/MatchOrchestrator.js";
import { SqliteStore } from "./persistence/SqliteStore.js";

const PORT = Number(process.env.PORT ?? 3000);
const COURT_COUNT = Number(process.env.COURT_COUNT ?? 4);
const DB_PATH = process.env.DB_PATH ?? "data/komet.db";

const orch = new MatchOrchestrator(new CourtService(COURT_COUNT));

// Persistence (Rule 12: recovery). Persist every state change.
const store = new SqliteStore(DB_PATH);
store.bind(orch);

const app = createApp(orch, {
  auth: authConfigFromEnv(),
  sessionSecret: process.env.SESSION_SECRET ?? "change-me-in-production",
  secureCookie: process.env.NODE_ENV === "production",
});
const httpServer = createServer(app);
attachSockets(httpServer, orch);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Komet control plane listening on http://localhost:${PORT}`);
  console.log(`Courts: ${COURT_COUNT} | DB: ${DB_PATH}`);
});

function shutdown(): void {
  httpServer.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
