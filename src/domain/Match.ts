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
  status: MatchStatus;
  home: Team;
  away: Team;
  currentGame: GameScore;
  games: GameScore[];
  gamesWon: { home: number; away: number };
  matchWinner?: Side;
}

/**
 * A match on a court. Owns lifecycle (scheduled -> live -> finished) and
 * delegates all scoring to the authoritative Score engine.
 */
export class Match {
  readonly id: string;
  readonly courtId: number;
  readonly home: Team;
  readonly away: Team;
  private status: MatchStatus = "scheduled";
  private readonly score: Score;

  constructor(params: {
    id: string;
    courtId: number;
    home: Team;
    away: Team;
    scoring?: ScoringConfig;
  }) {
    if (!params.id) throw new Error("Match id is required");
    if (!Number.isInteger(params.courtId) || params.courtId < 1) {
      throw new Error("courtId must be a positive integer");
    }
    this.id = params.id;
    this.courtId = params.courtId;
    this.home = params.home;
    this.away = params.away;
    this.score = new Score(params.scoring ?? DEFAULT_SCORING);
  }

  getStatus(): MatchStatus {
    return this.status;
  }

  /** Transition scheduled -> live. */
  start(): void {
    if (this.status !== "scheduled") {
      throw new Error(`Cannot start match from status "${this.status}"`);
    }
    this.status = "live";
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

  private ensureLive(): void {
    if (this.status !== "live") {
      throw new Error(`Match is not live (status "${this.status}")`);
    }
  }

  private finishIfDecided(): void {
    if (this.score.isMatchOver()) {
      this.status = "finished";
    }
  }

  /** Immutable view for overlays, APIs and persistence. */
  snapshot(): MatchSnapshot {
    return {
      id: this.id,
      courtId: this.courtId,
      status: this.status,
      home: this.home,
      away: this.away,
      currentGame: this.score.getCurrentGame(),
      games: this.score.getGames(),
      gamesWon: this.score.gamesWon(),
      matchWinner: this.score.matchWinner(),
    };
  }
}
