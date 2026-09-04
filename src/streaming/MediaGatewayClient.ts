import type { FetchLike } from "../integrations/YouTubeService.js";

/**
 * Client for the komet-media-gateway control API. Komet Control uses this to
 * tell the gateway, per court, which YouTube RTMP target to push to. Runs over
 * the internal Docker network; never exposed to the browser.
 *
 * When no base URL is configured, this is a no-op (enabled=false) so the rest
 * of the stream flow still works without the gateway wired up.
 */
export interface GatewayStartResult {
  ok: boolean;
  courtId: number;
  srtPort?: number;
  rtmpUrl?: string;
}

export interface MediaGateway {
  readonly enabled: boolean;
  startCourt(courtId: number, rtmpUrl: string): Promise<GatewayStartResult>;
  stopCourt(courtId: number): Promise<{ ok: boolean; stopped?: boolean }>;
}

/** No-op gateway used when GATEWAY_URL is not configured. */
export class NoopMediaGateway implements MediaGateway {
  readonly enabled = false;
  async startCourt(courtId: number): Promise<GatewayStartResult> {
    return { ok: true, courtId };
  }
  async stopCourt(): Promise<{ ok: boolean; stopped?: boolean }> {
    return { ok: true, stopped: false };
  }
}

export interface MediaGatewayConfig {
  /** Base URL of the gateway control API, e.g. http://komet-media-gateway:8080 */
  baseUrl: string;
  /** Shared bearer token (GATEWAY_TOKEN on the gateway). */
  token?: string;
}

export class MediaGatewayClient implements MediaGateway {
  readonly enabled = true;
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;

  constructor(cfg: MediaGatewayConfig, fetchImpl?: FetchLike) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.token = cfg.token;
    const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    if (!f) throw new Error("No fetch implementation available");
    this.fetchImpl = f;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async startCourt(courtId: number, rtmpUrl: string): Promise<GatewayStartResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/courts/${courtId}/start`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ rtmpUrl }),
    });
    if (!res.ok) {
      throw new Error(
        `Gateway start court ${courtId} failed (${res.status}): ${await res.text()}`,
      );
    }
    return (await res.json()) as GatewayStartResult;
  }

  async stopCourt(courtId: number): Promise<{ ok: boolean; stopped?: boolean }> {
    const res = await this.fetchImpl(`${this.baseUrl}/courts/${courtId}/stop`, {
      method: "POST",
      headers: this.headers(),
      body: "{}",
    });
    if (!res.ok) {
      throw new Error(
        `Gateway stop court ${courtId} failed (${res.status}): ${await res.text()}`,
      );
    }
    return (await res.json()) as { ok: boolean; stopped?: boolean };
  }
}

/** Build a gateway client from env, or a no-op when GATEWAY_URL is unset. */
export function mediaGatewayFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
): MediaGateway {
  const baseUrl = env.GATEWAY_URL;
  if (!baseUrl) return new NoopMediaGateway();
  return new MediaGatewayClient(
    { baseUrl, token: env.GATEWAY_TOKEN },
    fetchImpl,
  );
}
