import type { FetchLike } from "../integrations/YouTubeService.js";

/**
 * Handles the interactive Google OAuth 2.0 "authorization code" flow used by
 * the "Login with YouTube" button, plus access-token refresh and channel
 * lookup. The long-lived refresh token this yields is persisted (encrypted) by
 * YouTubeTokenStore; the client secret and tokens never reach the browser
 * (PROJECT_RULES 3 & 18).
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CHANNELS_ENDPOINT =
  "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";

/** Scopes: manage live broadcasts + read the channel (for its title). */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export interface YouTubeAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface ChannelInfo {
  channelId: string;
  channelTitle: string;
}

export class YouTubeAuthService {
  private readonly cfg: YouTubeAuthConfig;
  private readonly fetchImpl: FetchLike;

  constructor(cfg: YouTubeAuthConfig, fetchImpl?: FetchLike) {
    this.cfg = cfg;
    const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    if (!f) throw new Error("No fetch implementation available");
    this.fetchImpl = f;
  }

  /**
   * Build the Google consent URL. `state` is an opaque CSRF token the caller
   * stores in the session and re-checks on callback. access_type=offline +
   * prompt=consent ensures we always receive a refresh token.
   */
  buildConsentUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: "code",
      scope: YOUTUBE_SCOPES.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  /** Exchange an authorization code for tokens. */
  async exchangeCode(code: string): Promise<TokenExchangeResult> {
    const body = new URLSearchParams({
      code,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      redirect_uri: this.cfg.redirectUri,
      grant_type: "authorization_code",
    }).toString();
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new Error(
        `OAuth code exchange failed (${res.status}): ${await res.text()}`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
    };
  }

  /** Mint a fresh access token from a stored refresh token. */
  async refreshAccessToken(refreshToken: string): Promise<TokenExchangeResult> {
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString();
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new Error(
        `OAuth token refresh failed (${res.status}): ${await res.text()}`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    return { accessToken: json.access_token, expiresIn: json.expires_in };
  }

  /** Fetch the authorising channel's id + title using an access token. */
  async fetchChannelInfo(accessToken: string): Promise<ChannelInfo> {
    const res = await this.fetchImpl(CHANNELS_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(
        `Channel lookup failed (${res.status}): ${await res.text()}`,
      );
    }
    const json = (await res.json()) as {
      items?: Array<{ id: string; snippet?: { title?: string } }>;
    };
    const item = json.items?.[0];
    if (!item) throw new Error("No YouTube channel found for this account");
    return {
      channelId: item.id,
      channelTitle: item.snippet?.title ?? "YouTube channel",
    };
  }
}
