import { beforeEach, describe, expect, it, vi } from "vitest";
import { MatchOrchestrator } from "./MatchOrchestrator.js";
import type { Team } from "./types.js";

const home: Team = { players: [{ name: "A" }] };
const away: Team = { players: [{ name: "B" }] };

describe("MatchOrchestrator", () => {
  let orch: MatchOrchestrator;

  beforeEach(() => {
    orch = new MatchOrchestrator();
  });

  it("creates a match and auto-creates the court", () => {
    const snap = orch.createMatch({ courtId: 1, home, away });
    expect(snap.status).toBe("scheduled");
    expect(orch.listCourts().map((c) => c.id)).toEqual([1]);
  });

  it("runs a full point flow and returns updated snapshots", () => {
    orch.createMatch({ courtId: 1, home, away });
    orch.startMatch(1);
    const snap = orch.point(1, "home");
    expect(snap.currentGame).toEqual({ home: 1, away: 0 });
  });

  it("supports corrections and next game", () => {
    orch.createMatch({ courtId: 1, home, away });
    orch.startMatch(1);
    orch.point(1, "home");
    orch.correct(1, "home");
    expect(orch.snapshot(1)?.currentGame).toEqual({ home: 0, away: 0 });
  });

  it("notifies and can unsubscribe listeners", () => {
    const listener = vi.fn();
    const off = orch.onUpdate(listener);
    orch.createMatch({ courtId: 1, home, away });
    orch.startMatch(1);
    expect(listener).toHaveBeenCalledWith(1, expect.objectContaining({ courtId: 1 }));
    const calls = listener.mock.calls.length;
    off();
    orch.point(1, "home");
    expect(listener.mock.calls.length).toBe(calls);
  });

  it("advances to the next game via the orchestrator", () => {
    orch.createMatch({ courtId: 1, home, away });
    orch.startMatch(1);
    for (let i = 0; i < 15; i++) orch.point(1, "home"); // game 1 to home (default 15)
    orch.nextGame(1);
    expect(orch.snapshot(1)?.games).toHaveLength(2);
  });

  it("passes custom scoring, court name and banner through", () => {
    const snap = orch.createMatch({
      courtId: 1,
      home,
      away,
      scoring: { pointsToWin: 11, winBy: 2, cap: 15, bestOf: 1 },
      courtName: "Center Court",
      banner: "Final",
    });
    expect(snap.courtName).toBe("Center Court");
    expect(snap.banner).toBe("Final");
    orch.startMatch(1);
    for (let i = 0; i < 11; i++) orch.point(1, "home"); // 11-point game, best of 1
    expect(orch.snapshot(1)?.matchWinner).toBe("home");
  });

  it("sets and clears the ticker text and emits", () => {
    const listener = vi.fn();
    orch.createMatch({ courtId: 1, home, away });
    orch.onUpdate(listener);
    const snap = orch.setTicker(1, "Semi finals starting soon");
    expect(snap.tickerText).toBe("Semi finals starting soon");
    expect(listener).toHaveBeenCalledWith(1, expect.objectContaining({
      tickerText: "Semi finals starting soon",
    }));
    expect(orch.setTicker(1, undefined).tickerText).toBeUndefined();
  });

  it("throws when acting on a court with no match", () => {
    orch.ensureCourt(2);
    expect(() => orch.startMatch(2)).toThrow(/No match assigned/);
    expect(orch.snapshot(2)).toBeUndefined();
  });

  describe("streaming orchestration", () => {
    it("exposes a default streaming snapshot for any court (no match needed)", () => {
      const snap = orch.streamingSnapshot(2);
      expect(snap).toEqual(
        expect.objectContaining({
          courtId: 2,
          youtubeStatus: "idle",
          overlayMode: "score",
          cameraConnected: false,
        }),
      );
    });

    it("suggests a title from match info and falls back without a match", () => {
      expect(orch.suggestTitle(3)).toBe("Court 3");
      orch.createMatch({ courtId: 1, home, away, banner: "U15" });
      expect(orch.suggestTitle(1)).toBe("U15 | A vs B | Court 1");
    });

    it("sets camera connectivity and emits a streaming update", () => {
      const listener = vi.fn();
      orch.onStreamingUpdate(listener);
      const snap = orch.setCameraConnected(1, true);
      expect(snap.cameraConnected).toBe(true);
      expect(listener).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ cameraConnected: true }),
      );
    });

    it("sets overlay mode and title before starting", () => {
      expect(orch.setOverlayMode(1, "match").overlayMode).toBe("match");
      expect(orch.setStreamTitle(1, "  Custom  ").title).toBe("Custom");
    });

    it("runs start -> live -> stop through the orchestrator, emitting each step", () => {
      const listener = vi.fn();
      orch.onStreamingUpdate(listener);

      const started = orch.requestStreamStart(1, {
        title: "Komet | A vs B",
        overlayMode: "full",
      });
      expect(started.youtubeStatus).toBe("starting");
      expect(started.title).toBe("Komet | A vs B");

      const live = orch.confirmStreamLive(1, "yt-1");
      expect(live.youtubeStatus).toBe("live");
      expect(live.broadcastId).toBe("yt-1");

      expect(orch.requestStreamStop(1).youtubeStatus).toBe("stopping");
      expect(orch.confirmStreamStopped(1).youtubeStatus).toBe("idle");
      expect(listener).toHaveBeenCalledTimes(4);
    });

    it("auto-generates the title on start when none is provided", () => {
      orch.createMatch({ courtId: 1, home, away, banner: "Final" });
      const snap = orch.requestStreamStart(1);
      expect(snap.title).toBe("Final | A vs B | Court 1");
    });

    it("supports fail and reset (recovery) flows", () => {
      orch.requestStreamStart(2, { title: "T" });
      const failed = orch.failStream(2, "boom");
      expect(failed.youtubeStatus).toBe("error");
      expect(failed.error).toBe("boom");
      expect(orch.resetStream(2).youtubeStatus).toBe("idle");
    });

    it("can unsubscribe streaming listeners", () => {
      const listener = vi.fn();
      const off = orch.onStreamingUpdate(listener);
      orch.setCameraConnected(1, true);
      const calls = listener.mock.calls.length;
      off();
      orch.setCameraConnected(1, false);
      expect(listener.mock.calls.length).toBe(calls);
    });
  });
});
