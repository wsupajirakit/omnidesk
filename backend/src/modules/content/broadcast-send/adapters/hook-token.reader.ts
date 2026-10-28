/**
 * [FEAT-20260822-BCASTTOKEN] Where a channel access token actually comes from.
 * ===========================================================================
 * 🔴 THE FIELD NAME IS NOT A GUESS, AND MUST NEVER BECOME ONE.
 *
 * `dev-local §4b` records what this exact question already cost: a reader was
 * written against `hook['line_key']` because the SOURCE said so, the live rows
 * keep the token in `access_token`, and the feature answered "Line access token
 * is required" to the owner. One `findOne` would have shown it.
 *
 * So the precedence below is not invented here — it is copied from the path
 * that is sending real broadcasts today (`broadcasts.service.ts:661-665`):
 *
 *     access_token ?? line_key   →   safeDecrypt   →   '' when absent
 *
 * MEASURED, not assumed (dev, 2026-08-22): 10 hook rows · 8 carry a non-empty
 * `access_token` (274 chars) · **0 carry `line_key` at all**. So the fallback is
 * dead in this environment — and it stays anyway, because stg and prod were not
 * measured, and the live sender keeps it. Dropping a fallback on the strength
 * of one environment is how an OA stops sending with nobody noticing.
 * วัดจาก dev เท่านั้น ⇒ ยังไม่ตัด fallback ทิ้ง.
 *
 * ⚠️ Returning `''` is deliberate and safe: core answers `{ok:false,status:0}`
 *    and makes NO call, so a missing token costs one legible failed chunk
 *    instead of an exception in the middle of a campaign.
 *
 * revert: delete this file and drop it from `adapters/index.ts`.
 */
import type { HookTokenReader } from '../sinks/inline.sink';

/** Just enough of the hook row to answer the question. */
export interface HookTokenRow {
  readonly access_token?: unknown;
  readonly line_key?: unknown;
}

/** The two seams: how a row is fetched, and how a stored value is decrypted. */
export interface HookTokenDeps {
  findHook(hookId: string): Promise<HookTokenRow | null>;
  safeDecrypt(value: string): string;
}

/**
 * Reads the token for one OA, and remembers it for the run.
 *
 * The cache is per-instance and a run builds one instance, so it lives exactly
 * as long as the campaign: a 20-OA run does 20 reads, not 20,000. A token that
 * is rotated mid-run keeps the old value until the next run — correct, because
 * a run that started under one token should not half-switch to another.
 */
export class MongoHookTokenReader implements HookTokenReader {
  private readonly cache = new Map<string, string>();

  constructor(private readonly deps: HookTokenDeps) {}

  async tokenFor(hookId: string): Promise<string> {
    const hit = this.cache.get(hookId);
    if (hit !== undefined) return hit;

    const token = await this.read(hookId);
    this.cache.set(hookId, token);
    return token;
  }

  private async read(hookId: string): Promise<string> {
    try {
      const hook = await this.deps.findHook(hookId);
      if (!hook) return '';

      // access_token first, line_key for rows that predate it.
      const stored = hook.access_token ?? hook.line_key;
      if (typeof stored !== 'string' || stored === '') return '';

      return this.deps.safeDecrypt(stored) || '';
    } catch {
      // A read or a decrypt that throws is a token we do not have. The chunk
      // fails legibly; the campaign carries on. อ่านไม่ได้ = ไม่มี token ไม่ใช่ crash.
      return '';
    }
  }
}
