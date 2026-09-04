import { afterEach, describe, expect, it } from "vitest";
import { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import { SqliteStore } from "./SqliteStore.js";

const teams = {
  home: { players: [{ name: "A" }] },
  away: { players: [{ name: "B" }] },
};

describe("SqliteStore", () => {
  let store: SqliteStore;

  afterEach(() => {
    store?.close();
  });

  it("saves and loads a snapshot per court", () => {
    store = new SqliteStore(":memory:");
    const orch = new MatchOrchestrator();
    const snap = orch.createMatch({ courtId: 1, ...teams });
    store.save(1, snap);
    expect(store.load(1)).toMatchObject({ courtId: 1, status: "scheduled" });
    expect(store.load(99)).toBeUndefined();
  });

  it("upserts on repeated saves for the same court", () => {
    store = new SqliteStore(":memory:");
    const orch = new MatchOrchestrator();
    orch.createMatch({ courtId: 1, ...teams });
    orch.startMatch(1);
    const snap = orch.point(1, "home");
    store.save(1, snap);
    store.save(1, orch.point(1, "home"));
    expect(store.load(1)?.currentGame).toEqual({ home: 2, away: 0 });
    expect(store.loadAll()).toHaveLength(1);
  });

  it("persists every orchestrator update once bound", () => {
    store = new SqliteStore(":memory:");
    const orch = new MatchOrchestrator();
    store.bind(orch);
    orch.createMatch({ courtId: 2, ...teams });
    orch.startMatch(2);
    orch.point(2, "away");
    expect(store.load(2)?.currentGame).toEqual({ home: 0, away: 1 });
  });

  it("loadAll returns snapshots ordered by court id", () => {
    store = new SqliteStore(":memory:");
    const orch = new MatchOrchestrator();
    store.bind(orch);
    orch.createMatch({ courtId: 3, ...teams });
    orch.createMatch({ courtId: 1, ...teams });
    expect(store.loadAll().map((s) => s.courtId)).toEqual([1, 3]);
  });

  it("applies durability pragmas (busy_timeout, foreign_keys)", () => {
    // WAL is not available for :memory: dbs, but busy_timeout and
    // foreign_keys are and must be set for tournament durability.
    store = new SqliteStore(":memory:");
    expect(store.pragma("busy_timeout")).toBe(5000);
    expect(store.pragma("foreign_keys")).toBe(1);
  });
});
