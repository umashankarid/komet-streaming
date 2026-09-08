import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScorerTokenStore } from "./ScorerTokenStore.js";

describe("ScorerTokenStore", () => {
  let db: Database.Database;
  let store: ScorerTokenStore;
  beforeEach(() => {
    db = new Database(":memory:");
    store = new ScorerTokenStore(db);
  });
  afterEach(() => db.close());

  it("has no token until issued", () => {
    expect(store.get(1)).toBeUndefined();
    expect(store.isValid(1, "anything")).toBe(false);
  });

  it("ensure creates a token once and returns the same one", () => {
    const t1 = store.ensure(1);
    const t2 = store.ensure(1);
    expect(t1).toBe(t2);
    expect(t1).toMatch(/^[a-f0-9]{32}$/);
  });

  it("validates the correct token only for the right court", () => {
    const t = store.ensure(1);
    expect(store.isValid(1, t)).toBe(true);
    expect(store.isValid(1, "wrong")).toBe(false);
    expect(store.isValid(2, t)).toBe(false); // different court
    expect(store.isValid(1, undefined)).toBe(false);
  });

  it("rotate replaces the token (old link invalid)", () => {
    const old = store.ensure(1);
    const fresh = store.rotate(1);
    expect(fresh).not.toBe(old);
    expect(store.isValid(1, old)).toBe(false);
    expect(store.isValid(1, fresh)).toBe(true);
  });

  it("keeps separate tokens per court", () => {
    const a = store.ensure(1);
    const b = store.ensure(2);
    expect(a).not.toBe(b);
    expect(store.isValid(1, a)).toBe(true);
    expect(store.isValid(2, b)).toBe(true);
  });

  it("clears a token", () => {
    store.ensure(1);
    store.clear(1);
    expect(store.get(1)).toBeUndefined();
  });
});
