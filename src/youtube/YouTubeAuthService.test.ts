import { describe, expect, it } from "vitest";
import { YouTubeAuthService } from "./YouTubeAuthService.js";
import type { FetchLike } from "../integrations/YouTubeService.js";

const cfg = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "https://stream.bmkkomet.se/auth/youtube/callback",
};

function fetchReturning(payload: unknown, ok = true, status = 200): {
  fn: FetchLike;
  calls: Array<{ url: string; init?: unknown }>;
} {
  const calls: Array<{ url: string; init?: unknown }> = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  return { fn, calls };
}

describe("YouTubeAuthService", () => {
  it("builds a consent URL with offline access and forced consent", () => {
    const svc = new YouTubeAuthService(cfg, (async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
    })) as FetchLike);
    const url = svc.buildConsentUrl("state-xyz");
    expect(url).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain("state=state-xyz");
    expect(url).toContain(
      encodeURIComponent("https://www.googleapis.com/auth/youtube"),
    );
    expect(url).toContain(
      encodeURIComponent("https://stream.bmkkomet.se/auth/youtube/callback"),
    );
  });

  it("exchanges an authorization code for tokens", async () => {
    const { fn, calls } = fetchReturning({
      access_token: "at-1",
      refresh_token: "1//rt-1",
      expires_in: 3600,
    });
    const svc = new YouTubeAuthService(cfg, fn);
    const res = await svc.exchangeCode("auth-code");
    expect(res.accessToken).toBe("at-1");
    expect(res.refreshToken).toBe("1//rt-1");
    expect(res.expiresIn).toBe(3600);
    expect(calls[0].url).toContain("oauth2.googleapis.com/token");
    expect((calls[0].init as { body: string }).body).toContain("grant_type=authorization_code");
  });

  it("throws a helpful error when the code exchange fails", async () => {
    const { fn } = fetchReturning({ error: "invalid_grant" }, false, 400);
    const svc = new YouTubeAuthService(cfg, fn);
    await expect(svc.exchangeCode("bad")).rejects.toThrow(/code exchange failed/);
  });

  it("refreshes an access token", async () => {
    const { fn, calls } = fetchReturning({ access_token: "at-2", expires_in: 3600 });
    const svc = new YouTubeAuthService(cfg, fn);
    const res = await svc.refreshAccessToken("1//rt-1");
    expect(res.accessToken).toBe("at-2");
    expect((calls[0].init as { body: string }).body).toContain("grant_type=refresh_token");
  });

  it("throws when refresh fails", async () => {
    const { fn } = fetchReturning({}, false, 401);
    const svc = new YouTubeAuthService(cfg, fn);
    await expect(svc.refreshAccessToken("bad")).rejects.toThrow(/token refresh failed/);
  });

  it("fetches channel info", async () => {
    const { fn, calls } = fetchReturning({
      items: [{ id: "UC999", snippet: { title: "BMK Komet" } }],
    });
    const svc = new YouTubeAuthService(cfg, fn);
    const info = await svc.fetchChannelInfo("at-1");
    expect(info).toEqual({ channelId: "UC999", channelTitle: "BMK Komet" });
    expect(calls[0].url).toContain("/youtube/v3/channels");
    expect((calls[0].init as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer at-1",
    );
  });

  it("throws when no channel is returned", async () => {
    const { fn } = fetchReturning({ items: [] });
    const svc = new YouTubeAuthService(cfg, fn);
    await expect(svc.fetchChannelInfo("at-1")).rejects.toThrow(/No YouTube channel/);
  });

  it("defaults the channel title when snippet has none", async () => {
    const { fn } = fetchReturning({ items: [{ id: "UC1" }] });
    const svc = new YouTubeAuthService(cfg, fn);
    const info = await svc.fetchChannelInfo("at-1");
    expect(info.channelTitle).toBe("YouTube channel");
  });

  it("lists reusable live streams", async () => {
    const { fn, calls } = fetchReturning({
      items: [
        { id: "s-1", snippet: { title: "Komet Court 1" }, cdn: { resolution: "1080p" } },
        { id: "s-2", snippet: { title: "Komet Court 2" }, cdn: {} },
      ],
    });
    const svc = new YouTubeAuthService(cfg, fn);
    const streams = await svc.listLiveStreams("at-1");
    expect(streams).toEqual([
      { streamId: "s-1", title: "Komet Court 1", ingestionType: undefined, resolution: "1080p" },
      { streamId: "s-2", title: "Komet Court 2", ingestionType: undefined, resolution: undefined },
    ]);
    expect(calls[0].url).toContain("/liveStreams");
  });

  it("returns an empty list when there are no streams", async () => {
    const { fn } = fetchReturning({});
    const svc = new YouTubeAuthService(cfg, fn);
    expect(await svc.listLiveStreams("at-1")).toEqual([]);
  });

  it("throws when the streams lookup fails", async () => {
    const { fn } = fetchReturning({}, false, 403);
    const svc = new YouTubeAuthService(cfg, fn);
    await expect(svc.listLiveStreams("at-1")).rejects.toThrow(/liveStreams lookup failed/);
  });
});
