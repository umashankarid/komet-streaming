import { Court, CourtService } from "./Court.js";
import { Match, type MatchSnapshot } from "./Match.js";
import {
  generateTitle,
  type OverlayMode,
  type StreamingSnapshot,
} from "./Streaming.js";
import type { ScoringConfig, Side, Team } from "./types.js";

export type CourtUpdateListener = (courtId: number, snapshot: MatchSnapshot) => void;
export type StreamingUpdateListener = (
  courtId: number,
  snapshot: StreamingSnapshot,
) => void;

/**
 * Application-facing facade over the domain. Owns the CourtService, mutates
 * match/score state through the domain classes, and notifies listeners so the
 * WebSocket layer can push updates to overlays. Business logic stays in the
 * domain classes; this only coordinates and broadcasts.
 */
export class MatchOrchestrator {
  private readonly courts: CourtService;
  private readonly listeners = new Set<CourtUpdateListener>();
  private readonly streamingListeners = new Set<StreamingUpdateListener>();
  private seq = 0;

  constructor(courts: CourtService = new CourtService()) {
    this.courts = courts;
  }

  /** Subscribe to court updates. Returns an unsubscribe function. */
  onUpdate(listener: CourtUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to streaming-state updates. Returns an unsubscribe function. */
  onStreamingUpdate(listener: StreamingUpdateListener): () => void {
    this.streamingListeners.add(listener);
    return () => this.streamingListeners.delete(listener);
  }

  ensureCourt(courtId: number): Court {
    if (!this.courts.hasCourt(courtId)) this.courts.addCourt(courtId);
    return this.courts.getCourt(courtId);
  }

  listCourts(): Court[] {
    return this.courts.listCourts();
  }

  /** Create and assign a new match to a court, replacing any current match. */
  createMatch(params: {
    courtId: number;
    home: Team;
    away: Team;
    scoring?: ScoringConfig;
    courtName?: string;
    banner?: string;
    tickerText?: string;
  }): MatchSnapshot {
    const court = this.ensureCourt(params.courtId);
    const match = new Match({
      id: `match-${++this.seq}`,
      courtId: params.courtId,
      home: params.home,
      away: params.away,
      scoring: params.scoring,
      courtName: params.courtName,
      banner: params.banner,
      tickerText: params.tickerText,
    });
    court.assignMatch(match);
    return this.emit(params.courtId);
  }

  /** Set or clear the scrolling ticker text for a court's match. */
  setTicker(courtId: number, text: string | undefined): MatchSnapshot {
    this.requireMatch(courtId).setTicker(text);
    return this.emit(courtId);
  }

  startMatch(courtId: number): MatchSnapshot {
    this.requireMatch(courtId).start();
    return this.emit(courtId);
  }

  point(courtId: number, side: Side): MatchSnapshot {
    this.requireMatch(courtId).pointFor(side);
    return this.emit(courtId);
  }

  correct(courtId: number, side: Side): MatchSnapshot {
    this.requireMatch(courtId).correctPoint(side);
    return this.emit(courtId);
  }

  nextGame(courtId: number): MatchSnapshot {
    this.requireMatch(courtId).nextGame();
    return this.emit(courtId);
  }

  /** Current snapshot for a court, or undefined if no match is assigned. */
  snapshot(courtId: number): MatchSnapshot | undefined {
    return this.courts.getCourt(courtId).getMatch()?.snapshot();
  }

  // --- Streaming orchestration (control-plane metadata only; Rule 2 & 3) ---

  /** Current streaming snapshot for a court (always present). */
  streamingSnapshot(courtId: number): StreamingSnapshot {
    return this.ensureCourt(courtId).streaming.snapshot();
  }

  /**
   * Suggested YouTube title for a court, derived from its match when present.
   * The operator can edit this before starting. When no match exists it falls
   * back to "Court N".
   */
  suggestTitle(courtId: number): string {
    this.ensureCourt(courtId);
    return generateTitle(courtId, this.snapshot(courtId));
  }

  /** Report SRT camera connectivity for a court. */
  setCameraConnected(courtId: number, connected: boolean): StreamingSnapshot {
    this.ensureCourt(courtId).streaming.setCameraConnected(connected);
    return this.emitStreaming(courtId);
  }

  /** Choose the overlay mode before starting (idle/error only). */
  setOverlayMode(courtId: number, mode: OverlayMode): StreamingSnapshot {
    this.ensureCourt(courtId).streaming.setOverlayMode(mode);
    return this.emitStreaming(courtId);
  }

  /** Set/clear the YouTube title before starting (idle/error only). */
  setStreamTitle(courtId: number, title: string | undefined): StreamingSnapshot {
    this.ensureCourt(courtId).streaming.setTitle(title);
    return this.emitStreaming(courtId);
  }

  /**
   * Begin the start sequence. If no title is provided, an auto-generated one
   * (from match info) is used, matching the operator's edit-before-start flow.
   */
  requestStreamStart(
    courtId: number,
    params: { title?: string; overlayMode?: OverlayMode } = {},
  ): StreamingSnapshot {
    const title =
      params.title !== undefined && params.title.trim().length > 0
        ? params.title
        : this.suggestTitle(courtId);
    this.ensureCourt(courtId).streaming.requestStart({
      title,
      overlayMode: params.overlayMode,
    });
    return this.emitStreaming(courtId);
  }

  /** Confirm the YouTube broadcast is live (starting -> live). */
  confirmStreamLive(courtId: number, broadcastId: string): StreamingSnapshot {
    this.ensureCourt(courtId).streaming.confirmLive(broadcastId);
    return this.emitStreaming(courtId);
  }

  /** Begin the stop sequence (live -> stopping). */
  requestStreamStop(courtId: number): StreamingSnapshot {
    this.ensureCourt(courtId).streaming.requestStop();
    return this.emitStreaming(courtId);
  }

  /** Finalize the stop (stopping -> idle); keeps the camera connection. */
  confirmStreamStopped(courtId: number): StreamingSnapshot {
    this.ensureCourt(courtId).streaming.confirmStopped();
    return this.emitStreaming(courtId);
  }

  /** Move a court's stream into the error state. */
  failStream(courtId: number, reason: string): StreamingSnapshot {
    this.ensureCourt(courtId).streaming.fail(reason);
    return this.emitStreaming(courtId);
  }

  /** Recover a court's stream from error back to idle. */
  resetStream(courtId: number): StreamingSnapshot {
    this.ensureCourt(courtId).streaming.reset();
    return this.emitStreaming(courtId);
  }

  private requireMatch(courtId: number): Match {
    const match = this.courts.getCourt(courtId).getMatch();
    if (!match) throw new Error(`No match assigned to court ${courtId}`);
    return match;
  }

  private emit(courtId: number): MatchSnapshot {
    const snap = this.requireMatch(courtId).snapshot();
    for (const l of this.listeners) l(courtId, snap);
    return snap;
  }

  private emitStreaming(courtId: number): StreamingSnapshot {
    const snap = this.courts.getCourt(courtId).streaming.snapshot();
    for (const l of this.streamingListeners) l(courtId, snap);
    return snap;
  }
}
