/**
 * YouTube Live integration for the Komet control plane.
 *
 * This is control-plane orchestration ONLY: it creates and transitions the
 * YouTube *broadcast* (the watch page / archived video) and binds it to the
 * channel's persistent *stream* key. It never touches video bytes — the actual
 * RTMP/SRT transport is the separate media gateway's job (PROJECT_RULES 2 & 3).
 *
 * Two implementations:
 *  - YouTubeApiService: talks to the YouTube Data API v3 using an OAuth refresh
 *    token. Used when credentials are configured.
 *  - NoopYouTubeService: a safe fallback used when credentials are absent, so
 *    START/STOP still drive the UI/state machine without a real broadcast.
 */

/** Result of creating (and going live on) a broadcast. */
export interface BroadcastHandle {
  /** YouTube broadcast id — used as our StreamingState.broadcastId. */
  broadcastId: string;
  /** Public watch URL, when known. */
  watchUrl?: string;
}

export interface YouTubeService {
  /** True when this service can actually talk to YouTube. */
  readonly enabled: boolean;
  /** Create a broadcast + bind the stream, ready to go live. */
  createBroadcast(params: {
    title: string;
    description?: string;
    privacy?: "public" | "unlisted" | "private";
  }): Promise<BroadcastHandle>;
  /** Transition a broadcast to the "live" state. */
  transitionToLive(broadcastId: string): Promise<void>;
  /** Transition a broadcast to "complete" (ends the stream/archives it). */
  completeBroadcast(broadcastId: string): Promise<void>;
}

/** Fetch signature (injectable for tests; defaults to global fetch). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The channel's persistent stream id to bind broadcasts to. */
  streamId: string;
  /** Default privacy for new broadcasts. */
  privacy?: "public" | "unlisted" | "private";
}

/**
 * Build a YouTubeService from environment variables. Returns a real API
 * service when all required vars are present, otherwise a no-op fallback.
 *
 * Required for the real service:
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
 *   YOUTUBE_STREAM_ID
 * Optional: YOUTUBE_PRIVACY (public|unlisted|private, default "unlisted")
 */
export function youTubeServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
): YouTubeService {
  const clientId = env.YOUTUBE_CLIENT_ID;
  const clientSecret = env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = env.YOUTUBE_REFRESH_TOKEN;
  const streamId = env.YOUTUBE_STREAM_ID;
  if (!clientId || !clientSecret || !refreshToken || !streamId) {
    return new NoopYouTubeService();
  }
  const privacy = normalizePrivacy(env.YOUTUBE_PRIVACY);
  return new YouTubeApiService(
    { clientId, clientSecret, refreshToken, streamId, privacy },
    fetchImpl,
  );
}

function normalizePrivacy(
  value: string | undefined,
): "public" | "unlisted" | "private" {
  if (value === "public" || value === "private") return value;
  return "unlisted";
}

/** Fallback used when YouTube is not configured. Does nothing but is valid. */
export class NoopYouTubeService implements YouTubeService {
  readonly enabled = false;

  async createBroadcast(): Promise<BroadcastHandle> {
    // A deterministic placeholder id so the state machine has a broadcastId.
    return { broadcastId: `noop-${Date.now()}` };
  }

  async transitionToLive(): Promise<void> {
    /* no-op */
  }

  async completeBroadcast(): Promise<void> {
    /* no-op */
  }
}

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";

/**
 * Real YouTube Data API v3 client. Uses an OAuth refresh token to mint
 * short-lived access tokens, then creates/binds/transitions broadcasts.
 */
export class YouTubeApiService implements YouTubeService {
  readonly enabled = true;
  private readonly cfg: YouTubeConfig;
  private readonly fetchImpl: FetchLike;
  private accessToken?: string;
  private accessTokenExpiry = 0;

  constructor(cfg: YouTubeConfig, fetchImpl?: FetchLike) {
    this.cfg = cfg;
    const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    if (!f) throw new Error("No fetch implementation available");
    this.fetchImpl = f;
  }

  /** Exchange the refresh token for an access token, cached until expiry. */
  private async getAccessToken(now: number = Date.now()): Promise<string> {
    if (this.accessToken && now < this.accessTokenExpiry) {
      return this.accessToken;
    }
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: this.cfg.refreshToken,
      grant_type: "refresh_token",
    }).toString();
    const res = await this.fetchImpl(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new Error(`YouTube token refresh failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = json.access_token;
    // Refresh 60s early to avoid edge-of-expiry failures.
    this.accessTokenExpiry = now + (json.expires_in - 60) * 1000;
    return this.accessToken;
  }

  private async apiFetch(
    pathAndQuery: string,
    init: { method: string; body?: unknown },
  ): Promise<unknown> {
    const token = await this.getAccessToken();
    const res = await this.fetchImpl(`${API_BASE}${pathAndQuery}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      throw new Error(
        `YouTube API ${init.method} ${pathAndQuery} failed (${res.status}): ${await res.text()}`,
      );
    }
    return res.json();
  }

  async createBroadcast(params: {
    title: string;
    description?: string;
    privacy?: "public" | "unlisted" | "private";
  }): Promise<BroadcastHandle> {
    const privacy = params.privacy ?? this.cfg.privacy ?? "unlisted";
    // 1) Create the broadcast (the watch page / future archived video).
    const created = (await this.apiFetch(
      "/liveBroadcasts?part=snippet,status,contentDetails",
      {
        method: "POST",
        body: {
          snippet: {
            title: params.title,
            description: params.description ?? "",
            scheduledStartTime: new Date().toISOString(),
          },
          status: {
            privacyStatus: privacy,
            selfDeclaredMadeForKids: false,
          },
          contentDetails: { enableAutoStart: false, enableAutoStop: false },
        },
      },
    )) as { id: string };
    const broadcastId = created.id;

    // 2) Bind the broadcast to the channel's persistent stream key.
    await this.apiFetch(
      `/liveBroadcasts/bind?id=${encodeURIComponent(broadcastId)}&streamId=${encodeURIComponent(this.cfg.streamId)}&part=id,contentDetails`,
      { method: "POST" },
    );

    return {
      broadcastId,
      watchUrl: `https://www.youtube.com/watch?v=${broadcastId}`,
    };
  }

  async transitionToLive(broadcastId: string): Promise<void> {
    await this.apiFetch(
      `/liveBroadcasts/transition?broadcastStatus=live&id=${encodeURIComponent(broadcastId)}&part=id,status`,
      { method: "POST" },
    );
  }

  async completeBroadcast(broadcastId: string): Promise<void> {
    await this.apiFetch(
      `/liveBroadcasts/transition?broadcastStatus=complete&id=${encodeURIComponent(broadcastId)}&part=id,status`,
      { method: "POST" },
    );
  }
}
