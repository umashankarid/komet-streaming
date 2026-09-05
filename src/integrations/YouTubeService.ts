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
  /**
   * Full RTMP push URL (ingestion address + stream key) for the bound stream,
   * when known. This is what the media gateway pushes video to. Only available
   * for auto-created streams (YouTube returns the key on create).
   */
  rtmpUrl?: string;
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
  /**
   * Refresh token source. Either a static string, or a provider that returns
   * the current token (e.g. reading from the encrypted token store, so a
   * "Login with YouTube" reconnect is picked up without a restart).
   */
  refreshToken: string | (() => string | undefined);
  /**
   * The channel's persistent stream id to bind broadcasts to. Optional: when
   * absent, the service auto-creates a reusable stream on first use and caches
   * it (spec section 4). Provide it to pin a specific stream.
   */
  streamId?: string;
  /** Default privacy for new broadcasts. */
  privacy?: "public" | "unlisted" | "private";
}

/**
 * Build a YouTubeService from environment variables. Returns a real API
 * service when all required vars are present, otherwise a no-op fallback.
 *
 * Required for the real service:
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_STREAM_ID and a refresh
 *   token — either from YOUTUBE_REFRESH_TOKEN or supplied by getRefreshToken
 *   (the encrypted token store populated by "Login with YouTube").
 * Optional: YOUTUBE_PRIVACY (public|unlisted|private, default "unlisted")
 */
export function youTubeServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
  getRefreshToken?: () => string | undefined,
): YouTubeService {
  const clientId = env.YOUTUBE_CLIENT_ID;
  const clientSecret = env.YOUTUBE_CLIENT_SECRET;
  const streamId = env.YOUTUBE_STREAM_ID; // optional now (auto-create if absent)
  // Token source: prefer the dynamic store, fall back to a static env token.
  const envToken = env.YOUTUBE_REFRESH_TOKEN;
  const tokenProvider: () => string | undefined = getRefreshToken
    ? () => getRefreshToken() ?? envToken
    : () => envToken;

  // Client credentials are the fixed requirement. The refresh token can arrive
  // later via OAuth login, and the stream is auto-created if not pinned.
  if (!clientId || !clientSecret) {
    return new NoopYouTubeService();
  }
  const privacy = normalizePrivacy(env.YOUTUBE_PRIVACY);
  return new YouTubeApiService(
    { clientId, clientSecret, refreshToken: tokenProvider, streamId, privacy },
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
  /** Cached id of a reusable stream we auto-created (when none configured). */
  private autoStreamId?: string;
  /** Cached RTMP push URL for the auto-created stream. */
  private autoRtmpUrl?: string;

  constructor(cfg: YouTubeConfig, fetchImpl?: FetchLike) {
    this.cfg = cfg;
    const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    if (!f) throw new Error("No fetch implementation available");
    this.fetchImpl = f;
  }

  /** Resolve the current refresh token from a static value or provider. */
  private resolveRefreshToken(): string {
    const rt =
      typeof this.cfg.refreshToken === "function"
        ? this.cfg.refreshToken()
        : this.cfg.refreshToken;
    if (!rt) {
      throw new Error("YouTube not connected: no refresh token available");
    }
    return rt;
  }

  /** Exchange the refresh token for an access token, cached until expiry. */
  private async getAccessToken(now: number = Date.now()): Promise<string> {
    if (this.accessToken && now < this.accessTokenExpiry) {
      return this.accessToken;
    }
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: this.resolveRefreshToken(),
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
          contentDetails: { enableAutoStart: true, enableAutoStop: true },
        },
      },
    )) as { id: string };
    const broadcastId = created.id;

    // 2) Bind the broadcast to a reusable stream (configured or auto-created).
    const streamId = await this.resolveStreamId(params.title);
    await this.apiFetch(
      `/liveBroadcasts/bind?id=${encodeURIComponent(broadcastId)}&streamId=${encodeURIComponent(streamId)}&part=id,contentDetails`,
      { method: "POST" },
    );

    // 3) Resolve the RTMP push URL for the bound stream. Prefer the cached one
    // from auto-create; otherwise look it up so the media gateway always gets
    // a target (also covers a pinned YOUTUBE_STREAM_ID).
    let rtmpUrl = this.autoRtmpUrl;
    if (!rtmpUrl) {
      rtmpUrl = await this.fetchStreamRtmpUrl(streamId);
    }

    return {
      broadcastId,
      watchUrl: `https://www.youtube.com/watch?v=${broadcastId}`,
      rtmpUrl,
    };
  }

  /** Look up a stream's RTMP push URL (ingestion address + key) by id. */
  private async fetchStreamRtmpUrl(streamId: string): Promise<string | undefined> {
    try {
      const json = (await this.apiFetch(
        `/liveStreams?part=cdn&id=${encodeURIComponent(streamId)}`,
        { method: "GET" },
      )) as {
        items?: Array<{
          cdn?: { ingestionInfo?: { ingestionAddress?: string; streamName?: string } };
        }>;
      };
      const info = json.items?.[0]?.cdn?.ingestionInfo;
      if (info?.ingestionAddress && info?.streamName) {
        return `${info.ingestionAddress.replace(/\/$/, "")}/${info.streamName}`;
      }
    } catch {
      // Non-fatal: gateway just won't be told the target.
    }
    return undefined;
  }

  /**
   * Return the stream id to bind to: the configured one, a previously
   * auto-created one, or a newly created reusable stream (cached for reuse).
   * When auto-creating, also caches the full RTMP push URL so the media
   * gateway can be told where to send video.
   */
  private async resolveStreamId(titleHint: string): Promise<string> {
    if (this.cfg.streamId) return this.cfg.streamId;
    if (this.autoStreamId) return this.autoStreamId;
    const created = (await this.apiFetch(
      "/liveStreams?part=snippet,cdn,contentDetails",
      {
        method: "POST",
        body: {
          snippet: { title: `Komet — ${titleHint}`.slice(0, 128) },
          cdn: {
            frameRate: "variable",
            ingestionType: "rtmp",
            resolution: "variable",
          },
          contentDetails: { isReusable: true },
        },
      },
    )) as {
      id: string;
      cdn?: {
        ingestionInfo?: { ingestionAddress?: string; streamName?: string };
      };
    };
    this.autoStreamId = created.id;
    const info = created.cdn?.ingestionInfo;
    if (info?.ingestionAddress && info?.streamName) {
      // Normalize (YouTube returns address without trailing slash).
      const addr = info.ingestionAddress.replace(/\/$/, "");
      this.autoRtmpUrl = `${addr}/${info.streamName}`;
    }
    return created.id;
  }

  async transitionToLive(broadcastId: string): Promise<void> {
    // With enableAutoStart, YouTube transitions the broadcast to live itself
    // once ingest becomes active. Calling transition explicitly before video
    // is flowing returns 403 (errorStreamInactive / redundantTransition). That
    // is expected and harmless here, so we tolerate 403 and let autoStart do
    // the work. Other errors still propagate.
    try {
      await this.apiFetch(
        `/liveBroadcasts/transition?broadcastStatus=live&id=${encodeURIComponent(broadcastId)}&part=id,status`,
        { method: "POST" },
      );
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("failed (403)")) return; // stream not active yet
      throw err;
    }
  }

  async completeBroadcast(broadcastId: string): Promise<void> {
    await this.apiFetch(
      `/liveBroadcasts/transition?broadcastStatus=complete&id=${encodeURIComponent(broadcastId)}&part=id,status`,
      { method: "POST" },
    );
  }
}
