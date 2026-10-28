/**
 * [FEAT-20260904-VENDORSECCOL] Each vendor reads its OWN two columns.
 * ============================================================================
 * Owner, 04/09: `ai_vendor` has three states — `null` / `gemini` behave exactly
 * as they do today and read `ai_model` + `custom_ai_key`; `deepseek` reads a
 * SECOND pair, `ai_model_sec` + `custom_ai_key_sec`. The Gemini knobs
 * (`gemini_top_k` / `_top_p` / `_thinking_budget`) are Gemini's and are not
 * touched by any of this.
 *
 * WHY A COLUMN AND NOT A BRANCH. `ai-vendors/resolve-vendor-key.ts` exists to
 * stop one vendor's credential reaching another, and it does that by ASKING
 * which vendor is active. Once the column itself says which vendor owns the
 * value, the leak stops being something to guard and becomes something that
 * cannot be expressed — `custom_ai_key` is Gemini's by definition, whatever
 * `ai_vendor` happens to say. คอลัมน์บอกค่ายในตัวเอง = รั่วข้ามค่ายไม่ได้ตั้งแต่ต้น
 *
 * 🔴 THE CASE THAT DID NOT EXIST BEFORE (T2 below): a DeepSeek hook that has a
 *    Gemini key but no DeepSeek key must REFUSE. Today it answers, because both
 *    vendors read the one column. That is the whole point of the split, so it
 *    gets the loudest case here.
 *
 * RED-FIRST: written against the tree BEFORE `resolve-vendor-fields.ts` exists.
 *
 * revert: delete this spec together with `resolve-vendor-fields.ts`.
 */

import {
  GEMINI_COLUMNS,
  DEEPSEEK_COLUMNS,
  resolveVendorColumns,
  resolveVendorPair,
} from '@/modules/hooks/ai-vendor/resolve-vendor-fields';
import { resolveVendorEnvKey } from '@/modules/webhook/ai-vendors/resolve-vendor-key';

describe('[VENDORSECCOL] which columns belong to which vendor', () => {
  it('T4 · gemini reads the original pair — unchanged from today', () => {
    expect(resolveVendorColumns('gemini')).toEqual(GEMINI_COLUMNS);
    expect(GEMINI_COLUMNS).toEqual({
      modelField: 'ai_model',
      keyField: 'custom_ai_key',
      // a keyless Gemini OA still answers on the shared env ladder
      hasSharedFallback: true,
    });
  });

  it('T5 · no vendor at all behaves exactly like gemini (old rows are safe)', () => {
    expect(resolveVendorColumns(null)).toEqual(GEMINI_COLUMNS);
    expect(resolveVendorColumns(undefined)).toEqual(GEMINI_COLUMNS);
    expect(resolveVendorColumns('')).toEqual(GEMINI_COLUMNS);
  });

  it('T1 · deepseek reads the second pair', () => {
    expect(resolveVendorColumns('deepseek')).toEqual(DEEPSEEK_COLUMNS);
    expect(DEEPSEEK_COLUMNS).toEqual({
      modelField: 'ai_model_sec',
      keyField: 'custom_ai_key_sec',
      // no env rung by owner rule — no key means it refuses
      hasSharedFallback: false,
    });
  });

  it('T7 · a vendor typo falls back to gemini — the SAME fallback the transport registry uses', () => {
    // An operator cannot save 'deepsek' through the API (`parseAiVendor`
    // rejects it), but a row written before that guard, or edited directly in
    // Mongo, can hold one. The registry answers such a row with the Gemini
    // transport, so the columns must agree — otherwise the request would go to
    // Google carrying DeepSeek's key.
    expect(resolveVendorColumns('deepsek')).toEqual(GEMINI_COLUMNS);
    expect(resolveVendorColumns('DEEPSEEK')).toEqual(GEMINI_COLUMNS);
  });

  it('the two column sets share no field name', () => {
    // If they ever did, one vendor's write would land on the other's value.
    const fieldsOf = (c: typeof GEMINI_COLUMNS) => [c.modelField, c.keyField];
    const gemini = fieldsOf(GEMINI_COLUMNS);
    const deepseek = fieldsOf(DEEPSEEK_COLUMNS);
    expect(gemini.filter((f) => deepseek.includes(f))).toEqual([]);
  });
});

describe('[VENDORSECCOL] reading the pair off a hook row', () => {
  /** A row carrying BOTH pairs — the shape that makes a leak visible. */
  const bothPairs = {
    ai_model: 'gemini-2.5-flash',
    custom_ai_key: 'GEMINI-OWN-KEY',
    ai_model_sec: 'deepseek-reasoner',
    custom_ai_key_sec: 'DEEPSEEK-OWN-KEY',
  };

  it('T3 · deepseek takes the deepseek model and the deepseek key, never the other', () => {
    expect(resolveVendorPair(bothPairs, 'deepseek')).toEqual({
      model: 'deepseek-reasoner',
      key: 'DEEPSEEK-OWN-KEY',
    });
  });

  it('T4b · gemini takes the gemini pair, and the SEC pair is invisible to it', () => {
    expect(resolveVendorPair(bothPairs, 'gemini')).toEqual({
      model: 'gemini-2.5-flash',
      key: 'GEMINI-OWN-KEY',
    });
    expect(resolveVendorPair(bothPairs, null)).toEqual({
      model: 'gemini-2.5-flash',
      key: 'GEMINI-OWN-KEY',
    });
  });

  it('🔴 T2 · a deepseek hook with ONLY a gemini key gets NO key — it must refuse, never borrow', () => {
    const geminiKeyOnly = {
      ai_model: 'gemini-2.5-flash',
      custom_ai_key: 'GEMINI-OWN-KEY',
    };
    expect(resolveVendorPair(geminiKeyOnly, 'deepseek')).toEqual({
      model: null,
      key: null,
    });
  });

  it('a missing / empty / blank column reads as null, never as an empty string', () => {
    // The caller decides "no key" by truthiness; an empty string that survived
    // this far would be handed to the transport as a Bearer token.
    expect(resolveVendorPair({}, 'deepseek')).toEqual({
      model: null,
      key: null,
    });
    expect(
      resolveVendorPair(
        { ai_model_sec: '   ', custom_ai_key_sec: '' },
        'deepseek',
      ),
    ).toEqual({ model: null, key: null });
  });

  it('a legacy row that predates both columns still answers as gemini', () => {
    expect(resolveVendorPair({ custom_ai_key: 'K' }, undefined)).toEqual({
      model: null,
      key: 'K',
    });
  });
});

describe('[VENDORSECCOL] hasSharedFallback matches the function that performs it', () => {
  /* 🔴 TWO COPIES OF ONE FACT, and they are in different modules on purpose:
     `resolveVendorEnvKey` lives under `webhook/` and does the fallback;
     `hasSharedFallback` lives under `hooks/` and is what the clone report asks,
     because `hooks` cannot import `webhook` (the reverse edge is a boot-fatal
     cycle). This spec is the only thing keeping them honest — it can import
     both. Change one side and this goes red.
     ข้อเท็จจริงเดียวกันอยู่สองที่เพราะ import ข้ามไม่ได้ · เทสนี้คือตัวมัดไว้ */
  const ENV = ['GEMINI_TEST_KEY', 'GEMINI_API_KEY'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV) {
      saved[k] = process.env[k];
      process.env[k] = 'a-shared-key';
    }
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });

  it('gemini can fall back, deepseek cannot — both tables agree', () => {
    expect(GEMINI_COLUMNS.hasSharedFallback).toBe(
      resolveVendorEnvKey('gemini') !== undefined,
    );
    expect(DEEPSEEK_COLUMNS.hasSharedFallback).toBe(
      resolveVendorEnvKey('deepseek') !== undefined,
    );
  });

  it('an unknown vendor and an absent one follow gemini on BOTH sides', () => {
    for (const v of [null, undefined, '', 'deepsek']) {
      expect(resolveVendorColumns(v).hasSharedFallback).toBe(
        resolveVendorEnvKey(v) !== undefined,
      );
    }
  });
});
