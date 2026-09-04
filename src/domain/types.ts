/**
 * Shared domain types for the Komet control plane.
 * These describe the authoritative state owned by src/domain.
 */

export type Side = "home" | "away";

export interface Player {
  /** Display name shown on overlays, e.g. "A. Andersson". */
  name: string;
  /** Optional club/country label. */
  affiliation?: string;
}

export interface Team {
  players: Player[];
}

export interface GameScore {
  home: number;
  away: number;
  /** Set once the game reaches a valid finished state. */
  winner?: Side;
}

export type MatchStatus = "scheduled" | "live" | "finished";

/** Badminton scoring configuration. Defaults follow BWF rally-point rules. */
export interface ScoringConfig {
  /** Points needed to win a game under normal play. */
  pointsToWin: number;
  /** Minimum lead required to win (before the cap). */
  winBy: number;
  /** Hard ceiling; reaching this wins regardless of lead. */
  cap: number;
  /** Number of games; the match is won at ceil(bestOf / 2). */
  bestOf: number;
}

/**
 * Default scoring: 15 points, win by 2, capped at 17, best of 3 games.
 * Per-match scoring can be customized when creating a match.
 */
export const DEFAULT_SCORING: ScoringConfig = {
  pointsToWin: 15,
  winBy: 2,
  cap: 17,
  bestOf: 3,
};
