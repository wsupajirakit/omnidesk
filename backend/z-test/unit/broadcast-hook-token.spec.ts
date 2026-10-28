/**
 * [FEAT-20260822-BCASTTOKEN] The field-name trap, pinned.
 * ===========================================================================
 * `dev-local §4b` records that guessing this field name already broke a shipped
 * feature. These cases make the precedence a promise rather than a memory.
 */
import { MongoHookTokenReader, type HookTokenRow } from '@/modules/content';

const deps = (
  rows: Record<string, HookTokenRow | null>,
  decrypt: (v: string) => string = (v) => `plain(${v})`,
) => {
  const calls: string[] = [];
  return {
    calls,
    findHook: (id: string) => {
      calls.push(id);
      return Promise.resolve(rows[id] ?? null);
    },
    safeDecrypt: decrypt,
  };
};

describe('MongoHookTokenReader — access_token first, line_key for old rows', () => {
  it('🔴 reads access_token — the field the live rows actually carry', async () => {
    const d = deps({ h1: { access_token: 'ENC' } });
    expect(await new MongoHookTokenReader(d).tokenFor('h1')).toBe('plain(ENC)');
  });

  it('falls back to line_key, so rows that predate the rename still send', async () => {
    const d = deps({ h1: { line_key: 'OLD' } });
    expect(await new MongoHookTokenReader(d).tokenFor('h1')).toBe('plain(OLD)');
  });

  it('prefers access_token when a row somehow carries both', async () => {
    const d = deps({ h1: { access_token: 'NEW', line_key: 'OLD' } });
    expect(await new MongoHookTokenReader(d).tokenFor('h1')).toBe('plain(NEW)');
  });
});

describe('MongoHookTokenReader — a missing token is legible, never a crash', () => {
  it('answers empty for a hook that does not exist', async () => {
    expect(await new MongoHookTokenReader(deps({})).tokenFor('nope')).toBe('');
  });

  it('answers empty when the row has neither field', async () => {
    const d = deps({ h1: {} });
    expect(await new MongoHookTokenReader(d).tokenFor('h1')).toBe('');
  });

  it('answers empty for a blank stored value instead of decrypting it', async () => {
    const d = deps({ h1: { access_token: '' } });
    expect(await new MongoHookTokenReader(d).tokenFor('h1')).toBe('');
  });

  it('🔴 a read that THROWS is an empty token, not an exception mid-campaign', async () => {
    const reader = new MongoHookTokenReader({
      findHook: () => Promise.reject(new Error('mongo down')),
      safeDecrypt: (v) => v,
    });
    await expect(reader.tokenFor('h1')).resolves.toBe('');
  });

  it('🔴 a decrypt that THROWS is an empty token too', async () => {
    const d = deps({ h1: { access_token: 'ENC' } }, () => {
      throw new Error('bad key');
    });
    await expect(new MongoHookTokenReader(d).tokenFor('h1')).resolves.toBe('');
  });

  it('treats a decrypt that returns empty as no token', async () => {
    const d = deps({ h1: { access_token: 'ENC' } }, () => '');
    expect(await new MongoHookTokenReader(d).tokenFor('h1')).toBe('');
  });
});

describe('MongoHookTokenReader — one read per OA, not one per chunk', () => {
  it('caches, so a 500-chunk campaign does not read the hook 500 times', async () => {
    const d = deps({ h1: { access_token: 'ENC' } });
    const r = new MongoHookTokenReader(d);
    for (let i = 0; i < 20; i++) await r.tokenFor('h1');
    expect(d.calls).toEqual(['h1']);
  });

  it('caches the ABSENCE too — a broken hook is not retried every chunk', async () => {
    const d = deps({});
    const r = new MongoHookTokenReader(d);
    await r.tokenFor('h1');
    await r.tokenFor('h1');
    expect(d.calls).toEqual(['h1']);
  });

  it('keeps each OA separate', async () => {
    const d = deps({ h1: { access_token: 'A' }, h2: { access_token: 'B' } });
    const r = new MongoHookTokenReader(d);
    expect(await r.tokenFor('h1')).toBe('plain(A)');
    expect(await r.tokenFor('h2')).toBe('plain(B)');
  });
});
