import Database from "better-sqlite3";
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import { createLiveScoreRouter } from "./liveScoreRoutes.js";
import { ScorerTokenStore } from "./ScorerTokenStore.js";

const teams = {
  home: { players: [{ name: "A" }] },
  away: { players: [{ name: "B" }] },
};

describe("livescore (token-gated scorer) routes", () => {
  let db: Database.Database;
  let orch: MatchOrchestrator;
  let tokens: ScorerTokenStore;
  let app: Express;
  let token: string;

  beforeEach(() => {
    db = new Database(":memory:");
    orch = new MatchOrchestrator();
    tokens = new ScorerTokenStore(db);
    app = express();
    app.use(express.json());
    app.use(createLiveScoreRouter(orch, tokens));
    // A started match on court 1 with an issued scorer token.
    orch.createMatch({
      courtId: 1,
      ...teams,
      scoring: { pointsToWin: 11, winBy: 2, cap: 15, bestOf: 3 },
    });
    orch.startMatch(1);
    token = tokens.ensure(1);
  });
  afterEach(() => db.close());

  it("rejects scoring without a token", async () => {
    const res = await request(app).post("/livescore/1/point").send({ side: "home" });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const res = await request(app)
      .post("/livescore/1/point?token=nope")
      .send({ side: "home" });
    expect(res.status).toBe(401);
  });

  it("rejects a valid token for a different court", async () => {
    // token is for court 1; try to use it on court 2
    const res = await request(app)
      .post("/livescore/2/point?token=" + token)
      .send({ side: "home" });
    expect(res.status).toBe(401);
  });

  it("scores +1 with a valid token (query or header)", async () => {
    const q = await request(app)
      .post("/livescore/1/point?token=" + token)
      .send({ side: "home" });
    expect(q.status).toBe(200);
    expect(q.body.currentGame.home).toBe(1);

    const h = await request(app)
      .post("/livescore/1/point")
      .set("X-Scorer-Token", token)
      .send({ side: "away" });
    expect(h.status).toBe(200);
    expect(h.body.currentGame.away).toBe(1);
  });

  it("corrects (-1) with a valid token", async () => {
    await request(app).post("/livescore/1/point?token=" + token).send({ side: "home" });
    const res = await request(app)
      .post("/livescore/1/correct?token=" + token)
      .send({ side: "home" });
    expect(res.status).toBe(200);
    expect(res.body.currentGame.home).toBe(0);
  });

  it("auto-advances to the next game when a game is won", async () => {
    for (let i = 0; i < 11; i++) {
      await request(app).post("/livescore/1/point?token=" + token).send({ side: "home" });
    }
    const state = await request(app).get("/livescore/1/state?token=" + token);
    expect(state.body.gamesWon.home).toBe(1);
    expect(state.body.currentGame).toEqual({ home: 0, away: 0 });
    expect(state.body.status).toBe("live");
  });

  it("returns state with a valid token", async () => {
    const res = await request(app).get("/livescore/1/state?token=" + token);
    expect(res.status).toBe(200);
    expect(res.body.courtId).toBe(1);
  });

  it("rejects an invalid side", async () => {
    const res = await request(app)
      .post("/livescore/1/point?token=" + token)
      .send({ side: "middle" });
    expect(res.status).toBe(400);
  });

  it("serves the scorer page shell without a token", async () => {
    const res = await request(app).get("/livescore/1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Komet Scorer");
  });
});
