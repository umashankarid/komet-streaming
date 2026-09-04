import { describe, expect, it } from "vitest";
import { Court, CourtService, courtNaming, pad2 } from "./Court.js";
import { Match } from "./Match.js";
import type { Team } from "./types.js";

const home: Team = { players: [{ name: "A" }] };
const away: Team = { players: [{ name: "B" }] };

describe("naming conventions (Rule 5)", () => {
  it("zero-pads court numbers to 2 digits", () => {
    expect(pad2(1)).toBe("01");
    expect(pad2(9)).toBe("09");
    expect(pad2(12)).toBe("12");
  });

  it("derives all source/scene/url names for a court", () => {
    expect(courtNaming(1)).toEqual({
      phoneDevice: "KOMET-CAM-01",
      camSource: "CAM_COURT_01",
      overlaySource: "OVERLAY_COURT_01",
      scene: "COURT_01_LIVE",
      overlayUrl: "/overlay/court/1",
      scoreUrl: "/score/1",
    });
  });
});

describe("Court", () => {
  it("rejects invalid ids", () => {
    expect(() => new Court(0)).toThrow();
    expect(() => new Court(-1)).toThrow();
    expect(() => new Court(2.5)).toThrow();
  });

  it("assigns and clears a match", () => {
    const court = new Court(1);
    const match = new Match({ id: "m", courtId: 1, home, away });
    expect(court.getMatch()).toBeUndefined();
    court.assignMatch(match);
    expect(court.getMatch()).toBe(match);
    court.clearMatch();
    expect(court.getMatch()).toBeUndefined();
  });

  it("rejects a match belonging to another court", () => {
    const court = new Court(1);
    const match = new Match({ id: "m", courtId: 2, home, away });
    expect(() => court.assignMatch(match)).toThrow(/does not match/);
  });
});

describe("CourtService", () => {
  it("pre-creates courts from a count", () => {
    const svc = new CourtService(3);
    expect(svc.listCourts().map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it("adds, gets and checks courts", () => {
    const svc = new CourtService();
    expect(svc.hasCourt(1)).toBe(false);
    const c = svc.addCourt(1);
    expect(c.id).toBe(1);
    expect(svc.getCourt(1)).toBe(c);
    expect(svc.hasCourt(1)).toBe(true);
  });

  it("rejects duplicate courts", () => {
    const svc = new CourtService(1);
    expect(() => svc.addCourt(1)).toThrow(/already exists/);
  });

  it("throws for unknown courts", () => {
    const svc = new CourtService();
    expect(() => svc.getCourt(99)).toThrow(/not found/);
  });

  it("returns courts sorted by id", () => {
    const svc = new CourtService();
    svc.addCourt(3);
    svc.addCourt(1);
    svc.addCourt(2);
    expect(svc.listCourts().map((c) => c.id)).toEqual([1, 2, 3]);
  });
});
