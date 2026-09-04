import {
  DEFAULT_SCORING,
  type GameScore,
  type ScoringConfig,
  type Side,
} from "./types.js";

/**
 * Authoritative badminton scoring engine.
 *
 * Rally-point scoring (BWF): first to `pointsToWin` (21) with a `winBy` (2)
 * lead, capped at `cap` (30). A match is best-of `bestOf` (3) games.
 *
 * This class is the single source of truth for score state. API, socket and
 * persistence layers must go through it — never mutate scores directly.
 */
export class Score {
  private readonly config: ScoringConfig;
  private games: GameScore[];

  constructor(config: ScoringConfig = DEFAULT_SCORING) {
    if (config.pointsToWin < 1) throw new Error("pointsToWin must be >= 1");
    if (config.winBy < 1) throw new Error("winBy must be >= 1");
    if (config.cap < config.pointsToWin) {
      throw new Error("cap must be >= pointsToWin");
    }
    if (config.bestOf < 1 || config.bestOf % 2 === 0) {
      throw new Error("bestOf must be a positive odd number");
    }
    this.config = { ...config };
    this.games = [{ home: 0, away: 0 }];
  }

  /** Games needed to win the match. */
  get gamesToWinMatch(): number {
    return Math.ceil(this.config.bestOf / 2);
  }

  /** Zero-based index of the game currently in progress (or last game). */
  get currentGameIndex(): number {
    return this.games.length - 1;
  }

  /** Immutable snapshot of all games played/in progress. */
  getGames(): GameScore[] {
    return this.games.map((g) => ({ ...g }));
  }

  /** Current (in-progress or final) game score. */
  getCurrentGame(): GameScore {
    return { ...this.games[this.currentGameIndex] };
  }

  /** Number of games won by each side. */
  gamesWon(): { home: number; away: number } {
    let home = 0;
    let away = 0;
    for (const g of this.games) {
      if (g.winner === "home") home++;
      else if (g.winner === "away") away++;
    }
    return { home, away };
  }

  /** Match winner, if decided. */
  matchWinner(): Side | undefined {
    const { home, away } = this.gamesWon();
    if (home >= this.gamesToWinMatch) return "home";
    if (away >= this.gamesToWinMatch) return "away";
    return undefined;
  }

  /** Whether the whole match is decided. */
  isMatchOver(): boolean {
    return this.matchWinner() !== undefined;
  }

  /** Add a point to a side in the current game. */
  addPoint(side: Side): void {
    if (this.isMatchOver()) {
      throw new Error("Cannot score: match is already over");
    }
    const game = this.games[this.currentGameIndex];
    if (game.winner) {
      throw new Error("Cannot score: current game is already finished");
    }
    game[side] += 1;
    this.evaluateGame(game);
  }

  /**
   * Remove a point from a side in the current game (correction).
   * Clears a game winner if the correction drops it below the win condition.
   */
  removePoint(side: Side): void {
    const game = this.games[this.currentGameIndex];
    if (game[side] <= 0) return;
    game[side] -= 1;
    // Re-evaluate: a mistaken game win may need to be undone.
    game.winner = undefined;
    this.evaluateGame(game);
  }

  /** Start the next game if the current one is finished and the match is not. */
  startNextGame(): void {
    const game = this.games[this.currentGameIndex];
    if (!game.winner) {
      throw new Error("Cannot start next game: current game is not finished");
    }
    if (this.isMatchOver()) {
      throw new Error("Cannot start next game: match is over");
    }
    this.games.push({ home: 0, away: 0 });
  }

  private evaluateGame(game: GameScore): void {
    const { pointsToWin, winBy, cap } = this.config;
    const { home, away } = game;
    const leader: Side = home >= away ? "home" : "away";
    const lead = Math.abs(home - away);
    const leaderScore = game[leader];

    if (leaderScore >= cap) {
      game.winner = leader;
      return;
    }
    if (leaderScore >= pointsToWin && lead >= winBy) {
      game.winner = leader;
    }
  }
}
