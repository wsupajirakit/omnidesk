/**
 * [FEAT-20260814-MINTBLOCKLINKED] — the mint button refuses an already-linked member
 * ============================================================================
 * เจ้าของสั่ง 2026-08-14: กด "ลงทะเบียนให้ลูกค้า" กับคนที่มี raw profile อยู่แล้ว
 * ต้องไม่ออก token — ให้ตอบกลับไปว่า "ลูกค้าได้ทำการลงทะเบียนไว้ในระบบเรียบร้อยแล้วนะคะ :)"
 * และเก็บข้อความนั้นเข้าห้องแชตเป็น sender_type:'bot'.
 *
 * ⚠️ เคสที่สำคัญที่สุดในไฟล์นี้คือเคส NEGATIVE — `mode:'edit'` และคนที่ยังไม่ผูก
 *    ต้องไม่ถูกบล็อก. โหมด edit มีไว้สำหรับคนที่ผูกแล้วโดยเฉพาะ ถ้าเผลอบล็อก
 *    ปุ่มแก้ไขจะพังกับลูกค้าทุกคนที่มีบัญชี — พังเงียบด้วย เพราะ 409 หน้าตาเหมือน
 *    "ระบบปฏิเสธ" ไม่ใช่ "เราทำพัง".
 */
import { CustomerLinkService } from '@/modules/customer-link';

/** member row ที่ `findLinkedMember` เลือกอ่าน — ชื่อ field ตามของจริงใน DB */
type MemberRow = { full_name?: unknown; raw_profile_data?: unknown } | null;

function makeService(
  opts: {
    member?: MemberRow;
    memberThrows?: boolean;
    push?: jest.Mock;
    logMessage?: jest.Mock;
  } = {},
) {
  /* [FEAT-20260827-PUSHCORE-F] the core's success shape. `ok` is what the caller
     branches on — `status` alone is NOT enough, because the core also returns
     `{ok:false, status:0}` when there is no token and never made a call
     (line-push.ts:128-138). A double that only sets `status` would let a
     failure read as a success. */
  const push =
    opts.push ?? jest.fn().mockResolvedValue({ ok: true, status: 200 });
  const logMessage =
    opts.logMessage ?? jest.fn().mockResolvedValue({ _id: 'msg1' });

  /* memberModel.findOne(...).select(...).lean().exec() — chain ตามที่โค้ดเรียกจริง */
  const exec = opts.memberThrows
    ? jest.fn().mockRejectedValue(new Error('mongo down'))
    : jest.fn().mockResolvedValue(opts.member ?? null);
  const memberModel = {
    findOne: jest.fn(() => ({
      select: () => ({ lean: () => ({ exec }) }),
    })),
  };

  const svc = new CustomerLinkService(
    {} as never, // hookModel
    memberModel as never, // memberModel
    { safeDecrypt: (v: string) => (v ? 'DECRYPTED:' + v : '') } as never, // crypto
    {} as never, // customToolService
    { create: jest.fn().mockResolvedValue({}) } as never, // webhookLogModel
    {} as never, // realtime
    /* [FEAT-20260827-PUSHCORE-F] was `{ sendLinePushMessage: push }` — this
       module's own LINE sender. The send now rides `LinePushDispatcher.dispatch`,
       which RESOLVES with `{ok:false}` instead of rejecting, so a double that
       only rejects would no longer reproduce a failure. `push` therefore keeps
       its name and its jest.fn identity (every assertion below still reads it)
       but now answers the core's contract. */
    { dispatch: push } as never, // linePush (core wrapper)
    { logMessage } as never, // chatHistory
  );
  return { svc, push, logMessage, memberModel };
}

const HOOK = { _id: 'hook1', access_token: 'enc-token' };
const NOTICE = 'ลูกค้าได้ทำการลงทะเบียนไว้ในระบบเรียบร้อยแล้วนะคะ :)';

describe('[MINT BLOCK] findLinkedMember — ใครนับว่า "ลงทะเบียนแล้ว"', () => {
  it('⭐ ต้องมีครบทั้ง full_name และ raw_profile_data ถึงจะนับ', async () => {
    // เกณฑ์เดียวกับ customer-register.handler.ts:212 (port จาก legacy:3060-3070)
    // ห้ามคิดใหม่ ไม่งั้นสองเส้นจะตอบไม่ตรงกันว่าใครลงทะเบียนแล้ว
    const { svc } = makeService({
      member: { full_name: 'มาลี ทดลอง', raw_profile_data: { data: {} } },
    });
    await expect(svc.findLinkedMember('U1')).resolves.toEqual({
      linked: true,
      fullName: 'มาลี ทดลอง',
    });
  });

  it('⭐ มีแค่ raw_profile_data (ไม่มีชื่อ) = ยังไม่นับ', async () => {
    const { svc } = makeService({
      member: { raw_profile_data: { data: {} } },
    });
    const r = await svc.findLinkedMember('U1');
    expect(r.linked).toBe(false);
  });

  it('มีแค่ full_name (ยังไม่เคยดึง profile) = ยังไม่นับ', async () => {
    const { svc } = makeService({ member: { full_name: 'ฮุนได' } });
    expect((await svc.findLinkedMember('U1')).linked).toBe(false);
  });

  it('ไม่เจอ member เลย = ยังไม่นับ', async () => {
    const { svc } = makeService({ member: null });
    expect((await svc.findLinkedMember('U1')).linked).toBe(false);
  });

  it('⭐ อ่าน member ไม่ได้ (mongo ล่ม) = ถือว่ายังไม่ผูก ไม่ throw', async () => {
    /* fail-open เหมือน legacy: ปิดตายเพราะ DB สะดุด = บล็อกการลงทะเบียนที่ถูกต้อง
       ซึ่งแย่กว่าปล่อยผ่านแล้วให้ปลายทางตัดสิน */
    const { svc } = makeService({ memberThrows: true });
    await expect(svc.findLinkedMember('U1')).resolves.toEqual({
      linked: false,
      fullName: null,
    });
  });
});

describe('[MINT BLOCK] notifyAlreadyRegistered — ตอบลูกค้า + เก็บเข้าห้อง', () => {
  it('⭐ push ข้อความถูกตัว และเก็บ chat message เป็น bot', async () => {
    const { svc, push, logMessage } = makeService();
    await svc.notifyAlreadyRegistered(HOOK, 'U1');

    /* [FEAT-20260827-PUSHCORE-F] the same three values, now inside the core's
       request. Asserted field by field (not deep-equal on the whole object) so
       the retry key the core adds for the push family does not make this red —
       that header is a deliberate gain inherited from candidates C/E. */
    expect(push).toHaveBeenCalledTimes(1);
    const req = push.mock.calls[0]![0] as Record<string, unknown>;
    expect(req['kind']).toBe('push');
    expect(req['token']).toBe('DECRYPTED:enc-token');
    expect(req['to']).toBe('U1');
    expect(req['messages']).toEqual([{ type: 'text', text: NOTICE }]);
    expect(logMessage).toHaveBeenCalledTimes(1);
    const arg = logMessage.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg['senderType']).toBe('bot'); // ⭐ เจ้าของสั่งให้เป็น bot
    expect(arg['content']).toBe(NOTICE);
    expect(arg['userId']).toBe('U1');
    expect(arg['hookId']).toBe('hook1');
  });

  it('ไม่มี access_token = ข้ามเงียบ ๆ ไม่ throw และไม่เขียน history', async () => {
    const { svc, push, logMessage } = makeService();
    await expect(
      svc.notifyAlreadyRegistered({ _id: 'h' }, 'U1'),
    ).resolves.toBeUndefined();
    expect(push).not.toHaveBeenCalled();
    expect(logMessage).not.toHaveBeenCalled();
  });

  it('⭐ push ล้ม = ไม่ throw (best-effort — การปฏิเสธเกิดไปแล้ว)', async () => {
    /* [FEAT-20260827-PUSHCORE-F] the core RESOLVES with `{ok:false}`; it does not
       reject (line-push.ts:39-40). Driving the failure the honest way is the
       point of this edit — a double that rejects would pass even if the service
       stopped checking `ok` at all. */
    const { svc, logMessage } = makeService({
      push: jest
        .fn()
        .mockResolvedValue({ ok: false, status: 401, reason: 'LINE 401' }),
    });
    await expect(
      svc.notifyAlreadyRegistered(HOOK as never, 'U1'),
    ).resolves.toBeUndefined();
    /* [FEAT-20260827-PUSHCORE-F] same gap as C2 in customer-link-success-push:
       the case proved "no throw" but never that the refusal notice stays OUT of
       the transcript when it was not delivered. With the core resolving
       `{ok:false}` rather than rejecting, the explicit throw in `pushOrThrow` is
       the only thing keeping that true — so it needs a test that dies with it. */
    expect(logMessage).not.toHaveBeenCalled();
  });

  it('⭐ เขียน chat history ล้ม = ไม่ throw และ push ที่ยิงไปแล้วไม่ถูกกลบ', async () => {
    const push = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const { svc } = makeService({
      push,
      logMessage: jest.fn().mockRejectedValue(new Error('room resolve failed')),
    });
    await expect(
      svc.notifyAlreadyRegistered(HOOK as never, 'U1'),
    ).resolves.toBeUndefined();
    expect(push).toHaveBeenCalledTimes(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * [FEAT-20260814-MINTBLOCKLINKED] controller — บล็อกเฉพาะ register เท่านั้น
 *
 * ⚠️ นี่คือเคสที่ต้องมีที่สุดในไฟล์นี้. เทสฝั่ง service ข้างบนพิสูจน์แค่ว่า
 *    "รู้ได้ว่าใครผูกแล้ว" — ไม่ได้พิสูจน์ว่า controller เรียกมันถูกโหมด.
 *    ถ้า gate หลุดไปครอบ mode:'edit' ปุ่มแก้ไขจะพังกับลูกค้าทุกคนที่มีบัญชี
 *    และพังเงียบ เพราะ 409 อ่านเหมือน "ระบบปฏิเสธ" ไม่ใช่ "เราทำพัง".
 * ──────────────────────────────────────────────────────────────────────────── */

import { CustomerLinkController } from '@/modules/customer-link';

function makeController(opts: { linked: boolean }) {
  const findLinkedMember = jest
    .fn()
    .mockResolvedValue({ linked: opts.linked, fullName: 'x' });
  const notifyAlreadyRegistered = jest.fn().mockResolvedValue(undefined);
  const mintLinkToken = jest.fn().mockReturnValue('TOKEN123');
  const service = {
    findHookById: jest.fn().mockResolvedValue({
      _id: 'hook1',
      customer_link_landing_url: 'https://landing.test/reg',
    }),
    notReadyRejection: jest.fn().mockReturnValue(null),
    findLinkedMember,
    notifyAlreadyRegistered,
    mintLinkToken,
    /* [FIX-20260818-LINKSCOPE · plan §8 = T3-3] the route now asks whether this
       admin may use this OA before minting. These cases are about an admin who
       MAY — the refusal path has its own cases at the end of this file — so the
       stub answers true and they keep testing exactly what they were written for. */
    adminMayUseHook: jest.fn().mockResolvedValue(true),
  };
  const ctl = new CustomerLinkController(service as never);

  /** จับ res.status(...).json(...) แบบเดียวกับที่ controller เรียกจริง */
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  };
  return {
    ctl,
    res,
    sent,
    findLinkedMember,
    notifyAlreadyRegistered,
    mintLinkToken,
  };
}

const HOOK_ID = 'a0d00000000000000000002e';

describe('[MINT BLOCK] controller — register ถูกบล็อก, edit ต้องรอด', () => {
  it('⭐ register + ผูกแล้ว → 409 ไม่ออก token และแจ้งลูกค้า', async () => {
    const { ctl, res, sent, notifyAlreadyRegistered, mintLinkToken } =
      makeController({ linked: true });

    await ctl.adminToken(
      res as never,
      { hook_id: HOOK_ID, channel_user_id: 'U1', mode: 'register' },
      // [FIX-20260818-LINKSCOPE · plan §8] the route is authenticated, so the
      // caller now needs a role: these cases are about an admin who MAY use this
      // OA, so they mint as a super user and keep testing what they were written for.
      { id: 'admin1', roleName: 'superadmin' } as never,
    );

    expect(sent.status).toBe(409);
    expect(mintLinkToken).not.toHaveBeenCalled(); // ⭐ ไม่ออก token
    expect(notifyAlreadyRegistered).toHaveBeenCalledTimes(1); // ⭐ แจ้งลูกค้า
    const body = sent.body as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('CUSTOMER_LINK_ALREADY_REGISTERED');
    expect(body.error?.message).toContain('ลงทะเบียนไว้ในระบบเรียบร้อยแล้ว');
  });

  it('⭐⭐ edit + ผูกแล้ว → ยังออก token ตามปกติ (ห้ามบล็อก)', async () => {
    const {
      ctl,
      res,
      sent,
      findLinkedMember,
      notifyAlreadyRegistered,
      mintLinkToken,
    } = makeController({ linked: true });

    await ctl.adminToken(
      res as never,
      { hook_id: HOOK_ID, channel_user_id: 'U1', mode: 'edit' },
      // [FIX-20260818-LINKSCOPE · plan §8] the route is authenticated, so the
      // caller now needs a role: these cases are about an admin who MAY use this
      // OA, so they mint as a super user and keep testing what they were written for.
      { id: 'admin1', roleName: 'superadmin' } as never,
    );

    // controller เรียก res.status(200) เสมอ (ดู `send()` ในไฟล์นั้น) — ไม่ใช่ปล่อยว่าง
    expect(sent.status).toBe(200);
    expect(mintLinkToken).toHaveBeenCalledTimes(1); // ⭐ ยังออก token
    expect(findLinkedMember).not.toHaveBeenCalled(); // ⭐ ไม่แม้แต่จะไปถาม
    expect(notifyAlreadyRegistered).not.toHaveBeenCalled();
  });

  it('register + ยังไม่ผูก → ออก token ตามปกติ', async () => {
    const { ctl, res, sent, notifyAlreadyRegistered, mintLinkToken } =
      makeController({ linked: false });

    await ctl.adminToken(
      res as never,
      { hook_id: HOOK_ID, channel_user_id: 'U1', mode: 'register' },
      // [FIX-20260818-LINKSCOPE · plan §8] the route is authenticated, so the
      // caller now needs a role: these cases are about an admin who MAY use this
      // OA, so they mint as a super user and keep testing what they were written for.
      { id: 'admin1', roleName: 'superadmin' } as never,
    );

    expect(sent.status).toBe(200);
    expect(mintLinkToken).toHaveBeenCalledTimes(1);
    expect(notifyAlreadyRegistered).not.toHaveBeenCalled();
  });
});

/**
 * [FIX-20260818-LINKSCOPE · plan §8 = T3-3, closes audit C2.3]
 *
 * `POST /customer-link/admin/token` reads `hook_id` from the request BODY, and
 * the token it mints lets its holder register or EDIT that customer's identity
 * with the OA's upstream. Naming another OA's hook was therefore a way to take
 * over that OA's customers — the id was the only thing needed.
 *
 * `adminMayUseHook` is the gate the controller now calls before anything is
 * minted. These cases pin the three answers that matter; the controller wiring
 * is pinned by the route's own 403 branch.
 */
describe('[LINKSCOPE] only an admin of that OA may mint its link token', () => {
  const OA_A = 'a0d000000000000000000043';
  const OA_B = 'a0d000000000000000000044';

  /** The scope resolver reads Hook only for the group tier; the whitelist short-circuits. */
  const svcWithHooks = () =>
    new CustomerLinkService(
      {
        find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { create: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('⭐ an operator scoped to OA-A may not mint for OA-B', async () => {
    const svc = svcWithHooks();
    await expect(
      svc.adminMayUseHook(
        { roleName: 'operator', groups: [], allowedHooks: [OA_A] } as never,
        OA_B,
      ),
    ).resolves.toBe(false);
  });

  it('the same operator may mint for their own OA — unchanged', async () => {
    const svc = svcWithHooks();
    await expect(
      svc.adminMayUseHook(
        { roleName: 'operator', groups: [], allowedHooks: [OA_A] } as never,
        OA_A,
      ),
    ).resolves.toBe(true);
  });

  it('a super user may mint for any OA, as before', async () => {
    const svc = svcWithHooks();
    await expect(
      svc.adminMayUseHook({ roleName: 'superadmin' } as never, OA_B),
    ).resolves.toBe(true);
  });
});

/**
 * [FIX-20260818-LINKSCOPE · plan §8] the controller's refusal path — the gate is
 * only worth having if the route actually stops on it, so this drives the real
 * handler with a service that says no.
 */
describe('[LINKSCOPE] the route stops before minting when the OA is not the caller’s', () => {
  it('⭐ answers 403 and never mints', async () => {
    const mint = jest.fn();
    const sent: { status?: number; body?: unknown } = {};
    const res = {
      status: (code: number) => {
        sent.status = code;
        return { json: (b: unknown) => (sent.body = b) };
      },
    };
    const ctl = new CustomerLinkController({
      findHookById: jest.fn().mockResolvedValue({ _id: 'hook1' }),
      notReadyRejection: jest.fn().mockReturnValue(null),
      adminMayUseHook: jest.fn().mockResolvedValue(false),
      mintLinkToken: mint,
      findLinkedMember: jest.fn(),
    } as never);

    await ctl.adminToken(
      res as never,
      {
        hook_id: 'a0d000000000000000000044',
        channel_user_id: 'U1',
        mode: 'register',
      },
      { id: 'admin1', roleName: 'operator' } as never,
    );

    expect(sent.status).toBe(403);
    expect(mint).not.toHaveBeenCalled();
  });
});
