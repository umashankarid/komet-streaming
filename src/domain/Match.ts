import { Score } from "./Score.js";
import {
  DEFAULT_SCORING,
  type GameScore,
  type MatchStatus,
  type ScoringConfig,
  type Side,
  type Team,
} from "./types.js";

export interface MatchSnapshot {
  id: string;
  courtId: number;
  /** Human-friendly court label, e.g. "Center Court". Defaults to "Court N". */
  courtName: string;
  /** Optional round/stage banner, e.g. "Semi Final", "Final". */
  banner?: string;
  /** Optional scrolling ticker text shown in the ticker overlay. */
  tickerText?: string;
  status: MatchStatus;
  home: Team;
  away: Team;
  currentGame: GameScore;
  games: GameScore[];
  gamesWon: { home: number; away: number };
  matchWinner?: Side;
  /** Epoch ms when the match went live, or undefined if not started. */
  startedAt?: number;
  /** Epoch ms when the match finished, or undefined if still live/scheduled. */
  finishedAt?: number;
  /** Elapsed match duration in ms (live: now - startedAt; finished: fixed). */
  durationMs: number;
}

/** Injectable clock for deterministic tests. */
export type Clock = () => number;

/**
 * A match on a court. Owns lifecycle (scheduled -> live -> finished) and
 * delegates all scoring to the authoritative Score engine.
 */
export class Match {
  readonly id: string;
  readonly courtId: number;
  readonly courtName: string;
  readonly banner?: string;
  readonly home: Team;
  readonly away: Team;
  private status: MatchStatus = "scheduled";
  private tickerText?: string;
  private readonly score: Score;
  private readonly now: Clock;
  private startedAt?: number;
  private finishedAt?: number;

  constructor(params: {
    id: string;
    courtId: number;
    home: Team;
    away: Team;
    scoring?: ScoringConfig;
    /** Optional custom court label; defaults to "Court N". */
    courtName?: string;
    /** Optional round/stage banner, e.g. "Semi Final". */
    banner?: string;
    /** Optional initial scrolling ticker text. */
    tickerText?: string;
    clock?: Clock;
  }) {
    if (!params.id) throw new Error("Match id is required");
    if (!Number.isInteger(params.courtId) || params.courtId < 1) {
      throw new Error("courtId must be a positive integer");
    }
    this.id = params.id;
    this.courtId = params.courtId;
    this.courtName =
      params.courtName?.trim() || `Court ${params.courtId}`;
    this.banner = params.banner?.trim() || undefined;
    this.tickerText = params.tickerText?.trim() || undefined;
    this.home = params.home;
    this.away = params.away;
    this.score = new Score(params.scoring ?? DEFAULT_SCORING);
    this.now = params.clock ?? Date.now;
  }

  getStatus(): MatchStatus {
    return this.status;
  }

  /** Set or clear the scrolling ticker text (allowed in any status). */
  setTicker(text: string | undefined): void {
    this.tickerText = text?.trim() || undefined;
  }

  /** Transition scheduled -> live and stamp the start time. */
  start(): void {
    if (this.status !== "scheduled") {
      throw new Error(`Cannot start match from status "${this.status}"`);
    }
    this.status = "live";
    this.startedAt = this.now();
  }

  /** Score a point for a side; auto-finishes the match when decided. */
  pointFor(side: Side): void {
    this.ensureLive();
    this.score.addPoint(side);
    this.finishIfDecided();
  }

  /** Correct a point (subtract). Allowed while live. */
  correctPoint(side: Side): void {
    this.ensureLive();
    this.score.removePoint(side);
  }

  /** Advance to the next game when the current one is finished. */
  nextGame(): void {
    this.ensureLive();
    this.score.startNextGame();
  }

  /** Elapsed match time in ms. Zero until started; frozen once finished. */
  durationMs(): number {
    if (this.startedAt === undefined) return 0;
    const end = this.finishedAt ?? this.now();
    return Math.max(0, end - this.startedAt);
  }

  private ensureLive(): void {
    if (this.status !== "live") {
      throw new Error(`Match is not live (status "${this.status}")`);
    }
  }

  private finishIfDecided(): void {
    if (this.score.isMatchOver()) {
      this.status = "finished";
      this.finishedAt = this.now();
    }
  }

  /** Immutable view for overlays, APIs and persistence. */
  snapshot(): MatchSnapshot {
    return {
      id: this.id,
      courtId: this.courtId,
      courtName: this.courtName,
      banner: this.banner,
      tickerText: this.tickerText,
      status: this.status,
      home: this.home,
      away: this.away,
      currentGame: this.score.getCurrentGame(),
      games: this.score.getGames(),
      gamesWon: this.score.gamesWon(),
      matchWinner: this.score.matchWinner(),
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      durationMs: this.durationMs(),
    };
  }
}
