import { describe, expect, it } from "vitest";
import {
  CourtStreaming,
  OVERLAY_MODES,
  generateTitle,
  normalizeTitle,
} from "./Streaming.js";
import type { MatchSnapshot } from "./Match.js";

/** Minimal MatchSnapshot factory for title-generation tests. */
function matchSnapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    id: "m1",
    courtId: 1,
    courtName: "Court 1",
    status: "live",
    home: { players: [{ name: "Aadvika" }] },
    away: { players: [{ name: "Emma" }] },
    currentGame: { home: 0, away: 0 },
    games: [],
    gamesWon: { home: 0, away: 0 },
    durationMs: 0,
    ...overrides,
  };
}

describe("normalizeTitle", () => {
  it("trims, collapses whitespace and clamps to 100 chars", () => {
    expect(normalizeTitle("  Komet   2026  ")).toBe("Komet 2026");
    expect(normalizeTitle("x".repeat(150))?.length).toBe(100);
  });

  it("returns undefined for empty/blank/non-string", () => {
    expect(normalizeTitle("")).toBeUndefined();
    expect(normalizeTitle("   ")).toBeUndefined();
    expect(normalizeTitle(undefined)).toBeUndefined();
    expect(normalizeTitle(42 as unknown as string)).toBeUndefined();
  });
});

describe("generateTitle", () => {
  it("falls back to Court N when no match", () => {
    expect(generateTitle(2, undefined)).toBe("Court 2");
  });

  it("builds banner | players | court from a match", () => {
    const snap = matchSnapshot({ banner: "U15 DS" });
    expect(generateTitle(1, snap)).toBe("U15 DS | Aadvika vs Emma | Court 1");
  });

  it("omits banner when absent", () => {
    expect(generateTitle(1, matchSnapshot())).toBe(
      "Aadvika vs Emma | Court 1",
    );
  });

  it("joins doubles players with &", () => {
    const snap = matchSnapshot({
      home: { players: [{ name: "A" }, { name: "B" }] },
      away: { players: [{ name: "C" }, { name: "D" }] },
    });
    expect(generateTitle(1, snap)).toBe("A & B vs C & D | Court 1");
  });

  it("handles a one-sided/empty roster gracefully", () => {
    const snap = matchSnapshot({
      home: { players: [{ name: "Solo" }] },
      away: { players: [] },
    });
    expect(generateTitle(3, snap)).toBe("Solo | Court 3");
  });
});

describe("CourtStreaming", () => {
  it("rejects invalid court ids", () => {
    expect(() => new CourtStreaming(0)).toThrow();
    expect(() => new CourtStreaming(2.5)).toThrow();
  });

  it("starts idle with default overlay mode 'score'", () => {
    const s = new CourtStreaming(1);
    const snap = s.snapshot();
    expect(snap.youtubeStatus).toBe("idle");
    expect(snap.overlayMode).toBe("score");
    expect(snap.cameraConnected).toBe(false);
    expect(snap.durationMs).toBe(0);
    expect(snap.title).toBeUndefined();
  });

  it("tracks camera connectivity independently of stream status", () => {
    const s = new CourtStreaming(1);
    s.setCameraConnected(true);
    expect(s.isCameraConnected()).toBe(true);
    expect(s.snapshot().cameraConnected).toBe(true);
    s.setCameraConnected(false);
    expect(s.isCameraConnected()).toBe(false);
  });

  it("sets overlay mode and title while idle", () => {
    const s = new CourtStreaming(1);
    for (const mode of OVERLAY_MODES) {
      s.setOverlayMode(mode);
      expect(s.snapshot().overlayMode).toBe(mode);
    }
    s.setTitle("  Training | A vs B  ");
    expect(s.snapshot().title).toBe("Training | A vs B");
    s.setTitle("");
    expect(s.snapshot().title).toBeUndefined();
  });

  it("rejects an invalid overlay mode", () => {
    const s = new CourtStreaming(1);
    expect(() => s.setOverlayMode("weird" as never)).toThrow(/Invalid overlay/);
  });

  it("runs the full start -> live -> stop lifecycle with a clock", () => {
    let t = 1000;
    const s = new CourtStreaming(1, () => t);
    s.requestStart({ title: "Match A", overlayMode: "full" });
    expect(s.getStatus()).toBe("starting");
    expect(s.snapshot().overlayMode).toBe("full");

    s.confirmLive("bcast-123");
    expect(s.getStatus()).toBe("live");
    expect(s.snapshot().broadcastId).toBe("bcast-123");
    t = 4000;
    expect(s.durationMs()).toBe(3000);

    s.requestStop();
    expect(s.getStatus()).toBe("stopping");
    s.confirmStopped();
    expect(s.getStatus()).toBe("idle");
    // Broadcast/duration cleared, camera preserved.
    expect(s.snapshot().broadcastId).toBeUndefined();
    expect(s.durationMs()).toBe(0);
  });

  it("requires a title to start", () => {
    const s = new CourtStreaming(1);
    expect(() => s.requestStart({ title: "   " })).toThrow(/title is required/);
  });

  it("rejects an invalid overlay mode passed to requestStart", () => {
    const s = new CourtStreaming(1);
    expect(() =>
      s.requestStart({ title: "ok", overlayMode: "nope" as never }),
    ).toThrow(/Invalid overlay/);
  });

  it("forbids overlay/title changes once starting", () => {
    const s = new CourtStreaming(1);
    s.requestStart({ title: "T" });
    expect(() => s.setOverlayMode("none")).toThrow(/while streaming/);
    expect(() => s.setTitle("new")).toThrow(/while streaming/);
  });

  it("guards illegal transitions", () => {
    const s = new CourtStreaming(1);
    expect(() => s.confirmLive("b")).toThrow(/Cannot go live/);
    expect(() => s.requestStop()).toThrow(/Cannot stop/);
    expect(() => s.confirmStopped()).toThrow(/Cannot finish stopping/);
    s.requestStart({ title: "T" });
    expect(() => s.confirmLive("")).toThrow(/broadcastId is required/);
  });

  it("enters and recovers from error state", () => {
    const s = new CourtStreaming(1);
    s.requestStart({ title: "T" });
    s.confirmLive("b");
    s.fail("YouTube API rejected the broadcast");
    expect(s.getStatus()).toBe("error");
    expect(s.snapshot().error).toMatch(/YouTube API/);
    // From error, can set overlay/title again and restart.
    s.setOverlayMode("match");
    s.requestStart({ title: "Retry" });
    expect(s.getStatus()).toBe("starting");
  });

  it("fail() uses a default reason when none given", () => {
    const s = new CourtStreaming(1);
    s.fail("");
    expect(s.snapshot().error).toBe("Unknown streaming error");
  });

  it("reset() returns to a clean idle state", () => {
    const s = new CourtStreaming(1);
    s.fail("boom");
    s.reset();
    const snap = s.snapshot();
    expect(snap.youtubeStatus).toBe("idle");
    expect(snap.error).toBeUndefined();
    expect(snap.broadcastId).toBeUndefined();
  });

  it("reports zero duration unless live", () => {
    const s = new CourtStreaming(1, () => 5000);
    expect(s.durationMs()).toBe(0);
    s.requestStart({ title: "T" });
    expect(s.durationMs()).toBe(0);
  });
});
