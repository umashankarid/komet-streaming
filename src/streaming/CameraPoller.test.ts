import { describe, expect, it, vi } from "vitest";
import { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import { CameraPoller } from "./CameraPoller.js";
import type { GatewayCourtStatus, MediaGateway } from "./MediaGatewayClient.js";

function stubGateway(
  statuses: GatewayCourtStatus[] | (() => Promise<GatewayCourtStatus[]>),
): MediaGateway {
  return {
    enabled: true,
    async startCourt(courtId: number) {
      return { ok: true, courtId };
    },
    async stopCourt() {
      return { ok: true, stopped: true };
    },
    getStatus: typeof statuses === "function" ? statuses : async () => statuses,
  };
}

describe("CameraPoller", () => {
  it("marks a reported connected court as camera-connected with media", async () => {
    const orch = new MatchOrchestrator();
    const gateway = stubGateway([
      { courtId: 1, running: true, connected: true, media: { width: 1920, height: 1080, fps: 30, bitrateKbps: 6000 } },
    ]);
    const poller = new CameraPoller({ orch, gateway, courtCount: 2 });
    await poller.pollOnce();

    const c1 = orch.streamingSnapshot(1);
    expect(c1.cameraConnected).toBe(true);
    expect(c1.camera).toEqual({ width: 1920, height: 1080, fps: 30, bitrateKbps: 6000 });
    // Court 2 not reported → disconnected.
    expect(orch.streamingSnapshot(2).cameraConnected).toBe(false);
  });

  it("marks a court disconnected when it disappears from status", async () => {
    const orch = new MatchOrchestrator();
    let statuses: GatewayCourtStatus[] = [
      { courtId: 1, running: true, connected: true },
    ];
    const gateway = stubGateway(async () => statuses);
    const poller = new CameraPoller({ orch, gateway, courtCount: 1 });
    await poller.pollOnce();
    expect(orch.streamingSnapshot(1).cameraConnected).toBe(true);
    // Camera drops.
    statuses = [];
    await poller.pollOnce();
    expect(orch.streamingSnapshot(1).cameraConnected).toBe(false);
  });

  it("broadcasts a streaming update when connectivity changes", async () => {
    const orch = new MatchOrchestrator();
    const listener = vi.fn();
    orch.onStreamingUpdate(listener);
    const gateway = stubGateway([{ courtId: 1, running: true, connected: true }]);
    await new CameraPoller({ orch, gateway, courtCount: 1 }).pollOnce();
    expect(listener).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ cameraConnected: true }),
    );
  });

  it("swallows gateway errors and leaves state unchanged", async () => {
    const orch = new MatchOrchestrator();
    const gateway = stubGateway(async () => {
      throw new Error("gateway down");
    });
    const poller = new CameraPoller({ orch, gateway, courtCount: 1 });
    await expect(poller.pollOnce()).resolves.toBeUndefined();
    expect(orch.streamingSnapshot(1).cameraConnected).toBe(false);
  });

  it("start() runs a cycle and stop() halts polling", async () => {
    vi.useFakeTimers();
    try {
      const orch = new MatchOrchestrator();
      const getStatus = vi.fn(async () => [] as GatewayCourtStatus[]);
      const gateway = stubGateway(getStatus);
      const poller = new CameraPoller({ orch, gateway, intervalMs: 1000, courtCount: 1 });
      const stop = poller.start();
      // Immediate call on start.
      await Promise.resolve();
      expect(getStatus).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(getStatus).toHaveBeenCalledTimes(2);
      stop();
      await vi.advanceTimersByTimeAsync(3000);
      expect(getStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
