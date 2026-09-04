import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  YouTubeTokenStore,
  decryptSecret,
  encryptSecret,
} from "./YouTubeTokenStore.js";

const KEY = "test-encryption-key";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value", () => {
    const enc = encryptSecret("1//super-secret-refresh", KEY);
    expect(enc).not.toContain("super-secret");
    expect(decryptSecret(enc, KEY)).toBe("1//super-secret-refresh");
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptSecret("x", KEY)).not.toBe(encryptSecret("x", KEY));
  });

  it("fails to decrypt with the wrong key", () => {
    const enc = encryptSecret("secret", KEY);
    expect(() => decryptSecret(enc, "wrong-key")).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-valid", KEY)).toThrow(/Malformed/);
  });
});

describe("YouTubeTokenStore", () => {
  let db: Database.Database;
  let store: YouTubeTokenStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new YouTubeTokenStore(db, KEY);
  });
  afterEach(() => db.close());

  it("requires an encryption key", () => {
    expect(() => new YouTubeTokenStore(db, "")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("starts disconnected", () => {
    expect(store.isConnected()).toBe(false);
    expect(store.publicStatus()).toEqual({ connected: false });
    expect(store.getRefreshToken()).toBeUndefined();
  });

  it("saves and retrieves an account with the token encrypted at rest", () => {
    store.save({
      channelId: "UC123",
      channelTitle: "BMK Komet",
      refreshToken: "1//refresh-abc",
      now: 1000,
    });
    expect(store.isConnected()).toBe(true);
    expect(store.getRefreshToken()).toBe("1//refresh-abc");

    // Raw DB row must not contain the plaintext token.
    const row = db
      .prepare("SELECT token_cipher FROM youtube_account WHERE id = 1")
      .get() as { token_cipher: string };
    expect(row.token_cipher).not.toContain("1//refresh-abc");
  });

  it("public status exposes channel info but never the token", () => {
    store.save({
      channelId: "UC123",
      channelTitle: "BMK Komet",
      refreshToken: "1//refresh-abc",
      now: 1000,
    });
    const pub = store.publicStatus();
    expect(pub).toEqual({
      connected: true,
      channelId: "UC123",
      channelTitle: "BMK Komet",
      connectedAt: 1000,
    });
    expect(JSON.stringify(pub)).not.toContain("refresh");
  });

  it("preserves connectedAt but updates updatedAt on re-save", () => {
    store.save({ channelId: "UC1", channelTitle: "A", refreshToken: "r1", now: 1000 });
    store.save({ channelId: "UC1", channelTitle: "A", refreshToken: "r2", now: 5000 });
    const acct = store.get();
    expect(acct?.connectedAt).toBe(1000);
    expect(acct?.updatedAt).toBe(5000);
    expect(acct?.refreshToken).toBe("r2");
  });

  it("clears the account on disconnect", () => {
    store.save({ channelId: "UC1", channelTitle: "A", refreshToken: "r1" });
    store.clear();
    expect(store.isConnected()).toBe(false);
    expect(store.get()).toBeUndefined();
  });
});
