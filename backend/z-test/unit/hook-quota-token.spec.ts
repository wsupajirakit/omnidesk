/* [FIX-20260815-QUOTATOKEN] the LINE proxy endpoints read `access_token` — the
 * field every hook in the live database actually carries.
 * ===========================================================================
 * THE BUG. `loadHookAccessToken` — shared by `GET /hook/:id/quota` and
 * `GET /hook/:id/bot-info` — read `hook.line_key` and nothing else. Counted on
 * the live database 15/08: of 7 hooks, **0** carry a non-empty `line_key` and
 * **6** carry `access_token`. The read therefore matched nothing, and both
 * endpoints answered `Line access token is required` for every OA that is
 * online and sending messages perfectly well. Reported by the owner:
 * "bug นะ demo-oa-three มันออนไลน์ปกติ".
 *
 * WHY THE REST OF THE APP WAS FINE. Every other outbound path already resolves
 * `access_token ?? line_key` — chat.service.ts:676,876 ·
 * chat-media.service.ts:266,538 · webhook.service.ts:938 ·
 * broadcasts.service.ts:661. `line_key` is the legacy field name: a saved token
 * is still mirrored into it (hooks.service.ts:1875) and crypto.service.ts:215
 * back-fills `access_token` from it for old rows. This one function read the
 * legacy field ALONE, so it was the only one that broke.
 *
 * These cases are pinned because the failure is silent in exactly the wrong
 * way: nothing throws at build time, no existing suite covered this function,
 * and the endpoint returns a polite 400 that reads like a configuration
 * problem on the customer's side rather than a bug on ours.
 */
import { Types } from 'mongoose';
import { HooksService } from '@/modules/hooks/hooks.service';

const HOOK_ID = new Types.ObjectId().toHexString();

/** Mounts the real service with only the collaborators this path touches. */
function makeService(hook: Record<string, unknown> | null) {
  const findById = jest.fn(() => ({
    lean: () => ({ exec: () => Promise.resolve(hook) }),
    exec: () => Promise.resolve(hook),
  }));

  // safeDecrypt is identity here: this spec is about WHICH FIELD is read, not
  // about crypto. A prefix keeps the two distinguishable in assertions.
  const crypto = { safeDecrypt: (v: string) => (v ? `dec:${v}` : '') };

  const svc = new HooksService(
    { findById } as never,
    {} as never,
    {} as never,
    {} as never,
    crypto as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    /* [PHASE3-I-QUOTA] LineQuotaApi — this spec never reaches the quota path. */
    {} as never,
  );
  return svc;
}

/**
 * The private helper both proxy endpoints funnel through.
 *
 * ⚠️ `roleName`, not `role` — `isSuperUser` reads `user.roleName` and compares
 *    it against SUPER_ROLE_NAMES (`common/auth/super-role.ts:33,38`). Passing
 *    `role` instead throws "group access is required" on a hook with no group,
 *    which looks like a scoping bug and has nothing to do with the token.
 */
const loadToken = (svc: HooksService, id = HOOK_ID): Promise<string> =>
  (
    svc as unknown as {
      loadHookAccessToken: (id: string, user?: unknown) => Promise<string>;
    }
  ).loadHookAccessToken(id, { username: 'dev', roleName: 'superadmin' });

describe('[FIX-20260815-QUOTATOKEN] loadHookAccessToken picks the right field', () => {
  it('reads access_token — the shape EVERY hook in the live DB actually has', async () => {
    const svc = makeService({
      _id: HOOK_ID,
      alias: 'demo-oa-three',
      access_token: 'AT',
    });
    await expect(loadToken(svc)).resolves.toBe('dec:AT');
  });

  /* FLIPPED, not deleted (owner decision 15/08: "เฉพาะตรงฟังก์ชันโควตา เลิกยุ่งกับ
     line_key ไม่ได้ใช้"). The earlier expectation was that a `line_key`-only row
     still resolved. It no longer does HERE — and that is safe for a reason worth
     keeping written down: 0 of 7 live hooks carry the field, this helper serves
     only the two read-only LINE proxies, and `crypto.service.ts:215` already
     back-fills `access_token` from `line_key` on read, so a genuine legacy row
     is covered upstream. The send paths keep their own fallback and are not
     touched. ถ้าวันหน้า endpoint อื่นมาเรียก helper นี้ ต้องทบทวนเคสนี้ใหม่. */
  it('does NOT fall back to line_key — the legacy name is out of this path', async () => {
    const svc = makeService({
      _id: HOOK_ID,
      alias: 'legacy-oa',
      line_key: 'LK',
    });
    await expect(loadToken(svc)).rejects.toThrow(
      'Line access token is required',
    );
  });

  it('reads access_token and ignores a line_key sitting beside it', async () => {
    const svc = makeService({
      _id: HOOK_ID,
      alias: 'both',
      access_token: 'AT',
      line_key: 'LK',
    });
    await expect(loadToken(svc)).resolves.toBe('dec:AT');
  });

  it('still refuses when the hook genuinely has no token at all', async () => {
    const svc = makeService({ _id: HOOK_ID, alias: 'tokenless' });
    await expect(loadToken(svc)).rejects.toThrow(
      'Line access token is required',
    );
  });

  /* An undecryptable value must not reach LINE as a bearer token: safeDecrypt
     returns '' and the caller has to treat that as "no token". */
  it('refuses a value that cannot be decrypted rather than sending it', async () => {
    const svc = makeService({
      _id: HOOK_ID,
      alias: 'corrupt',
      access_token: '',
    });
    await expect(loadToken(svc)).rejects.toThrow(
      'Line access token is required',
    );
  });
});
