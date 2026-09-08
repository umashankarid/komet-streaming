import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import { createLiveScoreRouter } from "./liveScoreRoutes.js";

const teams = {
  home: { players: [{ name: "A" }] },
  away: { players: [{ name: "B" }] },
};

function makeApp(orch: MatchOrchestrator): Express {
  const app = express();
  app.use(express.json());
  app.use(createLiveScoreRouter(orch));
  return app;
}

describe("score-link (fixed per-court, live-gated) routes", () => {
  let orch: MatchOrchestrator;
  let app: Express;

  beforeEach(() => {
    orch = new MatchOrchestrator();
    app = makeApp(orch);
  });

  it("serves the scorer page shell at /score-link/courtN", async () => {
    const res = await request(app).get("/score-link/court1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Komet Scorer");
  });

  it("reports inactive when there is no match", async () => {
    const res = await request(app).get("/score-link/court1/state");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: false, match: null });
  });

  it("reports inactive when a match exists but is not started", async () => {
    orch.createMatch({ courtId: 1, ...teams });
    const res = await request(app).get("/score-link/court1/state");
    expect(res.body.active).toBe(false);
    expect(res.body.match.status).toBe("scheduled");
  });

  it("rejects scoring while inactive (no live match)", async () => {
    orch.createMatch({ courtId: 1, ...teams }); // not started
    const res = await request(app).post("/score-link/court1/point").send({ side: "home" });
    expect(res.status).toBe(409);
    expect(res.body.active).toBe(false);
  });

  it("becomes active once the match is live and accepts scoring", async () => {
    orch.createMatch({
      courtId: 1,
      ...teams,
      scoring: { pointsToWin: 11, winBy: 2, cap: 15, bestOf: 3 },
    });
    orch.startMatch(1);
    const state = await request(app).get("/score-link/court1/state");
    expect(state.body.active).toBe(true);

    const p = await request(app).post("/score-link/court1/point").send({ side: "home" });
    expect(p.status).toBe(200);
    expect(p.body.currentGame.home).toBe(1);

    const c = await request(app).post("/score-link/court1/correct").send({ side: "home" });
    expect(c.body.currentGame.home).toBe(0);
  });

  it("auto-advances sets on the scorer link", async () => {
    orch.createMatch({
      courtId: 1,
      ...teams,
      scoring: { pointsToWin: 11, winBy: 2, cap: 15, bestOf: 3 },
    });
    orch.startMatch(1);
    for (let i = 0; i < 11; i++) {
      await request(app).post("/score-link/court1/point").send({ side: "home" });
    }
    const state = await request(app).get("/score-link/court1/state");
    expect(state.body.match.gamesWon.home).toBe(1);
    expect(state.body.match.currentGame).toEqual({ home: 0, away: 0 });
  });

  it("rejects an invalid side while active", async () => {
    orch.createMatch({ courtId: 1, ...teams });
    orch.startMatch(1);
    const res = await request(app).post("/score-link/court1/point").send({ side: "x" });
    expect(res.status).toBe(400);
  });

  it("validates the court number", async () => {
    const res = await request(app).get("/score-link/court0/state");
    expect(res.status).toBe(400);
  });
});
