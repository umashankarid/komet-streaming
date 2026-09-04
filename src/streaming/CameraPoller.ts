import type { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import type { GatewayCourtStatus, MediaGateway } from "./MediaGatewayClient.js";

/**
 * Periodically polls the media gateway for per-court ingest status and pushes
 * camera connectivity into the orchestrator (which broadcasts streaming:update
 * over the WebSocket, so /control shows 🟢/🔴 live). This is how Komet Control
 * learns whether a phone is actually sending video to a court.
 *
 * A court present in the gateway status with connected=true is marked
 * connected (with its media info); any court NOT reported is marked
 * disconnected. Errors are swallowed (the gateway may be briefly unreachable).
 */
export class CameraPoller {
  private readonly orch: MatchOrchestrator;
  private readonly gateway: MediaGateway;
  private readonly intervalMs: number;
  private readonly courtCount: number;
  private timer?: ReturnType<typeof setInterval>;

  constructor(params: {
    orch: MatchOrchestrator;
    gateway: MediaGateway;
    intervalMs?: number;
    courtCount?: number;
  }) {
    this.orch = params.orch;
    this.gateway = params.gateway;
    this.intervalMs = params.intervalMs ?? 5000;
    this.courtCount = params.courtCount ?? 4;
  }

  /** Run one poll cycle: fetch gateway status and reconcile each court. */
  async pollOnce(): Promise<void> {
    let statuses: GatewayCourtStatus[] = [];
    try {
      statuses = await this.gateway.getStatus();
    } catch {
      // Gateway unreachable this cycle; leave state unchanged.
      return;
    }
    const byCourt = new Map<number, GatewayCourtStatus>();
    for (const s of statuses) byCourt.set(s.courtId, s);

    for (let courtId = 1; courtId <= this.courtCount; courtId++) {
      const s = byCourt.get(courtId);
      const connected = Boolean(s?.connected);
      const prev = this.orch.streamingSnapshot(courtId);
      // Only emit when connectivity actually changes, to avoid noisy updates.
      const changed = prev.cameraConnected !== connected;
      if (changed || (connected && s?.media)) {
        this.orch.setCameraConnected(courtId, connected, connected ? s?.media : undefined);
      }
    }
  }

  /** Start polling on the configured interval. Returns a stop function. */
  start(): () => void {
    if (this.timer) return () => this.stop();
    // Fire immediately, then on the interval.
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), this.intervalMs);
    // Do not keep the process alive solely for polling.
    if (typeof this.timer.unref === "function") this.timer.unref();
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
