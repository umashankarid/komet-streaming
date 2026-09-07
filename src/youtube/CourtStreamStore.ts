import type Database from "better-sqlite3";

/**
 * Persists one reusable YouTube liveStream per court, so we do not create a new
 * stream for every broadcast (which burns API quota and litters the channel).
 * Each court keeps a stable stream id + its RTMP push URL; matches create only
 * a new broadcast bound to that stream (spec section 4).
 */
export interface CourtStream {
  courtId: number;
  streamId: string;
  rtmpUrl: string;
  createdAt: number;
}

interface Row {
  court_id: number;
  stream_id: string;
  rtmp_url: string;
  created_at: number;
}

export class CourtStreamStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS court_stream (
        court_id   INTEGER PRIMARY KEY,
        stream_id  TEXT NOT NULL,
        rtmp_url   TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  get(courtId: number): CourtStream | undefined {
    const row = this.db
      .prepare(
        `SELECT court_id, stream_id, rtmp_url, created_at
         FROM court_stream WHERE court_id = ?`,
      )
      .get(courtId) as Row | undefined;
    if (!row) return undefined;
    return {
      courtId: row.court_id,
      streamId: row.stream_id,
      rtmpUrl: row.rtmp_url,
      createdAt: row.created_at,
    };
  }

  save(courtId: number, streamId: string, rtmpUrl: string, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO court_stream (court_id, stream_id, rtmp_url, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(court_id) DO UPDATE SET
           stream_id = excluded.stream_id,
           rtmp_url = excluded.rtmp_url,
           created_at = excluded.created_at`,
      )
      .run(courtId, streamId, rtmpUrl, now);
  }

  clear(courtId: number): void {
    this.db.prepare(`DELETE FROM court_stream WHERE court_id = ?`).run(courtId);
  }
}
