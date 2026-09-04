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

  describe("streaming routes", () => {
    it("returns default streaming state for a court", async () => {
      const res = await request(app).get("/api/courts/2/streaming");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        courtId: 2,
        youtubeStatus: "idle",
        overlayMode: "score",
        cameraConnected: false,
      });
    });

    it("suggests a title (court fallback and from match)", async () => {
      const fallback = await request(app).get("/api/courts/3/streaming/suggest-title");
      expect(fallback.body).toEqual({ courtId: 3, title: "Court 3" });

      await request(app)
        .post("/api/courts/1/match")
        .send({ ...teams, banner: "U15" });
      const fromMatch = await request(app).get("/api/courts/1/streaming/suggest-title");
      expect(fromMatch.body.title).toBe("U15 | A. Home vs B. Away | Court 1");
    });

    it("sets title and overlay mode before starting", async () => {
      const title = await request(app)
        .post("/api/courts/1/streaming/title")
        .send({ title: "  Training | A vs B  " });
      expect(title.status).toBe(200);
      expect(title.body.title).toBe("Training | A vs B");

      const overlay = await request(app)
        .post("/api/courts/1/streaming/overlay")
        .send({ overlayMode: "match" });
      expect(overlay.body.overlayMode).toBe("match");
    });

    it("rejects an invalid overlay mode", async () => {
      const res = await request(app)
        .post("/api/courts/1/streaming/overlay")
        .send({ overlayMode: "rainbow" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/overlayMode must be/);
    });

    it("reports camera connectivity", async () => {
      const res = await request(app)
        .post("/api/courts/1/streaming/camera")
        .send({ connected: true });
      expect(res.body.cameraConnected).toBe(true);
    });

    it("runs the full start -> live -> stop -> stopped flow", async () => {
      // With the no-op YouTube fallback, /start creates a placeholder
      // broadcast and transitions straight to live in one call.
      const start = await request(app)
        .post("/api/courts/1/streaming/start")
        .send({ title: "Komet | A vs B", overlayMode: "full" });
      expect(start.status).toBe(200);
      expect(start.body.youtubeStatus).toBe("live");
      expect(start.body.title).toBe("Komet | A vs B");
      expect(start.body.overlayMode).toBe("full");
      expect(start.body.broadcastId).toMatch(/^noop-/);

      const stop = await request(app).post("/api/courts/1/streaming/stop");
      expect(stop.status).toBe(200);
      expect(stop.body.youtubeStatus).toBe("idle");
    });

    it("auto-generates the title on start when omitted", async () => {
      await request(app)
        .post("/api/courts/2/match")
        .send({ ...teams, banner: "Final" });
      const start = await request(app).post("/api/courts/2/streaming/start").send({});
      expect(start.body.youtubeStatus).toBe("live");
      expect(start.body.title).toBe("Final | A. Home vs B. Away | Court 2");
    });

    it("rejects going live before starting", async () => {
      const res = await request(app)
        .post("/api/courts/1/streaming/live")
        .send({ broadcastId: "x" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Cannot go live/);
    });

    it("supports fail and reset recovery", async () => {
      await request(app).post("/api/courts/1/streaming/start").send({ title: "T" });
      const failed = await request(app)
        .post("/api/courts/1/streaming/fail")
        .send({ reason: "boom" });
      expect(failed.body.youtubeStatus).toBe("error");
      expect(failed.body.error).toBe("boom");
      const reset = await request(app).post("/api/courts/1/streaming/reset");
      expect(reset.body.youtubeStatus).toBe("idle");
    });

    it("includes streaming state in the courts list", async () => {
      await request(app).post("/api/courts/1/streaming/camera").send({ connected: true });
      const res = await request(app).get("/api/courts");
      const court1 = res.body.find((c: { id: number }) => c.id === 1);
      expect(court1.streaming).toMatchObject({ courtId: 1, cameraConnected: true });
    });
  });
});

describe("streaming routes with a YouTube service", () => {
  function appWith(youtube: import("../integrations/YouTubeService.js").YouTubeService) {
    const a = express();
    a.use(express.json());
    a.use("/api", createApiRouter(new MatchOrchestrator(), youtube));
    return a;
  }

  it("creates a real broadcast and returns live with its id", async () => {
    const calls: string[] = [];
    const youtube = {
      enabled: true,
      async createBroadcast(p: { title: string }) {
        calls.push("create:" + p.title);
        return { broadcastId: "yt-777", watchUrl: "u" };
      },
      async transitionToLive(id: string) {
        calls.push("live:" + id);
      },
      async completeBroadcast(id: string) {
        calls.push("complete:" + id);
      },
    };
    const app = appWith(youtube);
    const start = await request(app)
      .post("/api/courts/1/streaming/start")
      .send({ title: "Komet Final" });
    expect(start.status).toBe(200);
    expect(start.body.youtubeStatus).toBe("live");
    expect(start.body.broadcastId).toBe("yt-777");
    expect(calls).toEqual(["create:Komet Final", "live:yt-777"]);

    const stop = await request(app).post("/api/courts/1/streaming/stop");
    expect(stop.status).toBe(200);
    expect(stop.body.youtubeStatus).toBe("idle");
    expect(calls).toContain("complete:yt-777");
  });

  it("marks the stream errored and returns 502 when YouTube start fails", async () => {
    const youtube = {
      enabled: true,
      async createBroadcast() {
        throw new Error("quotaExceeded");
      },
      async transitionToLive() {},
      async completeBroadcast() {},
    };
    const app = appWith(youtube);
    const start = await request(app)
      .post("/api/courts/1/streaming/start")
      .send({ title: "T" });
    expect(start.status).toBe(502);
    expect(start.body.error).toMatch(/quotaExceeded/);
    expect(start.body.streaming.youtubeStatus).toBe("error");
  });
});

describe("streaming routes with a media gateway", () => {
  function appWith(
    youtube: import("../integrations/YouTubeService.js").YouTubeService,
    gateway: import("../streaming/MediaGatewayClient.js").MediaGateway,
  ) {
    const a = express();
    a.use(express.json());
    a.use("/api", createApiRouter(new MatchOrchestrator(), youtube, gateway));
    return a;
  }

  const youtube = {
    enabled: true,
    async createBroadcast() {
      return { broadcastId: "yt-1", rtmpUrl: "rtmp://a.rtmp.youtube.com/live2/key-1" };
    },
    async transitionToLive() {},
    async completeBroadcast() {},
  };

  it("tells the gateway to start the court with the broadcast rtmp url", async () => {
    const calls: string[] = [];
    const gateway = {
      enabled: true,
      async startCourt(courtId: number, rtmpUrl: string) {
        calls.push(`start:${courtId}:${rtmpUrl}`);
        return { ok: true, courtId };
      },
      async stopCourt(courtId: number) {
        calls.push(`stop:${courtId}`);
        return { ok: true, stopped: true };
      },
    };
    const app = appWith(youtube, gateway);
    const start = await request(app)
      .post("/api/courts/1/streaming/start")
      .send({ title: "T" });
    expect(start.status).toBe(200);
    expect(start.body.youtubeStatus).toBe("live");
    expect(calls).toContain("start:1:rtmp://a.rtmp.youtube.com/live2/key-1");

    const stop = await request(app).post("/api/courts/1/streaming/stop");
    expect(stop.status).toBe(200);
    expect(calls).toContain("stop:1");
  });

  it("does not call a disabled gateway", async () => {
    let called = false;
    const gateway = {
      enabled: false,
      async startCourt(courtId: number) {
        called = true;
        return { ok: true, courtId };
      },
      async stopCourt() {
        called = true;
        return { ok: true };
      },
    };
    const app = appWith(youtube, gateway);
    await request(app).post("/api/courts/1/streaming/start").send({ title: "T" });
    expect(called).toBe(false);
  });
});
