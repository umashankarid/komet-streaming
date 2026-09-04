import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Simple single-user authentication for the MVP (Rule 7: manual workflow first).
 * Passwords are hashed with scrypt (Node built-in — no native deps). Credentials
 * come from environment variables and are never committed.
 */

export interface AuthConfig {
  username: string;
  /** scrypt hash in the form "salt:hashHex". */
  passwordHash: string;
}

const KEYLEN = 64;

/** Hash a plaintext password into a "salt:hash" string for storage/env. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

/** Constant-time verify a plaintext password against a stored "salt:hash". */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, KEYLEN);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Check a username/password against the configured credentials.
 * Both fields are compared; username mismatch still runs the hash to reduce
 * timing signal about which field was wrong.
 */
export function checkCredentials(
  config: AuthConfig,
  username: string,
  password: string,
): boolean {
  const passwordOk = verifyPassword(password, config.passwordHash);
  const userOk =
    username.length === config.username.length &&
    timingSafeEqual(Buffer.from(username), Buffer.from(config.username));
  return userOk && passwordOk;
}

/**
 * Load auth config from environment. Accepts either a pre-computed
 * ADMIN_PASSWORD_HASH ("salt:hash") or a plaintext ADMIN_PASSWORD (hashed at
 * startup — convenient but the hash form is preferred for production).
 */
export function authConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const username = env.ADMIN_USER ?? "admin";
  if (env.ADMIN_PASSWORD_HASH) {
    return { username, passwordHash: env.ADMIN_PASSWORD_HASH };
  }
  if (env.ADMIN_PASSWORD) {
    return { username, passwordHash: hashPassword(env.ADMIN_PASSWORD) };
  }
  throw new Error(
    "Auth not configured: set ADMIN_PASSWORD_HASH (preferred) or ADMIN_PASSWORD",
  );
}
