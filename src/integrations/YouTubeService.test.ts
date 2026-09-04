import { describe, expect, it, vi } from "vitest";
import {
  NoopYouTubeService,
  YouTubeApiService,
  type FetchLike,
  youTubeServiceFromEnv,
} from "./YouTubeService.js";

const fullEnv = {
  YOUTUBE_CLIENT_ID: "cid",
  YOUTUBE_CLIENT_SECRET: "secret",
  YOUTUBE_REFRESH_TOKEN: "refresh",
  YOUTUBE_STREAM_ID: "stream-1",
};

/** Build a fake fetch that records calls and returns queued JSON responses. */
function fakeFetch(handlers: Array<(url: string, init?: unknown) => unknown>) {
  const calls: Array<{ url: string; init?: unknown }> = [];
  let i = 0;
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const payload = handlers[Math.min(i, handlers.length - 1)](url, init);
    i++;
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  return { fn, calls };
}

describe("youTubeServiceFromEnv", () => {
  it("returns the no-op service when credentials are missing", () => {
    const svc = youTubeServiceFromEnv({});
    expect(svc.enabled).toBe(false);
    expect(svc).toBeInstanceOf(NoopYouTubeService);
  });

  it("returns the no-op service when only some vars are set", () => {
    const svc = youTubeServiceFromEnv({ YOUTUBE_CLIENT_ID: "x" });
    expect(svc.enabled).toBe(false);
  });

  it("returns the real API service when all vars are present", () => {
    const svc = youTubeServiceFromEnv(fullEnv, (async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
    })) as FetchLike);
    expect(svc.enabled).toBe(true);
    expect(svc).toBeInstanceOf(YouTubeApiService);
  });
});

describe("NoopYouTubeService", () => {
  it("creates a placeholder broadcast and no-ops transitions", async () => {
    const svc = new NoopYouTubeService();
    const handle = await svc.createBroadcast({ title: "T" });
    expect(handle.broadcastId).toMatch(/^noop-/);
    await expect(svc.transitionToLive()).resolves.toBeUndefined();
    await expect(svc.completeBroadcast()).resolves.toBeUndefined();
  });
});

describe("YouTubeApiService", () => {
  it("refreshes a token, creates and binds a broadcast", async () => {
    const { fn, calls } = fakeFetch([
      // 1) token
      () => ({ access_token: "tok-1", expires_in: 3600 }),
      // 2) create broadcast
      () => ({ id: "bcast-1" }),
      // 3) bind
      () => ({ id: "bcast-1" }),
    ]);
    const svc = new YouTubeApiService(
      { clientId: "c", clientSecret: "s", refreshToken: "r", streamId: "stream-9" },
      fn,
    );
    const handle = await svc.createBroadcast({ title: "Komet | A vs B" });
    expect(handle.broadcastId).toBe("bcast-1");
    expect(handle.watchUrl).toBe("https://www.youtube.com/watch?v=bcast-1");

    // token, create, bind
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toContain("oauth2.googleapis.com/token");
    expect(calls[1].url).toContain("/liveBroadcasts?part=");
    const createBody = JSON.parse((calls[1].init as { body: string }).body);
    expect(createBody.snippet.title).toBe("Komet | A vs B");
    expect(createBody.status.privacyStatus).toBe("unlisted");
    expect(calls[2].url).toContain("/liveBroadcasts/bind");
    expect(calls[2].url).toContain("streamId=stream-9");
  });

  it("caches the access token across calls", async () => {
    const { fn, calls } = fakeFetch([
      () => ({ access_token: "tok", expires_in: 3600 }),
      () => ({ id: "b" }),
      () => ({ id: "b" }),
      () => ({}),
    ]);
    const svc = new YouTubeApiService(
      { clientId: "c", clientSecret: "s", refreshToken: "r", streamId: "s9" },
      fn,
    );
    await svc.createBroadcast({ title: "T" });
    await svc.transitionToLive("b");
    // Only ONE token call despite multiple API calls.
    const tokenCalls = calls.filter((c) => c.url.includes("/token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("transitions to live and completes with the right status params", async () => {
    const { fn, calls } = fakeFetch([
      () => ({ access_token: "tok", expires_in: 3600 }),
      () => ({}),
      () => ({}),
    ]);
    const svc = new YouTubeApiService(
      { clientId: "c", clientSecret: "s", refreshToken: "r", streamId: "s9" },
      fn,
    );
    await svc.transitionToLive("bcast-7");
    await svc.completeBroadcast("bcast-7");
    const live = calls.find((c) => c.url.includes("broadcastStatus=live"));
    const complete = calls.find((c) => c.url.includes("broadcastStatus=complete"));
    expect(live?.url).toContain("id=bcast-7");
    expect(complete?.url).toContain("id=bcast-7");
  });

  it("honours a configured default privacy", async () => {
    const { fn, calls } = fakeFetch([
      () => ({ access_token: "tok", expires_in: 3600 }),
      () => ({ id: "b" }),
      () => ({ id: "b" }),
    ]);
    const svc = new YouTubeApiService(
      {
        clientId: "c",
        clientSecret: "s",
        refreshToken: "r",
        streamId: "s9",
        privacy: "public",
      },
      fn,
    );
    await svc.createBroadcast({ title: "T" });
    const createBody = JSON.parse((calls[1].init as { body: string }).body);
    expect(createBody.status.privacyStatus).toBe("public");
  });

  it("throws a helpful error when the token refresh fails", async () => {
    const fn: FetchLike = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "invalid_grant",
    });
    const svc = new YouTubeApiService(
      { clientId: "c", clientSecret: "s", refreshToken: "bad", streamId: "s9" },
      fn,
    );
    await expect(svc.createBroadcast({ title: "T" })).rejects.toThrow(
      /token refresh failed/,
    );
  });

  it("throws when an API call fails", async () => {
    let n = 0;
    const fn: FetchLike = async () => {
      n++;
      if (n === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "tok", expires_in: 3600 }),
          text: async () => "",
        };
      }
      return {
        ok: false,
        status: 403,
        json: async () => ({}),
        text: async () => "quotaExceeded",
      };
    };
    const svc = new YouTubeApiService(
      { clientId: "c", clientSecret: "s", refreshToken: "r", streamId: "s9" },
      fn,
    );
    await expect(svc.createBroadcast({ title: "T" })).rejects.toThrow(
      /YouTube API POST .* failed \(403\)/,
    );
  });

  it("resolves the refresh token from a provider (dynamic store)", async () => {
    let token: string | undefined = "1//from-store";
    const { fn, calls } = fakeFetch([
      () => ({ access_token: "tok", expires_in: 3600 }),
      () => ({ id: "b" }),
      () => ({ id: "b" }),
    ]);
    const svc = new YouTubeApiService(
      { clientId: "c", clientSecret: "s", refreshToken: () => token, streamId: "s9" },
      fn,
    );
    await svc.createBroadcast({ title: "T" });
    expect((calls[0].init as { body: string }).body).toContain("refresh_token=1%2F%2Ffrom-store");
  });

  it("throws when the token provider yields nothing (not connected)", async () => {
    const { fn } = fakeFetch([() => ({})]);
    const svc = new YouTubeApiService(
      { clientId: "c", clientSecret: "s", refreshToken: () => undefined, streamId: "s9" },
      fn,
    );
    await expect(svc.createBroadcast({ title: "T" })).rejects.toThrow(
      /not connected/,
    );
  });
});
