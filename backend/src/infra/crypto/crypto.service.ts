import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import { authConfig } from '@/config/app.config';

export const PREFIX = 'enc:';

/**
 * ⚠️ ADDING A NAME HERE IS NOT THE WHOLE JOB — the dashboard keeps its own copy.
 *
 * `omnidesk-console/utils/secretMask.ts` → `AUDIT_SENSITIVE_FIELDS` decides
 * what the audit page blanks out on screen. It cannot import from this repo, so
 * the two lists are kept in step BY HAND.
 *
 * What goes wrong when only this side is updated: the new field is encrypted at
 * rest and masked on `GET /hook/:id` as it should be — but an audit row that
 * recorded it still renders its VALUE in full, on a page admins open casually.
 * Nothing fails, nothing warns, and no test goes red; the leak is silent.
 * เพิ่มชื่อที่นี่แล้วต้องไปเพิ่มฝั่ง FE ด้วยเสมอ ไม่งั้นค่าลับขึ้นหน้า audit เงียบ ๆ
 *
 * Deliberately a note and not a cross-repo test: a test that reads the other
 * repo can only skip itself wherever that checkout is absent, and a test that
 * skips while reporting green is the failure mode we removed on 29/08.
 */
export const SENSITIVE_FIELDS: string[] = [
  'line_key',
  'line_secret',
  'custom_ai_key',
  // [FEAT-20260904-VENDORSECCOL] the SECOND vendor's key (DeepSeek). Same list,
  // same treatment: encrypted at rest, SECRET_MASK on read, never searchable.
  'custom_ai_key_sec',
  'telegram_key',
  'slip_verify_key',
  'external_password',
  'channel_secret',
  'access_token',
  'customer_link_password',
  'api_key',
];

export interface TryDecryptSecretResult {
  ok: boolean;
  value: string | null;
  reason?: string;
}

/**
 * Encrypts and decrypts `enc:`-prefixed secrets stored at rest.
 *
 * Implements AES-256-GCM encryption using standard key derivation from authConfig.encryptionKey
 * and transparent fallback to process.env.ENCRYPTION_KEY_OLD if set.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private keysCache: Buffer[] | null = null;
  private keysCacheSig: string | null = null;
  private readonly decryptFailLog = new Map<string, number>();

  constructor(
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  private getKeys(): Buffer[] {
    const cur = this.config.encryptionKey;
    const old = process.env.ENCRYPTION_KEY_OLD;
    const sig = `${cur === undefined ? ' ' : cur} ${old === undefined ? ' ' : old}`;

    if (this.keysCache && this.keysCacheSig === sig) {
      return this.keysCache;
    }

    const keys: Buffer[] = [];
    for (const raw of [cur, old]) {
      if (raw && typeof raw === 'string' && raw.length > 0) {
        keys.push(createHash('sha256').update(raw).digest());
      }
    }

    if (keys.length === 0) {
      throw new Error('ENCRYPTION_KEY is not set');
    }

    this.keysCache = keys;
    this.keysCacheSig = sig;
    return keys;
  }

  private getKey(): Buffer {
    const keys = this.getKeys();
    const key = keys[0];
    if (!key) {
      throw new Error('ENCRYPTION_KEY is not set');
    }
    return key;
  }

  encrypt(text: string | null | undefined): string | null | undefined {
    if (!text || typeof text !== 'string') return text;
    if (text.startsWith(PREFIX)) return text;
    const key = this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return (
      PREFIX +
      [iv, encrypted, tag].map((b) => b.toString('base64url')).join('.')
    );
  }

  decrypt(text: string): string {
    if (!text || typeof text !== 'string') return text;
    if (!text.startsWith(PREFIX)) return text;
    const parts = text.slice(PREFIX.length).split('.');
    const part0 = parts[0];
    const part1 = parts[1];
    const part2 = parts[2];
    if (parts.length !== 3 || !part0 || !part1 || !part2) return text;

    const iv = Buffer.from(part0, 'base64url');
    const encrypted = Buffer.from(part1, 'base64url');
    const tag = Buffer.from(part2, 'base64url');

    const keys = this.getKeys();
    let lastErr: Error | undefined;
    for (const key of keys) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]).toString('utf8');
      } catch (err) {
        lastErr = err as Error;
      }
    }
    throw lastErr || new Error('decrypt failed: no candidate key matched');
  }

  logDecryptFailure(text: string, err: unknown): void {
    try {
      const fp = createHash('sha256').update(text).digest('hex').slice(0, 12);
      const now = Date.now();
      const last = this.decryptFailLog.get(fp) || 0;
      if (now - last < 60000) return;
      this.decryptFailLog.set(fp, now);
      const hasOld = !!process.env.ENCRYPTION_KEY_OLD;
      const errMsg = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(
        `[DECRYPT] FAILED to decrypt enc value (fp=${fp}, len=${text.length}) with current` +
          `${hasOld ? '+old' : ''} ENCRYPTION_KEY -> wrong key or corrupted ciphertext. ` +
          `${hasOld ? '' : 'If the key was changed, set ENCRYPTION_KEY_OLD to the previous value. '}` +
          `(${errMsg})`,
      );
    } catch {
      // logging must never throw
    }
  }

  safeDecrypt(text: string | null | undefined): string | null | undefined {
    if (!text || typeof text !== 'string') return text;
    if (!text.startsWith(PREFIX)) return text;
    try {
      return this.decrypt(text);
    } catch (err) {
      this.logDecryptFailure(text, err);
      return text;
    }
  }

  tryDecryptSecret(text: string | null | undefined): TryDecryptSecretResult {
    if (!text || typeof text !== 'string')
      return { ok: true, value: text || null };
    if (!text.startsWith(PREFIX)) return { ok: true, value: text };
    try {
      return { ok: true, value: this.decrypt(text) };
    } catch (err) {
      this.logDecryptFailure(text, err);
      return { ok: false, value: null, reason: 'undecryptable' };
    }
  }

  isEncrypted(text: unknown): boolean {
    return typeof text === 'string' && text.startsWith(PREFIX);
  }

  encryptHookFields<T extends Record<string, unknown>>(
    obj: T | null | undefined,
  ): T | null | undefined {
    if (!obj) return obj;
    const result = { ...obj };
    for (const field of SENSITIVE_FIELDS) {
      const val = result[field];
      if (val !== undefined && val !== null && typeof val === 'string') {
        result[field as keyof T] = this.encrypt(val) as T[keyof T];
      }
    }
    return result;
  }

  decryptHookFields<T extends Record<string, unknown>>(
    obj: T | null | undefined,
  ): (T & Record<string, unknown>) | null | undefined {
    if (!obj) return obj;
    const objWithToObject = obj as unknown as {
      toObject?: () => Record<string, unknown>;
    };
    const raw =
      typeof objWithToObject.toObject === 'function'
        ? objWithToObject.toObject()
        : { ...obj };
    const result: Record<string, unknown> = { ...raw };
    for (const field of SENSITIVE_FIELDS) {
      const val = result[field];
      if (val && typeof val === 'string') {
        result[field] = this.safeDecrypt(val);
      }
    }
    if (!result.channel_id && result.line_id)
      result.channel_id = result.line_id;
    if (!result.channel_secret && result.line_secret)
      result.channel_secret = result.line_secret;
    if (!result.access_token && result.line_key)
      result.access_token = result.line_key;
    return result as T & Record<string, unknown>;
  }
}
