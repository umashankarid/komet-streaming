import type { Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import type { MatchOrchestrator } from "../domain/MatchOrchestrator.js";

/**
 * Attach Socket.IO to the HTTP server and bridge orchestrator updates to
 * clients. Overlays/score pages join a per-court room and receive
 * `court:update` events whenever that court's match state changes.
 */
export function attachSockets(
  httpServer: HttpServer,
  orch: MatchOrchestrator,
): IOServer {
  const io = new IOServer(httpServer, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    socket.on("join-court", (courtId: number) => {
      socket.join(`court:${courtId}`);
      const snap = orch.snapshot(Number(courtId));
      if (snap) socket.emit("court:update", snap);
    });
  });

  orch.onUpdate((courtId, snapshot) => {
    io.to(`court:${courtId}`).emit("court:update", snapshot);
  });

  return io;
}
