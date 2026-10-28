/**
 * [FEAT-20260918-TRANSLATETIMEOUT] 30 seconds, both directions, changeable.
 * =============================================================================
 * Owner, 18/09: *"กำหนด timeout ด้วย เข้าและออก 30 วิ (เผื่อแก้ไขอนาคต) = timeout แล้ว
 * fallback เลย"*.
 *
 * Two things have to stay true and they pull in opposite directions:
 *   · the translate lane stalls out at 30s, and an operator can change that
 *     without a code edit;
 *   · the webhook REPLY lane keeps its 45s, because its budget is measured
 *     against `REPLY_STALE_MS` and a shorter ceiling cuts off real answers.
 * A single shared constant cannot do both, which is why the override exists —
 * and why the second half of this file guards the constant it did NOT move.
 */

import { translateTimeoutMs } from '@/modules/ai-translate/translate-http-timeout';
import { AI_HTTP_TIMEOUT_MS } from '@/modules/ai-vendor';
import { validateEnv } from '@/config/env.schema';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* The three keys the schema actually requires, so a case can build a valid
   environment without listing sixty. Placeholders — nothing here connects to
   anything. Same shape `ai-translate-languages.spec.ts` uses. */
const BASE = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/not-a-real-db',
  JWT_SECRET: 'unit-test-not-a-real-secret',
  ENCRYPTION_KEY: 'unit-test-not-a-real-key',
} as const;

describe('[FEAT-20260918-TRANSLATETIMEOUT] the translate ceiling', () => {
  it('is 30 seconds when nobody configured one', () => {
    validateEnv({ ...BASE });

    expect(translateTimeoutMs()).toBe(30_000);
  });

  it('follows the environment, so it can change without a code edit', () => {
    validateEnv({ ...BASE, AI_TRANSLATE_TIMEOUT_MS: '15000' });

    expect(translateTimeoutMs()).toBe(15_000);
  });

  it('🔴 is NOT the shared vendor ceiling — the reply lane keeps 45s', () => {
    validateEnv({ ...BASE });

    // If these two ever become the same number by accident, the split that
    // protects the customer-reply lane has quietly been undone.
    expect(AI_HTTP_TIMEOUT_MS).toBe(45_000);
    expect(translateTimeoutMs()).not.toBe(AI_HTTP_TIMEOUT_MS);
    expect(translateTimeoutMs()).toBeLessThan(AI_HTTP_TIMEOUT_MS);
  });

  it('🔴 NEVER throws when the config is not available — it falls back', () => {
    /* The first version called `getValidatedEnv()` bare. 24 cases across two
       suites went red with `errorMessage: "Environment accessed before
       validation"` and `httpStatus: 0`: the transports catch around their vendor
       call, so the throw was reshaped into a VENDOR ERROR and every translation
       would have blamed a vendor that was never contacted.
       อ่าน config ไม่ได้ ห้ามกลายเป็น "vendor พัง" */
    jest.resetModules();
    jest.isolateModules(() => {
      const fresh =
        require('@/modules/ai-translate/translate-http-timeout') as {
          translateTimeoutMs: () => number;
        };
      expect(() => fresh.translateTimeoutMs()).not.toThrow();
      expect(fresh.translateTimeoutMs()).toBe(30_000);
    });
  });

  it('the fallback matches the schema default — two copies, one number', () => {
    validateEnv({ ...BASE });
    const fromSchema = translateTimeoutMs();
    const src = readFileSync(
      resolve(
        __dirname,
        '../../src/modules/ai-translate/translate-http-timeout.ts',
      ),
      'utf8',
    );

    expect(src).toContain('const DEFAULT_TRANSLATE_TIMEOUT_MS = 30_000;');
    expect(fromSchema).toBe(30_000);
  });

  it('is read per call, not frozen at import', () => {
    validateEnv({ ...BASE, AI_TRANSLATE_TIMEOUT_MS: '20000' });
    const first = translateTimeoutMs();
    validateEnv({ ...BASE, AI_TRANSLATE_TIMEOUT_MS: '25000' });
    const second = translateTimeoutMs();

    expect(first).toBe(20_000);
    expect(second).toBe(25_000);
  });
});

describe('[FEAT-20260918-TRANSLATETIMEOUT] both directions actually use it', () => {
  /* Source-level, deliberately: the transports build an axios options object and
     hand it to a shared door, so the only way to prove the override is present
     without a live HTTP call is to read the call site. A vendor added later that
     forgets the override would slip past a behavioural test that only drives the
     two that exist today. ทั้งสอง vendor ต้องใส่เพดานนี้ ไม่ใช่แค่ตัวที่เทสอยู่ */
  const read = (f: string) =>
    readFileSync(
      resolve(__dirname, '../../src/modules/ai-translate/vendors', f),
      'utf8',
    );

  it.each(['deepseek-translate.transport.ts', 'gemini-translate.transport.ts'])(
    '%s overrides the ceiling on its vendor call',
    (file) => {
      const src = read(file);

      expect(src).toContain('timeout: translateTimeoutMs()');
      expect(src).toContain("from '../translate-http-timeout'");
    },
  );

  it('neither transport hardcodes a number instead', () => {
    for (const file of [
      'deepseek-translate.transport.ts',
      'gemini-translate.transport.ts',
    ]) {
      const src = read(file);
      expect(src).not.toMatch(/timeout:\s*\d/);
    }
  });
});
