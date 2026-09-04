import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type Database from "better-sqlite3";

/**
 * Persists the connected YouTube account for the control plane. The refresh
 * token is the only long-lived secret; it is encrypted at rest with
 * AES-256-GCM (PROJECT_RULES 18 — secrets never stored in plaintext, never
 * sent to the frontend). Everything else (channel id/title, timestamps) is
 * plain metadata safe to show in the UI.
 *
 * Single-account model for the MVP: one row, id = 1.
 */

export interface YouTubeAccount {
  channelId: string;
  channelTitle: string;
  refreshToken: string;
  connectedAt: number;
  updatedAt: number;
}

/** Public view returned to the browser — never includes the refresh token. */
export interface YouTubeAccountPublic {
  connected: boolean;
  channelId?: string;
  channelTitle?: string;
  connectedAt?: number;
}

interface StoredRow {
  channel_id: string;
  channel_title: string;
  token_cipher: string; // "iv:tag:ciphertext" hex
  connected_at: number;
  updated_at: number;
}

/** Derive a 32-byte AES key from the provided secret (any length). */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Encrypt plaintext to "ivHex:tagHex:cipherHex" using AES-256-GCM. */
export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/** Decrypt "ivHex:tagHex:cipherHex" produced by encryptSecret. */
export function decryptSecret(payload: string, secret: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Malformed encrypted secret");
  }
  const key = deriveKey(secret);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export class YouTubeTokenStore {
  private readonly db: Database.Database;
  private readonly encryptionKey: string;

  constructor(db: Database.Database, encryptionKey: string) {
    if (!encryptionKey) {
      throw new Error("TOKEN_ENCRYPTION_KEY is required for the token store");
    }
    this.db = db;
    this.encryptionKey = encryptionKey;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS youtube_account (
        id            INTEGER PRIMARY KEY CHECK (id = 1),
        channel_id    TEXT NOT NULL,
        channel_title TEXT NOT NULL,
        token_cipher  TEXT NOT NULL,
        connected_at  INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
    `);
  }

  /** Upsert the connected account, encrypting the refresh token. */
  save(account: {
    channelId: string;
    channelTitle: string;
    refreshToken: string;
    now?: number;
  }): void {
    const now = account.now ?? Date.now();
    const cipher = encryptSecret(account.refreshToken, this.encryptionKey);
    const existing = this.db
      .prepare(`SELECT connected_at FROM youtube_account WHERE id = 1`)
      .get() as { connected_at: number } | undefined;
    const connectedAt = existing?.connected_at ?? now;
    this.db
      .prepare(
        `INSERT INTO youtube_account
           (id, channel_id, channel_title, token_cipher, connected_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           channel_id = excluded.channel_id,
           channel_title = excluded.channel_title,
           token_cipher = excluded.token_cipher,
           updated_at = excluded.updated_at`,
      )
      .run(
        account.channelId,
        account.channelTitle,
        cipher,
        connectedAt,
        now,
      );
  }

  /** Full account incl. decrypted refresh token (server-side use only). */
  get(): YouTubeAccount | undefined {
    const row = this.db
      .prepare(
        `SELECT channel_id, channel_title, token_cipher, connected_at, updated_at
         FROM youtube_account WHERE id = 1`,
      )
      .get() as StoredRow | undefined;
    if (!row) return undefined;
    return {
      channelId: row.channel_id,
      channelTitle: row.channel_title,
      refreshToken: decryptSecret(row.token_cipher, this.encryptionKey),
      connectedAt: row.connected_at,
      updatedAt: row.updated_at,
    };
  }

  /** The decrypted refresh token, or undefined if not connected. */
  getRefreshToken(): string | undefined {
    return this.get()?.refreshToken;
  }

  /** Safe view for the frontend — no secrets. */
  publicStatus(): YouTubeAccountPublic {
    const row = this.db
      .prepare(
        `SELECT channel_id, channel_title, connected_at
         FROM youtube_account WHERE id = 1`,
      )
      .get() as
      | Pick<StoredRow, "channel_id" | "channel_title" | "connected_at">
      | undefined;
    if (!row) return { connected: false };
    return {
      connected: true,
      channelId: row.channel_id,
      channelTitle: row.channel_title,
      connectedAt: row.connected_at,
    };
  }

  isConnected(): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM youtube_account WHERE id = 1`)
      .get();
    return Boolean(row);
  }

  /** Disconnect: remove the stored account. */
  clear(): void {
    this.db.prepare(`DELETE FROM youtube_account WHERE id = 1`).run();
  }
}
