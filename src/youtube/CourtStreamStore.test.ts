import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CourtStreamStore } from "./CourtStreamStore.js";

describe("CourtStreamStore", () => {
  let db: Database.Database;
  let store: CourtStreamStore;
  beforeEach(() => {
    db = new Database(":memory:");
    store = new CourtStreamStore(db);
  });
  afterEach(() => db.close());

  it("returns undefined for an unknown court", () => {
    expect(store.get(1)).toBeUndefined();
  });

  it("saves and retrieves a court's reusable stream", () => {
    store.save(1, "stream-1", "rtmp://a/live2/key1", 1000);
    expect(store.get(1)).toEqual({
      courtId: 1,
      streamId: "stream-1",
      rtmpUrl: "rtmp://a/live2/key1",
      createdAt: 1000,
    });
  });

  it("upserts on repeated save for the same court", () => {
    store.save(1, "s1", "rtmp://a/live2/k1", 1000);
    store.save(1, "s2", "rtmp://a/live2/k2", 2000);
    expect(store.get(1)).toMatchObject({ streamId: "s2", rtmpUrl: "rtmp://a/live2/k2" });
  });

  it("keeps separate streams per court", () => {
    store.save(1, "s1", "rtmp://a/live2/k1");
    store.save(2, "s2", "rtmp://a/live2/k2");
    expect(store.get(1)?.streamId).toBe("s1");
    expect(store.get(2)?.streamId).toBe("s2");
  });

  it("clears a court's stream", () => {
    store.save(1, "s1", "rtmp://a/live2/k1");
    store.clear(1);
    expect(store.get(1)).toBeUndefined();
  });
});
