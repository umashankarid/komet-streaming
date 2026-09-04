import { describe, expect, it } from "vitest";
import { Score } from "./Score.js";
import { DEFAULT_SCORING, type ScoringConfig, type Side } from "./types.js";

/** Explicit classic 21-point config, independent of the app default. */
const BWF21: ScoringConfig = { pointsToWin: 21, winBy: 2, cap: 30, bestOf: 3 };

/** Helper: add points to reach a target score for one side. */
function rally(score: Score, side: Side, times: number): void {
  for (let i = 0; i < times; i++) score.addPoint(side);
}

describe("default scoring config", () => {
  it("defaults to 15 points, win-by-2, cap 17, best of 3", () => {
    expect(DEFAULT_SCORING).toEqual({
      pointsToWin: 15,
      winBy: 2,
      cap: 17,
      bestOf: 3,
    });
  });

  it("a default game is won at 15 with a 2-point lead", () => {
    const s = new Score(); // uses DEFAULT_SCORING (15)
    rally(s, "away", 5);
    rally(s, "home", 14);
    expect(s.getCurrentGame().winner).toBeUndefined();
    s.addPoint("home"); // 15-5
    expect(s.getCurrentGame().winner).toBe("home");
  });

  it("a default game caps at 17", () => {
    const s = new Score();
    rally(s, "home", 14);
    rally(s, "away", 14);
    for (let i = 15; i <= 16; i++) {
      s.addPoint("home");
      s.addPoint("away");
    }
    expect(s.getCurrentGame()).toMatchObject({ home: 16, away: 16 });
    s.addPoint("home"); // 17-16 -> cap
    expect(s.getCurrentGame()).toMatchObject({ home: 17, away: 16, winner: "home" });
  });
});

describe("Score construction", () => {
  it("starts with one game at 0-0", () => {
    const s = new Score();
    expect(s.getCurrentGame()).toEqual({ home: 0, away: 0 });
    expect(s.currentGameIndex).toBe(0);
    expect(s.getGames()).toHaveLength(1);
  });

  it("computes games needed to win the match", () => {
    expect(new Score({ ...BWF21, bestOf: 3 }).gamesToWinMatch).toBe(2);
    expect(new Score({ ...BWF21, bestOf: 5 }).gamesToWinMatch).toBe(3);
    expect(new Score({ ...BWF21, bestOf: 1 }).gamesToWinMatch).toBe(1);
  });

  it("rejects invalid configs", () => {
    expect(() => new Score({ ...BWF21, pointsToWin: 0 })).toThrow();
    expect(() => new Score({ ...BWF21, winBy: 0 })).toThrow();
    expect(() => new Score({ ...BWF21, cap: 10 })).toThrow();
    expect(() => new Score({ ...BWF21, bestOf: 2 })).toThrow();
    expect(() => new Score({ ...BWF21, bestOf: 0 })).toThrow();
  });
});

describe("Score game-winning rules (explicit 21-point config)", () => {
  it("wins a game at 21 with a 2+ point lead", () => {
    const s = new Score(BWF21);
    rally(s, "away", 10);
    rally(s, "home", 20);
    expect(s.getCurrentGame().winner).toBeUndefined();
    s.addPoint("home"); // 21-10 -> game won
    expect(s.getCurrentGame()).toMatchObject({ home: 21, away: 10, winner: "home" });
    expect(s.gamesWon()).toEqual({ home: 1, away: 0 });
  });

  it("does not win at 21-20 (needs 2-point lead)", () => {
    const s = new Score(BWF21);
    rally(s, "home", 20);
    rally(s, "away", 20);
    s.addPoint("home"); // 21-20
    expect(s.getCurrentGame().winner).toBeUndefined();
    s.addPoint("home"); // 22-20
    expect(s.getCurrentGame().winner).toBe("home");
  });

  it("caps the game at 30 regardless of lead", () => {
    const s = new Score(BWF21);
    rally(s, "home", 20);
    rally(s, "away", 20);
    for (let i = 21; i <= 29; i++) {
      s.addPoint("home");
      s.addPoint("away");
    }
    expect(s.getCurrentGame()).toMatchObject({ home: 29, away: 29 });
    expect(s.getCurrentGame().winner).toBeUndefined();
    s.addPoint("home"); // 30-29 -> cap wins
    expect(s.getCurrentGame()).toMatchObject({ home: 30, away: 29, winner: "home" });
  });
});

describe("Score match flow (best of 3)", () => {
  it("wins the match after 2 games", () => {
    const s = new Score(BWF21);
    rally(s, "home", 21); // game 1 home
    s.startNextGame();
    rally(s, "home", 21); // game 2 home
    expect(s.isMatchOver()).toBe(true);
    expect(s.matchWinner()).toBe("home");
  });

  it("goes to a decider at one game each", () => {
    const s = new Score(BWF21);
    rally(s, "home", 21);
    s.startNextGame();
    rally(s, "away", 21);
    expect(s.isMatchOver()).toBe(false);
    expect(s.matchWinner()).toBeUndefined();
    s.startNextGame();
    expect(s.getGames()).toHaveLength(3);
  });
});

describe("Score guard rails", () => {
  it("throws when scoring after the match is over", () => {
    const s = new Score(BWF21);
    rally(s, "home", 21);
    s.startNextGame();
    rally(s, "home", 21);
    expect(() => s.addPoint("home")).toThrow(/match is already over/);
  });

  it("throws when scoring into a finished game", () => {
    const s = new Score(BWF21);
    rally(s, "home", 21); // game 1 finished, match not over
    expect(() => s.addPoint("home")).toThrow(/game is already finished/);
  });

  it("cannot start next game before current is finished", () => {
    const s = new Score(BWF21);
    rally(s, "home", 5);
    expect(() => s.startNextGame()).toThrow(/not finished/);
  });

  it("cannot start next game once match is over", () => {
    const s = new Score(BWF21);
    rally(s, "home", 21);
    s.startNextGame();
    rally(s, "home", 21);
    expect(() => s.startNextGame()).toThrow(/match is over/);
  });
});

describe("Score corrections", () => {
  it("removes a point and never goes negative", () => {
    const s = new Score(BWF21);
    s.addPoint("home");
    s.removePoint("home");
    s.removePoint("home"); // no-op at 0
    expect(s.getCurrentGame()).toEqual({ home: 0, away: 0 });
  });

  it("undoes a mistaken game win when a point is removed", () => {
    const s = new Score(BWF21);
    rally(s, "home", 20);
    rally(s, "away", 19);
    s.addPoint("home"); // 21-19 -> home wins game
    expect(s.getCurrentGame().winner).toBe("home");
    s.removePoint("home"); // back to 20-19
    expect(s.getCurrentGame().winner).toBeUndefined();
    expect(s.gamesWon()).toEqual({ home: 0, away: 0 });
  });
});
