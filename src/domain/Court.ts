import { Match } from "./Match.js";

/** Zero-pad a court number to 2 digits, per PROJECT_RULES Rule 5. */
export function pad2(courtId: number): string {
  return String(courtId).padStart(2, "0");
}

/** Naming conventions derived from a court id (Rule 5). */
export interface CourtNaming {
  phoneDevice: string; // KOMET-CAM-01
  camSource: string; // CAM_COURT_01
  overlaySource: string; // OVERLAY_COURT_01
  scene: string; // COURT_01_LIVE
  overlayUrl: string; // /overlay/court/1
  scoreUrl: string; // /score/1
}

export function courtNaming(courtId: number): CourtNaming {
  const p = pad2(courtId);
  return {
    phoneDevice: `KOMET-CAM-${p}`,
    camSource: `CAM_COURT_${p}`,
    overlaySource: `OVERLAY_COURT_${p}`,
    scene: `COURT_${p}_LIVE`,
    overlayUrl: `/overlay/court/${courtId}`,
    scoreUrl: `/score/${courtId}`,
  };
}

/**
 * A physical court. Holds a stable identity and (optionally) the match
 * currently assigned to it.
 */
export class Court {
  readonly id: number;
  readonly naming: CourtNaming;
  private currentMatch?: Match;

  constructor(id: number) {
    if (!Number.isInteger(id) || id < 1) {
      throw new Error("Court id must be a positive integer");
    }
    this.id = id;
    this.naming = courtNaming(id);
  }

  getMatch(): Match | undefined {
    return this.currentMatch;
  }

  assignMatch(match: Match): void {
    if (match.courtId !== this.id) {
      throw new Error(
        `Match courtId ${match.courtId} does not match court ${this.id}`,
      );
    }
    this.currentMatch = match;
  }

  clearMatch(): void {
    this.currentMatch = undefined;
  }
}

/**
 * In-memory registry of courts. The authoritative set of courts for the
 * running control plane.
 */
export class CourtService {
  private readonly courts = new Map<number, Court>();

  constructor(courtCount = 0) {
    for (let i = 1; i <= courtCount; i++) {
      this.addCourt(i);
    }
  }

  addCourt(id: number): Court {
    if (this.courts.has(id)) {
      throw new Error(`Court ${id} already exists`);
    }
    const court = new Court(id);
    this.courts.set(id, court);
    return court;
  }

  getCourt(id: number): Court {
    const court = this.courts.get(id);
    if (!court) throw new Error(`Court ${id} not found`);
    return court;
  }

  hasCourt(id: number): boolean {
    return this.courts.has(id);
  }

  listCourts(): Court[] {
    return [...this.courts.values()].sort((a, b) => a.id - b.id);
  }
}
