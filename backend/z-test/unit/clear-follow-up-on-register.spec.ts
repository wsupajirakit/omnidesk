/**
 * [FEAT-20260820-CLEARONLINK] registering takes the follow-up mark off, at once
 * ===========================================================================
 * Owner: "เพิ่มเงื่อนไขตอนลงทะเบียนเสร็จ cus link > ไม่ว่าจะ admin กดหรือกดมาเองผ่าน liff ·
 * ถ้าสำเร็จ เคลียร์ member follow up" · "request_reg_at = ห้ามเคลียร์ห้ามยุ่ง คงค่าเดิม" ·
 * "ต้องไม่กระทบกับบางคนที่ไม่มีค่าพวกนี้ seamless + proof test".
 *
 * Three properties carry this, and each is easy to lose by accident:
 *   · the RECORD survives — only the flag is removed;
 *   · a member with none of these keys is not written to at all;
 *   · a failure here can never surface on the registration path.
 */
import { MEMBER_CONFIG_KEYS } from '@/modules/chat/config';
import {
  FOLLOW_UP_KEYS_CLEARED_ON_REGISTER,
  clearFollowUpOnLinkRegistered,
} from '@/modules/customer-link/clear-follow-up-on-register.helper';

/** A member model that records every call and answers what the test tells it. */
const modelWith = (modifiedCount: number) => {
  const updateOne = jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue({ modifiedCount }),
  });
  return { model: { updateOne } as never, updateOne };
};

describe('what it removes — and what it must not', () => {
  it('⭐ removes the abandon flag', async () => {
    const { model, updateOne } = modelWith(1);
    const warn = jest.fn();
    await expect(
      clearFollowUpOnLinkRegistered(
        { channelUserId: 'Uabc' },
        { memberModel: model, warn },
      ),
    ).resolves.toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      { line_user_id: 'Uabc' },
      { $unset: { 'config.follow_up.line.abandon_trigger_at': '' } },
    );
  });

  it('⭐ NEVER touches request_reg_at — that record outlives registration', async () => {
    /* the owner's rule, asserted two ways: the declared list must not name it,
       and no write may mention it. ห้ามยุ่งกับ request_reg_at เด็ดขาด. */
    expect([...FOLLOW_UP_KEYS_CLEARED_ON_REGISTER]).not.toContain(
      'follow_up.line.request_reg_at',
    );
    const { model, updateOne } = modelWith(1);
    await clearFollowUpOnLinkRegistered(
      { channelUserId: 'Uabc' },
      { memberModel: model, warn: jest.fn() },
    );
    for (const call of updateOne.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('request_reg_at');
    }
  });

  it('⭐ it $unsets — it does not write null or an empty string', async () => {
    /* This is not cosmetic. The partial index on the abandon path is built on
       `$exists: true`, and BOTH `null` and `''` still exist — so a customer who
       registered would stay in the "who is stuck" index for ever.
       null/'' ยังติด index · ต้อง $unset เท่านั้น. */
    const { model, updateOne } = modelWith(1);
    await clearFollowUpOnLinkRegistered(
      { channelUserId: 'Uabc' },
      { memberModel: model, warn: jest.fn() },
    );
    const [, update] = updateOne.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(Object.keys(update)).toEqual(['$unset']);
    expect(update['$set']).toBeUndefined();
  });

  it('every key it clears is one the registry actually declares', () => {
    /* `clearMemberConfig` throws on an undeclared key, so a typo here would fail
       loudly at run time — on the registration path. This catches it at test
       time instead, and catches drift if a key is ever renamed.
       พิมพ์ผิด = registry โยน · เทสตัวนี้จับก่อนถึงของจริง. */
    for (const key of FOLLOW_UP_KEYS_CLEARED_ON_REGISTER) {
      expect(Object.keys(MEMBER_CONFIG_KEYS)).toContain(key);
    }
  });
});

describe('seamless — a member without these keys is not disturbed', () => {
  it('⭐ nothing matched → returns false, and reports nothing', async () => {
    /* `$unset` on a path a document does not have matches nothing: no write, no
       error, no document rewritten. This runs on EVERY registration, so it has
       to be free for the customers it does not concern.
       คนที่ไม่เคยติด loop = ไม่มีอะไรเกิดขึ้นกับเขาเลย. */
    const { model } = modelWith(0);
    const warn = jest.fn();
    await expect(
      clearFollowUpOnLinkRegistered(
        { channelUserId: 'Unever' },
        { memberModel: model, warn },
      ),
    ).resolves.toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('it only ever writes to the one customer it was given', async () => {
    const { model, updateOne } = modelWith(1);
    await clearFollowUpOnLinkRegistered(
      { channelUserId: 'Uabc' },
      { memberModel: model, warn: jest.fn() },
    );
    for (const [filter] of updateOne.mock.calls as [
      Record<string, unknown>,
    ][]) {
      expect(filter).toEqual({ line_user_id: 'Uabc' });
    }
  });

  it('it unsets ONE leaf per call, so a sibling feature key survives', async () => {
    /* `member.config` is shared. A `$unset` of `config.follow_up` or of `config`
       would take another feature's setting with it. */
    const { model, updateOne } = modelWith(1);
    await clearFollowUpOnLinkRegistered(
      { channelUserId: 'Uabc' },
      { memberModel: model, warn: jest.fn() },
    );
    for (const [, update] of updateOne.mock.calls as [
      unknown,
      { $unset: Record<string, unknown> },
    ][]) {
      for (const path of Object.keys(update.$unset)) {
        expect(path.startsWith('config.follow_up.line.')).toBe(true);
        expect(path.split('.').length).toBeGreaterThan(3);
      }
    }
  });

  it('no customer id → does nothing at all', async () => {
    const { model, updateOne } = modelWith(1);
    for (const channelUserId of ['', null, undefined]) {
      await expect(
        clearFollowUpOnLinkRegistered({ channelUserId } as never, {
          memberModel: model,
          warn: jest.fn(),
        }),
      ).resolves.toBe(false);
    }
    expect(updateOne).not.toHaveBeenCalled();
  });
});

describe('it can never break a registration', () => {
  it('⭐ a database failure is swallowed and reported once', async () => {
    /* By the time this runs the link exists upstream. Losing a tidy-up must not
       turn a successful registration into an error for the customer.
       ล้างไม่สำเร็จ ต้องไม่ทำให้การลงทะเบียนพัง. */
    const warn = jest.fn();
    const model = {
      updateOne: jest.fn().mockImplementation(() => {
        throw new Error('mongo down');
      }),
    } as never;
    await expect(
      clearFollowUpOnLinkRegistered(
        { channelUserId: 'Uabc' },
        { memberModel: model, warn },
      ),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('mongo down');
  });

  it('a rejected promise is swallowed too, not only a throw', async () => {
    const warn = jest.fn();
    const model = {
      updateOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('write conflict')),
      }),
    } as never;
    await expect(
      clearFollowUpOnLinkRegistered(
        { channelUserId: 'Uabc' },
        { memberModel: model, warn },
      ),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('it is wired where BOTH registration paths pass, and is easy to remove', () => {
  const read = (rel: string): string =>
    require('node:fs').readFileSync(
      `${process.cwd()}/${rel}`,
      'utf8',
    ) as string;

  it('⭐ called beside the stamp — the one line both admin and LIFF reach', () => {
    /* `customer-link.service.ts` documents that call site as "the only line
       reached by BOTH registration paths and by neither edit nor unlink". Sitting
       next to the stamp is what makes that true for this too. */
    const svc = read('src/modules/customer-link/customer-link.service.ts');
    const stampAt = svc.indexOf('void stampLinkRegistration(');
    const clearAt = svc.indexOf('void clearFollowUpOnLinkRegistered(');
    expect(stampAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(stampAt);
  });

  it('⭐ ONLY on success — a failed registration must not clear anybody', () => {
    /* A mutation that widened the guard from `res?.ok && userId` to `userId`
       survived every other case here: nothing looked at WHICH branch the call
       sits in. It matters — a registration that failed leaves the customer
       exactly as stuck as they were, and erasing their mark would drop them out
       of the follow-up flow with nothing gained.
       ลงทะเบียนไม่สำเร็จ = ยังติดอยู่เหมือนเดิม ห้ามล้างมาร์ค. */
    const svc = read('src/modules/customer-link/customer-link.service.ts');
    const GUARD = 'if (res?.ok && userId) {';
    const guardAt = svc.indexOf(GUARD);
    expect(guardAt).toBeGreaterThan(-1);
    const clearAt = svc.indexOf('void clearFollowUpOnLinkRegistered(');
    // the call sits after the success guard and before the method returns
    const returnAt = svc.indexOf('return res;', guardAt);
    expect(clearAt).toBeGreaterThan(guardAt);
    expect(clearAt).toBeLessThan(returnAt);
    // and that guard is the ONLY thing between them — no second branch opened
    const between = svc.slice(guardAt + GUARD.length, clearAt);
    expect(between).not.toMatch(/\bif\s*\(/);
  });

  it('⭐ fired and forgotten — the registration never waits on it', () => {
    const svc = read('src/modules/customer-link/customer-link.service.ts');
    expect(svc).toContain('void clearFollowUpOnLinkRegistered(');
    expect(svc).not.toContain('await clearFollowUpOnLinkRegistered(');
  });

  it('⭐ removing it is one file and one call — nothing else references it', () => {
    /* the owner asked for this explicitly: "cuslink ต้องถอด follow up ได้อนาคต
       แบบปลอดภัยง่ายและดี". If this goes red, removal has stopped being cheap. */
    const svc = read('src/modules/customer-link/customer-link.service.ts');
    const occurrences = svc.split('clearFollowUpOnLinkRegistered').length - 1;
    expect(occurrences).toBe(2); // the import, and the single call
  });

  it('the helper knows no Nest, no LINE and no webhook', () => {
    const body = read(
      'src/modules/customer-link/clear-follow-up-on-register.helper.ts',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const forbidden of ['@nestjs', '@Injectable', 'lineApi', 'webhook']) {
      expect({ forbidden, has: body.includes(forbidden) }).toEqual({
        forbidden,
        has: false,
      });
    }
  });
});
