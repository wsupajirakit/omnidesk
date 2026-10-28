import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { CryptoService, PREFIX } from './crypto.service';

export const CHECK_FIELDS = [
  'channel_secret',
  'line_secret',
  'line_key',
  'access_token',
  'custom_ai_key',
  // [FEAT-20260904-VENDORSECCOL] audited at boot like every other stored secret.
  'custom_ai_key_sec',
  'telegram_key',
  'slip_verify_key',
  'external_password',
];

export interface SecretSourceRow {
  id: string;
  fields: Record<string, unknown>;
}

export interface SecretSource {
  label: string;
  load: () => Promise<SecretSourceRow[]>;
}

/**
 * Boot-time audit that stored secrets in database hook records can decrypt cleanly.
 * Advisory-only; never crashes application startup.
 */
@Injectable()
export class SecretSelfCheckService {
  private readonly logger = new Logger(SecretSelfCheckService.name);
  private readonly extraSources: SecretSource[] = [];

  constructor(
    private readonly cryptoService: CryptoService,
    @Optional() @InjectConnection() private readonly connection?: Connection,
  ) {}

  registerSecretSource(source: SecretSource): void {
    if (source && typeof source.load === 'function') {
      this.extraSources.push(source);
    }
  }

  private isEncValue(v: unknown): boolean {
    return typeof v === 'string' && v.startsWith(PREFIX);
  }

  async runExtraSource(source: SecretSource): Promise<void> {
    let totalEnc = 0;
    let failed = 0;
    const failedRows: string[] = [];
    const rows = await source.load();
    for (const row of rows || []) {
      const bad: string[] = [];
      for (const [field, val] of Object.entries(row.fields || {})) {
        if (!this.isEncValue(val)) continue;
        totalEnc++;
        try {
          this.cryptoService.decrypt(val as string);
        } catch {
          failed++;
          bad.push(field);
        }
      }
      if (bad.length) failedRows.push(`${row.id}: ${bad.join(', ')}`);
    }
    if (failed === 0) {
      this.logger.log(
        `[SECRET-SELFCHECK:${source.label}] OK — decrypted ${totalEnc} field(s) across ${(rows || []).length} row(s).`,
      );
    } else {
      this.logger.error(
        `[SECRET-SELFCHECK:${source.label}] CRITICAL — ${failed} field(s) undecryptable -> ${failedRows.join(' | ')}`,
      );
    }
  }

  async runSecretSelfCheck(): Promise<void> {
    try {
      if (!this.connection || Number(this.connection.readyState) !== 1) {
        this.logger.warn(
          '[SECRET-SELFCHECK] skipped (Mongo connection not ready)',
        );
      } else {
        const collection = this.connection.collection('line_chat_bots');
        const projection: Record<string, number> = { alias: 1 };
        for (const field of CHECK_FIELDS) {
          projection[field] = 1;
        }
        const hooks = (await collection
          .find({}, { projection })
          .toArray()) as Record<string, unknown>[];

        let totalEnc = 0;
        let failed = 0;
        const failedHooks: string[] = [];

        for (const hook of hooks) {
          const badFields: string[] = [];
          for (const field of CHECK_FIELDS) {
            const val = hook[field];
            if (!this.isEncValue(val)) continue;
            totalEnc++;
            try {
              this.cryptoService.decrypt(val as string);
            } catch {
              failed++;
              badFields.push(field);
            }
          }
          if (badFields.length) {
            const hookId = hook._id as
              { toString(): string } | string | null | undefined;
            const idOrAlias =
              (hook.alias as string) || (hookId ? String(hookId) : 'unknown');
            failedHooks.push(`${idOrAlias}: ${badFields.join(', ')}`);
          }
        }

        if (failed === 0) {
          this.logger.log(
            `[SECRET-SELFCHECK] OK — decrypted ${totalEnc} encrypted secret field(s) across ${hooks.length} hook(s) with the current key.`,
          );
        } else {
          this.logger.error(
            `[SECRET-SELFCHECK] CRITICAL — ${failed} encrypted field(s) across ${failedHooks.length} hook(s) ` +
              `CANNOT be decrypted with the current ENCRYPTION_KEY. These will cause 401 / failed replies. ` +
              `${process.env.ENCRYPTION_KEY_OLD ? '' : 'Set ENCRYPTION_KEY_OLD to the previous key, or re-save the hook to re-encrypt. '}` +
              `Affected -> ${failedHooks.join(' | ')}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `[SECRET-SELFCHECK] skipped (error running audit): ${(err as Error).message}`,
      );
    }

    for (const source of this.extraSources) {
      try {
        await this.runExtraSource(source);
      } catch (err) {
        this.logger.error(
          `[SECRET-SELFCHECK:${source.label || '?'}] skipped (error): ${(err as Error).message}`,
        );
      }
    }
  }
}
