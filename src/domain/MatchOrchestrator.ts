import { Court, CourtService } from "./Court.js";
import { Match, type MatchSnapshot } from "./Match.js";
import type { ScoringConfig, Side, Team } from "./types.js";

export type CourtUpdateListener = (courtId: number, snapshot: MatchSnapshot) => void;

/**
 * Application-facing facade over the domain. Owns the CourtService, mutates
 * match/score state through the domain classes, and notifies listeners so the
 * WebSocket layer can push updates to overlays. Business logic stays in the
 * domain classes; this only coordinates and broadcasts.
 */
export class MatchOrchestrator {
  private readonly courts: CourtService;
  private readonly listeners = new Set<CourtUpdateListener>();
  private seq = 0;

  constructor(courts: CourtService = new CourtService()) {
    this.courts = courts;
  }

  /** Subscribe to court updates. Returns an unsubscribe function. */
  onUpdate(listener: CourtUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
}
