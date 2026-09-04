import { describe, expect, it } from "vitest";
import {
  authConfigFromEnv,
  checkCredentials,
  hashPassword,
  verifyPassword,
} from "./auth.js";

describe("password hashing", () => {
  it("hashes to a salt:hash string and verifies correctly", () => {
    const stored = hashPassword("s3cret!");
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyPassword("s3cret!", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("produces different salts each time", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("returns false for malformed stored hashes", () => {
    expect(verifyPassword("x", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });
});

describe("checkCredentials", () => {
  const config = { username: "admin", passwordHash: hashPassword("pw") };

  it("accepts correct username and password", () => {
    expect(checkCredentials(config, "admin", "pw")).toBe(true);
  });

  it("rejects wrong password", () => {
    expect(checkCredentials(config, "admin", "nope")).toBe(false);
  });

  it("rejects wrong username", () => {
    expect(checkCredentials(config, "root", "pw")).toBe(false);
  });
});

describe("authConfigFromEnv", () => {
  it("uses ADMIN_PASSWORD_HASH when provided", () => {
    const hash = hashPassword("pw");
    const cfg = authConfigFromEnv({
      ADMIN_USER: "boss",
      ADMIN_PASSWORD_HASH: hash,
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ username: "boss", passwordHash: hash });
  });

  it("hashes ADMIN_PASSWORD when only plaintext is given", () => {
    const cfg = authConfigFromEnv({
      ADMIN_PASSWORD: "pw",
    } as NodeJS.ProcessEnv);
    expect(cfg.username).toBe("admin"); // default username
    expect(verifyPassword("pw", cfg.passwordHash)).toBe(true);
  });

  it("throws when no credentials are configured", () => {
    expect(() => authConfigFromEnv({} as NodeJS.ProcessEnv)).toThrow(
      /Auth not configured/,
    );
  });
});
