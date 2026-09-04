import { describe, expect, it } from "vitest";
import { Match } from "./Match.js";
import type { ScoringConfig, Team } from "./types.js";

const home: Team = { players: [{ name: "A. Home" }] };
const away: Team = { players: [{ name: "B. Away" }] };
const BWF21: ScoringConfig = { pointsToWin: 21, winBy: 2, cap: 30, bestOf: 3 };

function makeMatch(overrides: Partial<{ scoring: ScoringConfig }> = {}): Match {
  return new Match({ id: "m1", courtId: 1, home, away, ...overrides });
}

function score(m: Match, side: "home" | "away", n: number): void {
  for (let i = 0; i < n; i++) m.pointFor(side);
}

describe("Match construction", () => {
  it("validates id and courtId", () => {
    expect(() => new Match({ id: "", courtId: 1, home, away })).toThrow();
    expect(() => new Match({ id: "m", courtId: 0, home, away })).toThrow();
    expect(() => new Match({ id: "m", courtId: 1.5, home, away })).toThrow();
  });

  it("starts scheduled", () => {
    expect(makeMatch().getStatus()).toBe("scheduled");
  });

  it("defaults court name to 'Court N' and allows a custom label", () => {
    expect(makeMatch().snapshot().courtName).toBe("Court 1");
    const named = new Match({
      id: "m",
      courtId: 2,
      home,
      away,
      courtName: "Center Court",
    });
    expect(named.snapshot().courtName).toBe("Center Court");
  });

  it("supports an optional banner and ticker text", () => {
    const m = new Match({
      id: "m",
      courtId: 1,
      home,
      away,
      banner: "Semi Final",
      tickerText: "Welcome to BMK Komet",
    });
    const snap = m.snapshot();
    expect(snap.banner).toBe("Semi Final");
    expect(snap.tickerText).toBe("Welcome to BMK Komet");
  });
});

describe("Match lifecycle", () => {
  it("transitions scheduled -> live on start", () => {
    const m = makeMatch();
    m.start();
    expect(m.getStatus()).toBe("live");
  });

  it("cannot start twice", () => {
    const m = makeMatch();
    m.start();
    expect(() => m.start()).toThrow();
  });

  it("cannot score before start", () => {
    const m = makeMatch();
    expect(() => m.pointFor("home")).toThrow(/not live/);
  });

  it("finishes automatically when the match is decided (default 15)", () => {
    const m = makeMatch();
    m.start();
    score(m, "home", 15);
    m.nextGame();
    score(m, "home", 15);
    expect(m.getStatus()).toBe("finished");
    expect(m.snapshot().matchWinner).toBe("home");
  });

  it("cannot score after finished", () => {
    const m = makeMatch({ scoring: BWF21 });
    m.start();
    score(m, "home", 21);
    m.nextGame();
    score(m, "home", 21);
    expect(() => m.pointFor("home")).toThrow(/not live/);
  });
});

describe("Match duration timer", () => {
  it("is zero before start", () => {
    expect(makeMatch().snapshot().durationMs).toBe(0);
  });

  it("tracks elapsed time from start using an injectable clock", () => {
    let t = 1000;
    const m = new Match({ id: "m", courtId: 1, home, away, clock: () => t });
    m.start(); // startedAt = 1000
    t = 61000; // 60s later
    const snap = m.snapshot();
    expect(snap.startedAt).toBe(1000);
    expect(snap.durationMs).toBe(60000);
    expect(snap.finishedAt).toBeUndefined();
  });

  it("freezes duration once the match finishes", () => {
    let t = 0;
    const m = new Match({
      id: "m",
      courtId: 1,
      home,
      away,
      clock: () => t,
    });
    m.start();
    t = 5000;
    score(m, "home", 15); // game 1
    m.nextGame();
    score(m, "home", 15); // match over at t=5000
    t = 999999; // clock keeps moving
    const snap = m.snapshot();
    expect(snap.finishedAt).toBe(5000);
    expect(snap.durationMs).toBe(5000); // frozen, not 999999
  });
});

describe("Match ticker + corrections + snapshot", () => {
  it("sets and clears ticker text", () => {
    const m = makeMatch();
    m.setTicker("Next: Final at 15:00");
    expect(m.snapshot().tickerText).toBe("Next: Final at 15:00");
    m.setTicker("   ");
    expect(m.snapshot().tickerText).toBeUndefined();
    m.setTicker(undefined);
    expect(m.snapshot().tickerText).toBeUndefined();
  });

  it("supports point corrections while live", () => {
    const m = makeMatch();
    m.start();
    m.pointFor("home");
    m.pointFor("home");
    m.correctPoint("home");
    expect(m.snapshot().currentGame).toEqual({ home: 1, away: 0 });
  });

  it("exposes a full snapshot for overlays", () => {
    const m = makeMatch();
    m.start();
    m.pointFor("home");
    const snap = m.snapshot();
    expect(snap).toMatchObject({
      id: "m1",
      courtId: 1,
      courtName: "Court 1",
      status: "live",
      home,
      away,
    });
    expect(snap.games).toHaveLength(1);
    expect(snap.gamesWon).toEqual({ home: 0, away: 0 });
  });
});
