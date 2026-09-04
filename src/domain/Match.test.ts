import { describe, expect, it } from "vitest";
import { Match } from "./Match.js";
import type { Team } from "./types.js";

const home: Team = { players: [{ name: "A. Home" }] };
const away: Team = { players: [{ name: "B. Away" }] };

function makeMatch(): Match {
  return new Match({ id: "m1", courtId: 1, home, away });
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

  it("finishes automatically when the match is decided", () => {
    const m = makeMatch();
    m.start();
    score(m, "home", 21);
    m.nextGame();
    score(m, "home", 21);
    expect(m.getStatus()).toBe("finished");
    expect(m.snapshot().matchWinner).toBe("home");
  });

  it("cannot score after finished", () => {
    const m = makeMatch();
    m.start();
    score(m, "home", 21);
    m.nextGame();
    score(m, "home", 21);
    expect(() => m.pointFor("home")).toThrow(/not live/);
  });
});

describe("Match corrections and snapshot", () => {
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
      status: "live",
      home,
      away,
    });
    expect(snap.games).toHaveLength(1);
    expect(snap.gamesWon).toEqual({ home: 0, away: 0 });
  });
});
