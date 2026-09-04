import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { MatchSnapshot } from "../domain/Match.js";
import type { MatchOrchestrator } from "../domain/MatchOrchestrator.js";

/**
 * Persists the latest match snapshot per court to SQLite so state survives
 * restarts (Rule 12: recovery). This is a thin adapter: it subscribes to
 * orchestrator updates and upserts the JSON snapshot keyed by court id.
 */
export class SqliteStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS court_state (
        court_id   INTEGER PRIMARY KEY,
        snapshot   TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  save(courtId: number, snapshot: MatchSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO court_state (court_id, snapshot, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(court_id) DO UPDATE SET
           snapshot = excluded.snapshot,
           updated_at = excluded.updated_at`,
      )
      .run(courtId, JSON.stringify(snapshot), new Date().toISOString());
  }

  load(courtId: number): MatchSnapshot | undefined {
    const row = this.db
      .prepare(`SELECT snapshot FROM court_state WHERE court_id = ?`)
      .get(courtId) as { snapshot: string } | undefined;
    return row ? (JSON.parse(row.snapshot) as MatchSnapshot) : undefined;
  }

  loadAll(): MatchSnapshot[] {
    const rows = this.db
      .prepare(`SELECT snapshot FROM court_state ORDER BY court_id`)
      .all() as { snapshot: string }[];
    return rows.map((r) => JSON.parse(r.snapshot) as MatchSnapshot);
  }

  /** Subscribe the store to an orchestrator so every update is persisted. */
  bind(orch: MatchOrchestrator): () => void {
    return orch.onUpdate((courtId, snapshot) => this.save(courtId, snapshot));
  }

  close(): void {
    this.db.close();
  }
}
