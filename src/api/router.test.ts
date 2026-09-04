import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import { createApiRouter } from "./router.js";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", createApiRouter(new MatchOrchestrator()));
  return app;
}

const teams = {
  home: { players: [{ name: "A. Home" }] },
  away: { players: [{ name: "B. Away" }] },
};

describe("REST API", () => {
  let app: Express;
  beforeEach(() => {
    app = makeApp();
  });

  it("lists courts (empty initially)", async () => {
    const res = await request(app).get("/api/courts");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("creates a match and returns 201", async () => {
    const res = await request(app).post("/api/courts/1/match").send(teams);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ courtId: 1, status: "scheduled" });
  });

  it("validates the court id", async () => {
    const res = await request(app).post("/api/courts/0/match").send(teams);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/courtId/);
  });

  it("validates teams", async () => {
    const res = await request(app)
      .post("/api/courts/1/match")
      .send({ home: { players: [] }, away: teams.away });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/home/);
  });

  it("runs a scoring flow via the API", async () => {
    await request(app).post("/api/courts/1/match").send(teams);
    await request(app).post("/api/courts/1/match/start");
    const point = await request(app)
      .post("/api/courts/1/match/point")
      .send({ side: "home" });
    expect(point.status).toBe(200);
    expect(point.body.currentGame).toEqual({ home: 1, away: 0 });

    const correct = await request(app)
      .post("/api/courts/1/match/correct")
      .send({ side: "home" });
    expect(correct.body.currentGame).toEqual({ home: 0, away: 0 });
  });

  it("rejects an invalid side", async () => {
    await request(app).post("/api/courts/1/match").send(teams);
    await request(app).post("/api/courts/1/match/start");
    const res = await request(app)
      .post("/api/courts/1/match/point")
      .send({ side: "sideways" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/side must be/);
  });

  it("advances to the next game", async () => {
    await request(app).post("/api/courts/1/match").send(teams);
    await request(app).post("/api/courts/1/match/start");
    for (let i = 0; i < 15; i++) {
      await request(app).post("/api/courts/1/match/point").send({ side: "home" });
    }
    const res = await request(app).post("/api/courts/1/match/next-game");
    expect(res.status).toBe(200);
    expect(res.body.games).toHaveLength(2);
  });

  it("returns 404 for a court with no match", async () => {
    const res = await request(app).get("/api/courts/3/match");
    expect(res.status).toBe(404);
  });

  it("returns the current match snapshot", async () => {
    await request(app).post("/api/courts/2/match").send(teams);
    const res = await request(app).get("/api/courts/2/match");
    expect(res.status).toBe(200);
    expect(res.body.courtId).toBe(2);
  });

  it("accepts custom scoring, court name and banner", async () => {
    const res = await request(app)
      .post("/api/courts/1/match")
      .send({
        ...teams,
        courtName: "Center Court",
        banner: "Final",
        scoring: { pointsToWin: 11, cap: 15, bestOf: 1 },
      });
    expect(res.status).toBe(201);
    expect(res.body.courtName).toBe("Center Court");
    expect(res.body.banner).toBe("Final");
  });

  it("rejects invalid scoring config", async () => {
    const bad = await request(app)
      .post("/api/courts/1/match")
      .send({ ...teams, scoring: { pointsToWin: 15, cap: 10 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/cap/);

    const evenBestOf = await request(app)
      .post("/api/courts/1/match")
      .send({ ...teams, scoring: { bestOf: 2 } });
    expect(evenBestOf.status).toBe(400);
    expect(evenBestOf.body.error).toMatch(/bestOf/);
  });

  it("sets ticker text via the ticker route", async () => {
    await request(app).post("/api/courts/1/match").send(teams);
    const res = await request(app)
      .post("/api/courts/1/match/ticker")
      .send({ text: "Semi Final coming up" });
    expect(res.status).toBe(200);
    expect(res.body.tickerText).toBe("Semi Final coming up");
  });
});
