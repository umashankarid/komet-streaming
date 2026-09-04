import Database from "better-sqlite3";
import cookieSession from "cookie-session";
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthRouter } from "./authRoutes.js";
import { YouTubeAuthService } from "../youtube/YouTubeAuthService.js";
import { YouTubeTokenStore } from "../youtube/YouTubeTokenStore.js";
import type { FetchLike } from "../integrations/YouTubeService.js";

const cfg = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "https://x/auth/youtube/callback",
};

/** A fake fetch scripted for the callback flow: token exchange then channel. */
function scriptedFetch(): FetchLike {
  let n = 0;
  return async (url) => {
    n++;
    if (url.includes("/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "at",
          refresh_token: "1//rt",
          expires_in: 3600,
        }),
        text: async () => "",
      };
    }
    // channel lookup
    return {
      ok: true,
      status: 200,
      json: async () => {
        if (url.includes("/liveStreams")) {
          return { items: [{ id: "s-1", snippet: { title: "Komet Court 1" }, cdn: { resolution: "1080p" } }] };
        }
        return { items: [{ id: "UC1", snippet: { title: "BMK Komet" } }] };
      },
      text: async () => "",
    };
  };
}

function makeApp(opts?: { configured?: boolean; fetchImpl?: FetchLike }) {
  const db = new Database(":memory:");
  const store = new YouTubeTokenStore(db, "key");
  const configured = opts?.configured ?? true;
  const auth = configured
    ? new YouTubeAuthService(cfg, opts?.fetchImpl ?? scriptedFetch())
    : undefined;
  const app: Express = express();
  app.use(express.json());
  app.use(cookieSession({ name: "s", secret: "x" }));
  app.use(
    createAuthRouter(auth, configured ? store : undefined),
  );
  return { app, store, db };
}

describe("auth routes — status & disconnect", () => {
  let ctx: ReturnType<typeof makeApp>;
  beforeEach(() => (ctx = makeApp()));
  afterEach(() => ctx.db.close());

  it("reports disconnected initially", async () => {
    const res = await request(ctx.app).get("/api/youtube/status");
    expect(res.body).toEqual({ connected: false, configured: true });
  });

  it("reports connected after a token is stored", async () => {
    ctx.store.save({
      channelId: "UC1",
      channelTitle: "BMK Komet",
      refreshToken: "1//super-secret-refresh-token",
    });
    const res = await request(ctx.app).get("/api/youtube/status");
    expect(res.body).toMatchObject({ connected: true, channelTitle: "BMK Komet" });
    expect(JSON.stringify(res.body)).not.toContain("super-secret");
    expect(JSON.stringify(res.body)).not.toContain("1//");
  });

  it("disconnects", async () => {
    ctx.store.save({ channelId: "UC1", channelTitle: "BMK Komet", refreshToken: "r1" });
    const res = await request(ctx.app).post("/api/youtube/disconnect");
    expect(res.body).toEqual({ connected: false });
    expect(ctx.store.isConnected()).toBe(false);
  });

  it("lists streams when connected", async () => {
    ctx.store.save({ channelId: "UC1", channelTitle: "BMK Komet", refreshToken: "1//rt" });
    const res = await request(ctx.app).get("/api/youtube/streams");
    expect(res.status).toBe(200);
    expect(res.body.streams).toEqual([
      { streamId: "s-1", title: "Komet Court 1", ingestionType: undefined, resolution: "1080p" },
    ]);
  });

  it("returns 400 for streams when not connected", async () => {
    const res = await request(ctx.app).get("/api/youtube/streams");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not connected/);
  });
});

describe("auth routes — not configured", () => {
  it("status reports not configured", async () => {
    const { app, db } = makeApp({ configured: false });
    const res = await request(app).get("/api/youtube/status");
    expect(res.body).toEqual({ connected: false, configured: false });
    db.close();
  });

  it("initiation returns 503 when not configured", async () => {
    const { app, db } = makeApp({ configured: false });
    const res = await request(app).get("/auth/youtube");
    expect(res.status).toBe(503);
    db.close();
  });
});

describe("auth routes — OAuth flow", () => {
  it("redirects to Google consent and sets a state cookie", async () => {
    const { app, db } = makeApp();
    const res = await request(app).get("/auth/youtube");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("accounts.google.com");
    expect(res.headers.location).toMatch(/state=[a-f0-9]+/);
    expect(res.headers["set-cookie"]).toBeDefined();
    db.close();
  });

  it("completes the callback: exchanges code, stores token, redirects connected", async () => {
    const { app, store, db } = makeApp();
    const agent = request.agent(app);
    // 1) initiate to capture the state in the session cookie
    const init = await agent.get("/auth/youtube");
    const state = new URL(init.headers.location).searchParams.get("state");
    // 2) callback with the same state
    const cb = await agent.get(
      "/auth/youtube/callback?code=the-code&state=" + state,
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe("/control?youtube=connected");
    expect(store.isConnected()).toBe(true);
    expect(store.publicStatus().channelTitle).toBe("BMK Komet");
    db.close();
  });

  it("rejects a callback with a mismatched state", async () => {
    const { app, store, db } = makeApp();
    const agent = request.agent(app);
    await agent.get("/auth/youtube");
    const cb = await agent.get("/auth/youtube/callback?code=c&state=wrong");
    expect(cb.headers.location).toBe("/control?youtube=badstate");
    expect(store.isConnected()).toBe(false);
    db.close();
  });

  it("handles a denied consent", async () => {
    const { app, db } = makeApp();
    const cb = await request(app).get("/auth/youtube/callback?error=access_denied");
    expect(cb.headers.location).toBe("/control?youtube=denied");
    db.close();
  });
});
