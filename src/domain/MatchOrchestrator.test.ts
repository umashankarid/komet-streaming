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
    for (let i = 0; i < 21; i++) orch.point(1, "home"); // game 1 to home
    orch.nextGame(1);
    expect(orch.snapshot(1)?.games).toHaveLength(2);
  });

  it("throws when acting on a court with no match", () => {
    orch.ensureCourt(2);
    expect(() => orch.startMatch(2)).toThrow(/No match assigned/);
    expect(orch.snapshot(2)).toBeUndefined();
  });
});
