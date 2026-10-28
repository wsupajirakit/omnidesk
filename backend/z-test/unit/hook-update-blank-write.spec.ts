/**
 * [FIX-20260817-BLANKSECRET] `updateHook` end to end: what actually reaches
 * Mongo, and what the audit row is allowed to claim.
 *
 * The sibling spec (`hook-secret-blank-guard.spec.ts`) pins the four shared
 * handlers in isolation. This one runs the WHOLE method with stubbed models,
 * because three things only exist at that level and none of them were covered:
 *
 *   1. `slip_verify_key` and `external_password` are handled INLINE inside
 *      updateHook, not by the shared handlers — they had the same blank-wipe
 *      bug and were missed by the first pass of this fix.
 *   2. the update object handed to `findByIdAndUpdate` must not carry a value
 *      for a declined field (Mongoose skips `undefined`, so the stored secret
 *      survives — asserted here as "the key is undefined", which is the
 *      contract that keeps it alive).
 *   3. the audit row must not list a field the write declined, or the history
 *      screen reports a credential change that never happened. Removing that
 *      filter used to leave the entire suite green.
 *
 * ห้ามเขียนทับด้วยค่าว่าง · ห้าม audit สิ่งที่ไม่ได้เขียน
 */
// Deep import, matching the sibling hook specs (`hook-quota-token`,
// `clone-hook-cache-invalidate`): HooksService is not on the module barrel, and
// adding it there for a test would be a wiring decision, not a test detail.
// eslint-disable-next-line no-restricted-imports
import { HooksService } from '@/modules/hooks/hooks.service';

/** The private surface this spec drives, without reaching for `any`. */
type ServiceHarness = Record<string, unknown> & {
  updateHook: (
    id: string,
    body: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ) => Promise<unknown>;
};

const HOOK_ID = 'a0d00000000000000000002e';

/** Reversible stand-in for CryptoService — `plain:` marks "encrypted". */
const crypto = {
  encrypt: (v: string) => `plain:${v}`,
  safeDecrypt: (v: unknown) =>
    typeof v === 'string' && v.startsWith('plain:') ? v.slice(6) : v,
  // updateHook maps the RESULT through mapBangkokTime → decryptHookFields.
  // Pass the document through untouched: this spec is about what was WRITTEN,
  // and the read-back shape has its own coverage elsewhere.
  decryptHookFields: (d: unknown) => d,
};

interface RunResult {
  written: Record<string, unknown>;
  auditedFields: string[];
}

/** Runs the real updateHook against stubs and reports what it tried to write. */
async function runUpdate(body: Record<string, unknown>): Promise<RunResult> {
  const existing = {
    _id: HOOK_ID,
    alias: 'probe',
    group: 'grp1',
    channel_secret: 'plain:live-channel-secret',
    access_token: 'plain:live-access-token',
    custom_ai_key: 'plain:live-ai-key',
    slip_verify_key: 'plain:live-slip-key',
    external_password: 'plain:live-ext-pass',
    line_oa_name: 'before',
  };

  let written: Record<string, unknown> = {};
  const svc = Object.create(HooksService.prototype) as ServiceHarness;

  svc.crypto = crypto;
  svc.credentialCheck = {
    verifyCustomAiKey: jest.fn().mockResolvedValue(undefined),
    verifyLineKey: jest.fn().mockResolvedValue(undefined),
    verifyDocId: jest.fn().mockResolvedValue(undefined),
  };
  svc.hookModel = {
    findById: () => ({
      lean: () => ({ exec: () => Promise.resolve({ ...existing }) }),
    }),
    findByIdAndUpdate: (_id: string, updates: Record<string, unknown>) => {
      written = updates;
      // Mimic Mongoose: keys whose value is `undefined` are NOT applied.
      const applied = { ...existing };
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) (applied as Record<string, unknown>)[k] = v;
      }
      return { lean: () => ({ exec: () => Promise.resolve(applied) }) };
    },
  };
  svc.hookCache = { cacheHook: jest.fn().mockResolvedValue(undefined) };
  const audited: string[] = [];
  svc.auditLog = {
    writeInBackground: (payload: { changed_fields?: { field: string }[] }) => {
      for (const c of payload.changed_fields || []) audited.push(c.field);
    },
  };
  svc.isSuperUser = () => true;
  svc.ensureGroupAccess = () => undefined;
  svc.buildActor = () => ({ user_id: 'u1', username: 'op' });
  svc.buildRequestMeta = () => ({});
  svc.resolveGroupId = (v: unknown) => Promise.resolve(v);

  // [FIX-20260818-HOOKWRITESCOPE] `ensureGroupAccess` is stubbed out above, but
  // the allowlist tier is a free function and cannot be. This spec is about what
  // was WRITTEN, not about access, so the caller is a superadmin — which resolves
  // to "no filter" rather than needing the model stubbed for a group query.
  await svc.updateHook(HOOK_ID, body, {
    user: { userId: 'u1', roleName: 'superadmin' },
  });
  return { written, auditedFields: audited };
}

/** Every secret the OA edit form posts on a save, with the value it sends
 *  when the field never loaded. */
const BLANKABLE = [
  'channel_secret',
  'access_token',
  'custom_ai_key',
  'slip_verify_key',
  'external_password',
] as const;

describe('[FIX-20260817-BLANKSECRET] updateHook — a blank never reaches Mongo', () => {
  for (const field of BLANKABLE) {
    it(`${field}: '' is declined, so the stored value survives`, async () => {
      const { written } = await runUpdate({
        line_oa_name: 'after',
        [field]: '',
      });
      expect(written).toHaveProperty(field);
      expect(written[field]).toBeUndefined();
      // the unrelated field of the same save still lands
      expect(written['line_oa_name']).toBe('after');
    });

    it(`${field}: a declined write is NOT listed in the audit row`, async () => {
      const { auditedFields } = await runUpdate({
        line_oa_name: 'after',
        [field]: '',
      });
      expect(auditedFields).not.toContain(field);
      expect(auditedFields).toContain('line_oa_name');
    });

    it(`${field}: a real new value is written AND audited`, async () => {
      const { written, auditedFields } = await runUpdate({
        [field]: 'brand-new',
      });
      expect(written[field]).toBe('plain:brand-new');
      expect(auditedFields).toContain(field);
    });
  }

  it('the sentinel is stripped before anything else, so nothing is written', async () => {
    const { written, auditedFields } = await runUpdate({
      line_oa_name: 'after',
      channel_secret: '__SECRET_KEPT__',
    });
    expect(written).not.toHaveProperty('channel_secret');
    expect(auditedFields).not.toContain('channel_secret');
  });

  it('a save that ONLY carries a blank secret writes nothing and audits nothing', async () => {
    const { written, auditedFields } = await runUpdate({ custom_ai_key: '' });
    expect(written['custom_ai_key']).toBeUndefined();
    expect(auditedFields).toEqual([]);
  });
});

/* [FIX-20260817-MANGLEDMASK] A hand-edited placeholder must be REFUSED, not stored.
 *
 * Proven live before this guard existed: the edit form used to show the literal
 * `__SECRET_KEPT__` in an editable box, and an operator who touched that text
 * (deleted a char, added a space, typed after it) produced a value that missed
 * the exact-match strip and was ENCRYPTED AND WRITTEN over the real credential —
 * HTTP 200, no error. It killed demo-oa-three's channel_secret + access_token on
 * 17/08 and was recovered from the audit trail.
 *
 * The UI fix (locked inputs) removes the sentinel from every editable box; this
 * backend guard is the second layer, protecting every OTHER client: a value that
 * still looks like the placeholder is a mangled mask, never a real credential,
 * so the save fails loudly with 400 instead of silently destroying a key.
 * ค่าที่หน้าตาเหมือน placeholder = ของพัง ห้ามเขียนทับของจริง ต้อง 400
 */
describe('[FIX-20260817-MANGLEDMASK] a mangled placeholder is rejected with 400', () => {
  const MANGLED: Array<[string, string]> = [
    ['one char deleted', '__SECRET_K'],
    ['trailing space', '__SECRET_KEPT__ '],
    ['typed after it', '__SECRET_KEPT__x'],
    ['typed before it', 'x__SECRET_KEPT__'],
    ['truncated hard', '__SECRET'],
  ];

  for (const [label, value] of MANGLED) {
    it(`channel_secret = "${value}" (${label}) → 400, nothing written`, async () => {
      await expect(
        runUpdate({ line_oa_name: 'after', channel_secret: value }),
      ).rejects.toMatchObject({ status: 400 });
    });
  }

  it('every sensitive field rejects the mangled mask, not just channel_secret', async () => {
    for (const field of BLANKABLE) {
      await expect(
        runUpdate({ [field]: '__SECRET_KEPT__ ' }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it('telegram_key (masked but optional) rejects it too', async () => {
    await expect(
      runUpdate({ telegram_key: '__SECRET_K' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('the EXACT sentinel still means "keep" — stripped, never rejected', async () => {
    const { written } = await runUpdate({
      line_oa_name: 'after',
      channel_secret: '__SECRET_KEPT__',
    });
    expect(written['line_oa_name']).toBe('after');
    expect('channel_secret' in written).toBe(false);
  });

  it('a real secret that merely CONTAINS an underscore is untouched', async () => {
    const { written } = await runUpdate({
      channel_secret: 'real_secret_value_1',
    });
    expect(written['channel_secret']).toBe('plain:real_secret_value_1');
  });
});
