import type { MatchSnapshot } from "./Match.js";

/**
 * Overlay mode chosen by the operator before starting a stream.
 *  - "none":  clean recording, no Komet overlay burned in.
 *  - "score": full match + live score overlay.
 *  - "match": match info only (players/court/banner), no live score.
 *  - "full":  match + score + sponsor/tournament banner + ticker.
 */
export type OverlayMode = "none" | "score" | "match" | "full";

export const OVERLAY_MODES: OverlayMode[] = ["none", "score", "match", "full"];

/**
 * YouTube-facing lifecycle for a court's stream.
 *
 *   idle -> starting -> live -> stopping -> idle
 *
 * Any state may transition to "error"; from "error" the operator can reset
 * back to "idle". This mirrors the Match lifecycle style: transitions are
 * validated here and illegal ones throw.
 */
export type YoutubeStatus =
  | "idle"
  | "starting"
  | "live"
  | "stopping"
  | "error";

/** Injectable clock for deterministic tests (mirrors Match.Clock). */
export type Clock = () => number;

/** Immutable view of a court's streaming state for APIs/WebSocket/UI. */
export interface StreamingSnapshot {
  courtId: number;
  /** True when a phone/SRT camera feed is connected to this court's gateway. */
  cameraConnected: boolean;
  youtubeStatus: YoutubeStatus;
  /** YouTube broadcast id, once created. */
  broadcastId?: string;
  /** The title used for the YouTube broadcast/archived video. */
  title?: string;
  overlayMode: OverlayMode;
  /** Epoch ms when the stream went live, or undefined if not live. */
  startedAt?: number;
  /** Elapsed live duration in ms (0 unless live). */
  durationMs: number;
  /** Human-readable error message when youtubeStatus is "error". */
  error?: string;
}

const MAX_TITLE = 100; // YouTube caps broadcast titles at 100 chars.

/** Trim, collapse, and clamp a title to YouTube's limit. Empty -> undefined. */
export function normalizeTitle(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, MAX_TITLE);
}

/** Join non-empty parts with " | ", used for auto-generated titles. */
function joinParts(parts: (string | undefined)[]): string {
  return parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .join(" | ");
}

/** Render a team's players as "A & B" for titles. */
function teamLabel(players: { name: string }[] | undefined): string {
  if (!players || players.length === 0) return "";
  return players
    .map((p) => p.name.trim())
    .filter((n) => n.length > 0)
    .join(" & ");
}

/**
 * Build a default YouTube title from match info, e.g.
 *   "<banner> | <Home> vs <Away> | Court 1"
 * When no match exists, falls back to "Court N". The operator can always
 * override this before starting the stream.
 */
export function generateTitle(
  courtId: number,
  match: MatchSnapshot | undefined,
): string {
  const courtLabel = `Court ${courtId}`;
  if (!match) return courtLabel;
  const home = teamLabel(match.home?.players);
  const away = teamLabel(match.away?.players);
  const versus = home && away ? `${home} vs ${away}` : home || away || "";
  const title = joinParts([match.banner, versus, courtLabel]);
  return normalizeTitle(title) ?? courtLabel;
}

/**
 * Per-court streaming state machine. This is control-plane metadata and
 * orchestration signalling ONLY — it never touches video. Actual SRT/RTMP
 * transport lives in the separate media gateway (PROJECT_RULES Rule 2 & 3),
 * so a court can stream with or without an assigned match.
 */
export class CourtStreaming {
  readonly courtId: number;
  private cameraConnected = false;
  private status: YoutubeStatus = "idle";
  private broadcastId?: string;
  private title?: string;
  private overlayMode: OverlayMode = "score";
  private startedAt?: number;
  private error?: string;
  private readonly now: Clock;

  constructor(courtId: number, clock: Clock = Date.now) {
    if (!Number.isInteger(courtId) || courtId < 1) {
      throw new Error("Court id must be a positive integer");
    }
    this.courtId = courtId;
    this.now = clock;
  }

  getStatus(): YoutubeStatus {
    return this.status;
  }

  isCameraConnected(): boolean {
    return this.cameraConnected;
  }

  /** Report camera (SRT) connectivity for this court's gateway. */
  setCameraConnected(connected: boolean): void {
    this.cameraConnected = Boolean(connected);
  }

  /** Choose the overlay mode. Only allowed before the stream starts. */
  setOverlayMode(mode: OverlayMode): void {
    if (!OVERLAY_MODES.includes(mode)) {
      throw new Error(`Invalid overlay mode "${mode}"`);
    }
    if (this.status !== "idle" && this.status !== "error") {
      throw new Error("Cannot change overlay mode while streaming");
    }
    this.overlayMode = mode;
  }

  /** Set/clear the YouTube title. Only allowed before the stream starts. */
  setTitle(title: string | undefined): void {
    if (this.status !== "idle" && this.status !== "error") {
      throw new Error("Cannot change title while streaming");
    }
    this.title = normalizeTitle(title);
  }

  /**
   * Begin the start sequence: idle -> starting. Requires a non-empty title
   * (the operator either typed one or accepted the generated default).
   */
  requestStart(params: {
    title: string;
    overlayMode?: OverlayMode;
  }): void {
    if (this.status !== "idle" && this.status !== "error") {
      throw new Error(`Cannot start stream from status "${this.status}"`);
    }
    const title = normalizeTitle(params.title);
    if (!title) throw new Error("A YouTube title is required to start a stream");
    if (params.overlayMode !== undefined) {
      if (!OVERLAY_MODES.includes(params.overlayMode)) {
        throw new Error(`Invalid overlay mode "${params.overlayMode}"`);
      }
      this.overlayMode = params.overlayMode;
    }
    this.title = title;
    this.error = undefined;
    this.broadcastId = undefined;
    this.status = "starting";
  }

  /**
   * Confirm the YouTube broadcast is live: starting -> live. Called once the
   * backend has created the broadcast and YouTube reports "live".
   */
  confirmLive(broadcastId: string): void {
    if (this.status !== "starting") {
      throw new Error(`Cannot go live from status "${this.status}"`);
    }
    if (!broadcastId || !broadcastId.trim()) {
      throw new Error("broadcastId is required to go live");
    }
    this.broadcastId = broadcastId.trim();
    this.status = "live";
    this.startedAt = this.now();
  }

  /** Begin the stop sequence: live -> stopping. */
  requestStop(): void {
    if (this.status !== "live") {
      throw new Error(`Cannot stop stream from status "${this.status}"`);
    }
    this.status = "stopping";
  }

  /**
   * Finalize the stop: stopping -> idle. The camera connection is intentionally
   * preserved (STOP STREAM keeps the SRT camera ready).
   */
  confirmStopped(): void {
    if (this.status !== "stopping") {
      throw new Error(`Cannot finish stopping from status "${this.status}"`);
    }
    this.status = "idle";
    this.broadcastId = undefined;
    this.startedAt = undefined;
  }

  /** Move to the error state from any status, recording a reason. */
  fail(reason: string): void {
    this.status = "error";
    this.error = reason?.trim() || "Unknown streaming error";
    this.startedAt = undefined;
  }

  /** Recover from error back to idle, clearing transient fields. */
  reset(): void {
    this.status = "idle";
    this.error = undefined;
    this.broadcastId = undefined;
    this.startedAt = undefined;
  }

  /** Elapsed live duration in ms. Zero unless currently live. */
  durationMs(): number {
    if (this.status !== "live" || this.startedAt === undefined) return 0;
    return Math.max(0, this.now() - this.startedAt);
  }

  /** Immutable view for APIs, WebSocket and UI. */
  snapshot(): StreamingSnapshot {
    return {
      courtId: this.courtId,
      cameraConnected: this.cameraConnected,
      youtubeStatus: this.status,
      broadcastId: this.broadcastId,
      title: this.title,
      overlayMode: this.overlayMode,
      startedAt: this.startedAt,
      durationMs: this.durationMs(),
      error: this.error,
    };
  }
}
