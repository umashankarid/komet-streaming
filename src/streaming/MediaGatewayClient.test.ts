import { describe, expect, it } from "vitest";
import {
  MediaGatewayClient,
  NoopMediaGateway,
  mediaGatewayFromEnv,
} from "./MediaGatewayClient.js";
import type { FetchLike } from "../integrations/YouTubeService.js";

function fakeFetch(payload: unknown, ok = true, status = 200) {
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

describe("mediaGatewayFromEnv", () => {
  it("returns a no-op when GATEWAY_URL is unset", () => {
    const g = mediaGatewayFromEnv({});
    expect(g.enabled).toBe(false);
    expect(g).toBeInstanceOf(NoopMediaGateway);
  });

  it("returns a real client when GATEWAY_URL is set", () => {
    const g = mediaGatewayFromEnv(
      { GATEWAY_URL: "http://gw:8080", GATEWAY_TOKEN: "t" },
      (async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" })) as FetchLike,
    );
    expect(g.enabled).toBe(true);
    expect(g).toBeInstanceOf(MediaGatewayClient);
  });
});

describe("NoopMediaGateway", () => {
  it("start/stop are inert", async () => {
    const g = new NoopMediaGateway();
    expect(await g.startCourt(1, "rtmp://x")).toEqual({ ok: true, courtId: 1 });
    expect(await g.stopCourt(1)).toEqual({ ok: true, stopped: false });
  });
});

describe("MediaGatewayClient", () => {
  it("starts a court with the rtmp url and bearer token", async () => {
    const { fn, calls } = fakeFetch({ ok: true, courtId: 1, srtPort: 10001 });
    const g = new MediaGatewayClient({ baseUrl: "http://gw:8080/", token: "tok" }, fn);
    const res = await g.startCourt(1, "rtmp://a/live2/key1");
    expect(res).toEqual({ ok: true, courtId: 1, srtPort: 10001 });
    expect(calls[0].url).toBe("http://gw:8080/courts/1/start");
    const init = calls[0].init as { headers: Record<string, string>; body: string };
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ rtmpUrl: "rtmp://a/live2/key1" });
  });

  it("stops a court", async () => {
    const { fn, calls } = fakeFetch({ ok: true, stopped: true });
    const g = new MediaGatewayClient({ baseUrl: "http://gw:8080" }, fn);
    const res = await g.stopCourt(2);
    expect(res).toEqual({ ok: true, stopped: true });
    expect(calls[0].url).toBe("http://gw:8080/courts/2/stop");
  });

  it("omits the Authorization header when no token", async () => {
    const { fn, calls } = fakeFetch({ ok: true, courtId: 1 });
    const g = new MediaGatewayClient({ baseUrl: "http://gw:8080" }, fn);
    await g.startCourt(1, "rtmp://a/live2/k");
    const init = calls[0].init as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("throws on a non-ok start response", async () => {
    const { fn } = fakeFetch({ error: "boom" }, false, 500);
    const g = new MediaGatewayClient({ baseUrl: "http://gw:8080" }, fn);
    await expect(g.startCourt(1, "rtmp://a/live2/k")).rejects.toThrow(
      /Gateway start court 1 failed \(500\)/,
    );
  });

  it("throws on a non-ok stop response", async () => {
    const { fn } = fakeFetch({}, false, 503);
    const g = new MediaGatewayClient({ baseUrl: "http://gw:8080" }, fn);
    await expect(g.stopCourt(1)).rejects.toThrow(/Gateway stop court 1 failed \(503\)/);
  });

  it("gets status and unwraps the courts array", async () => {
    const { fn, calls } = fakeFetch({
      courts: [{ courtId: 1, running: true, connected: true }],
    });
    const g = new MediaGatewayClient({ baseUrl: "http://gw:8080", token: "t" }, fn);
    const status = await g.getStatus();
    expect(status).toEqual([{ courtId: 1, running: true, connected: true }]);
    expect(calls[0].url).toBe("http://gw:8080/status");
  });

  it("returns an empty array when status has no courts", async () => {
    const { fn } = fakeFetch({});
    const g = new MediaGatewayClient({ baseUrl: "http://gw:8080" }, fn);
    expect(await g.getStatus()).toEqual([]);
  });

  it("throws on a non-ok status response", async () => {
    const { fn } = fakeFetch({}, false, 500);
    const g = new MediaGatewayClient({ baseUrl: "http://gw:8080" }, fn);
    await expect(g.getStatus()).rejects.toThrow(/Gateway status failed \(500\)/);
  });
});
