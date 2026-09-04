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

export const DEFAULT_SCORING: ScoringConfig = {
  pointsToWin: 21,
  winBy: 2,
  cap: 30,
  bestOf: 3,
};
