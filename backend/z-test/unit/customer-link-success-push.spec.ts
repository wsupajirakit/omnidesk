/**
 * [FEAT-20260811-SUCCESSPUSH] — push แจ้งลูกค้าในแชต LINE หลังผูกบัญชีสำเร็จ
 * ============================================================================
 * เจ้าของสั่ง 2026-08-11: landing ตอน success ไม่โชว์ modal แล้ว ให้ push ข้อความ
 * "ตอนนี้น้องลั๊คกี้เชื่อมต่อข้อมูล..." เข้าแชต LINE แทน. push เป็น BEST-EFFORT:
 * match สำเร็จ = success เสมอ, push ล้มต้องไม่ทำให้ผลลัพธ์เป็น fail.
 *
 * ทดสอบ `pushLinkedNotice` + `linkedNoticeText` โดยตรง (สร้าง service กับ mock deps)
 * — ครอบ 3 เรื่อง: (A) ยิง push ถูก args, (B) dynamic text จาก hook, (C) best-effort.
 */
import { CustomerLinkService } from '@/modules/customer-link/customer-link.service';

// mock deps — เฉพาะที่ push ใช้ (crypto.safeDecrypt + lineApi.sendLinePushMessage)
function makeService(
  opts: {
    decrypt?: (v: string) => string;
    push?: jest.Mock;
    // [FEAT-20260811-SUCCESSPUSH] ให้ test แทรก logMessage mock (เช่นตัวที่ throw) ได้
    logMessage?: jest.Mock;
    /* [FEAT-20260811-PUSHWHLOG] mock ตัวเขียน webhook log เพื่อเช็คแถวที่ออก
     [FEAT-20260827-WLOGONEDOOR] ย้ายจาก `webhookLogModel.create` มาเป็น
     `wlog.persist` — ประตูส่งต่อ row ดิบ ๆ ⇒ ค่าที่ assert ข้างล่างไม่เปลี่ยนเลย */
    whLogWrite?: jest.Mock;
  } = {},
) {
  /* [FEAT-20260827-PUSHCORE-F] the core's success shape. `ok` is the field the
     caller branches on; `status` alone is not enough, because the core also
     answers `{ok:false, status:0}` when no call was made at all
     (line-push.ts:128-138). */
  const push =
    opts.push ?? jest.fn().mockResolvedValue({ ok: true, status: 200 });
  const crypto = {
    safeDecrypt: opts.decrypt ?? ((v: string) => (v ? 'DECRYPTED:' + v : '')),
  };
  /* [FEAT-20260827-PUSHCORE-F] was `{ sendLinePushMessage: push }`. The service
     no longer owns a LINE sender — it takes `LinePushDispatcher` and calls
     `dispatch`. `push` keeps its name so every assertion below still reads the
     same handle; what changed is the CONTRACT it must honour. */
  const linePush = { dispatch: push };
  // [FEAT-20260811-SUCCESSPUSH] chat-history writer — default resolve เงียบ ๆ
  const logMessage =
    opts.logMessage ?? jest.fn().mockResolvedValue({ _id: 'msg1' });
  const chatHistory = { logMessage };
  // [FEAT-20260811-PUSHWHLOG] webhook log writer — default resolve เงียบ ๆ
  const whLogWrite =
    opts.whLogWrite ?? jest.fn().mockResolvedValue({ _id: 'wh1' });
  const wlog = { persist: whLogWrite };
  const svc = new CustomerLinkService(
    {} as never, // hookModel
    {} as never, // memberModel
    crypto as never, // crypto
    {} as never, // customToolService
    wlog as never, // [FEAT-20260827-WLOGONEDOOR] the webhook_logs door
    {} as never, // realtime
    linePush as never, // linePush (core wrapper)
    chatHistory as never, // chatHistory [FEAT-20260811-SUCCESSPUSH]
  );
  return { svc, push, logMessage, whLogWrite };
}

/* [FEAT-20260827-PUSHCORE-F] the three values A1-A3 used to assert as three
   positional args now ride inside ONE core request. Read field by field rather
   than deep-equalling the request: the core adds `X-Line-Retry-Key` for the push
   family, a deliberate gain inherited from candidates C/E, and a whole-object
   match would turn that gain into a red test. */
const sentPush = (
  push: jest.Mock,
): { token: unknown; to: unknown; text: unknown; kind: unknown } => {
  const req = push.mock.calls[0]![0] as Record<string, unknown>;
  const messages = req['messages'] as Array<Record<string, unknown>>;
  return {
    kind: req['kind'],
    token: req['token'],
    to: req['to'],
    text: messages[0]!['text'],
  };
};

const DEFAULT_TEXT =
  'ตอนนี้น้องลั๊คกี้เชื่อมต่อข้อมูลกับคุณลูกค้าได้แล้ว ' +
  'รบกวนคุณลูกค้าแจ้งความต้องการมาอีกครั้งนะคะ ' +
  'เดี๋ยวหนูจะรีบดำเนินการให้ทันทีเลยค่ะ';

describe('[FEAT-20260811-SUCCESSPUSH] pushLinkedNotice', () => {
  const call = (svc: CustomerLinkService, hook: unknown, userId: string) =>
    (
      svc as unknown as {
        pushLinkedNotice: (h: unknown, u: string) => Promise<void>;
      }
    ).pushLinkedNotice(hook, userId);

  it('(A1) ยิง push ด้วย access_token (decrypt) + userId + ข้อความ default', async () => {
    const { svc, push } = makeService();
    await call(svc, { access_token: 'enc:abc' }, 'Uuser1');
    expect(push).toHaveBeenCalledTimes(1);
    expect(sentPush(push)).toEqual({
      kind: 'push',
      token: 'DECRYPTED:enc:abc',
      to: 'Uuser1',
      text: DEFAULT_TEXT,
    });
  });

  it('(A2) ⭐ ข้อความ DYNAMIC จาก hook.customer_link_success_text ชนะ default', async () => {
    const { svc, push } = makeService();
    await call(
      svc,
      {
        access_token: 'enc:abc',
        customer_link_success_text: 'ข้อความใหม่จาก OA',
      },
      'Uuser1',
    );
    expect(sentPush(push)).toEqual({
      kind: 'push',
      token: 'DECRYPTED:enc:abc',
      to: 'Uuser1',
      text: 'ข้อความใหม่จาก OA',
    });
  });

  it('(A3) hook text ว่าง/ช่องว่าง → fallback default', async () => {
    const { svc, push } = makeService();
    await call(
      svc,
      { access_token: 'enc:abc', customer_link_success_text: '   ' },
      'Uuser1',
    );
    expect(sentPush(push)).toEqual({
      kind: 'push',
      token: 'DECRYPTED:enc:abc',
      to: 'Uuser1',
      text: DEFAULT_TEXT,
    });
  });

  it('(B1) ไม่มี access_token → ข้าม push (ไม่ throw)', async () => {
    const { svc, push } = makeService({ decrypt: () => '' });
    await expect(
      call(svc, { access_token: '' }, 'Uuser1'),
    ).resolves.toBeUndefined();
    expect(push).not.toHaveBeenCalled();
  });

  it('(B2) ไม่มี userId → ข้าม push', async () => {
    const { svc, push } = makeService();
    await call(svc, { access_token: 'enc:abc' }, '');
    expect(push).not.toHaveBeenCalled();
  });

  it('(C1) ⭐ BEST-EFFORT: push โยน error → ไม่ throw ต่อ (match ยังสำเร็จ)', async () => {
    /* [FEAT-20260827-PUSHCORE-F] the core RESOLVES `{ok:false}` on a failure —
       it never rejects (line-push.ts:39-40). The service turns that into a throw
       itself (`pushOrThrow`), which is what keeps this best-effort path and the
       error row alive. Driving the failure this way is what makes the case able
       to catch a regression: a double that rejects would still pass even if the
       service stopped reading `ok`. */
    const push = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      reason: 'token expired 401',
    });
    const { svc } = makeService({ push });
    // ต้อง resolve เงียบ ๆ — ไม่ reject
    await expect(
      call(svc, { access_token: 'enc:abc' }, 'Uuser1'),
    ).resolves.toBeUndefined();
    expect(push).toHaveBeenCalledTimes(1);
  });

  /* [FEAT-20260827-PUSHCORE-F] the half of the best-effort contract nobody was
     guarding. C1 pins "a failed push must not break match"; this pins the other
     half — a failed push must not be MIRRORED. The chat-history row is what the
     admin reads as "the bot told the customer this", so writing it after a send
     that never arrived puts a lie in the transcript.
     Why it matters now: the core resolves `{ok:false}` instead of rejecting, so
     the only thing keeping this true is the explicit throw in `pushOrThrow`.
     Remove that throw and this case must go red — verified by mutation, 27/08.
     push ล้มแล้วต้องไม่มีบับเบิลโผล่ในไทม์ไลน์ */
  it('(C2) ⭐ push ล้ม → ไม่เขียน chat history (ห้ามมีข้อความที่ลูกค้าไม่ได้รับ)', async () => {
    const push = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 401, reason: 'token expired' });
    const { svc, logMessage } = makeService({ push });
    await expect(
      call(svc, { _id: 'hook123', access_token: 'enc:abc' }, 'Uuser1'),
    ).resolves.toBeUndefined();
    expect(push).toHaveBeenCalledTimes(1);
    expect(logMessage).not.toHaveBeenCalled();
  });

  // ==== [FEAT-20260811-SUCCESSPUSH] เขียน push notice ลง chat history (sender_type:'bot') ====
  it('(D1) ⭐ push สำเร็จ → บันทึกลง chat history 1 ครั้ง (bot/text/ข้อความเดียวกับที่ push)', async () => {
    const { svc, push, logMessage } = makeService();
    await call(svc, { _id: 'hook123', access_token: 'enc:abc' }, 'Uuser1');
    expect(push).toHaveBeenCalledTimes(1);
    expect(logMessage).toHaveBeenCalledTimes(1);
    expect(logMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'Uuser1',
        senderType: 'bot',
        messageType: 'text',
        content: DEFAULT_TEXT,
        hookId: 'hook123',
        channelType: 'line',
      }),
    );
  });

  it('(D2) ⭐ BEST-EFFORT: logMessage โยน error → pushLinkedNotice ยัง resolve (ไม่ throw)', async () => {
    const logMessage = jest
      .fn()
      .mockRejectedValue(new Error('room resolve failed'));
    const { svc, push } = makeService({ logMessage });
    await expect(
      call(svc, { _id: 'hook123', access_token: 'enc:abc' }, 'Uuser1'),
    ).resolves.toBeUndefined();
    // push ยิงไปแล้ว, history ล้มไม่ย้อนกลับมากระทบ
    expect(push).toHaveBeenCalledTimes(1);
    expect(logMessage).toHaveBeenCalledTimes(1);
  });

  // ==== [FEAT-20260811-PUSHWHLOG] เก็บ push ลง webhook_logs ====
  it('(E1) ⭐ push สำเร็จ → เขียน webhook_logs (customer_link_success_push, status=success)', async () => {
    const { svc, whLogWrite } = makeService();
    await call(
      svc,
      { _id: 'hook123', alias: 'omnideskdevoa', access_token: 'enc:abc' },
      'Uuser1',
    );
    expect(whLogWrite).toHaveBeenCalledTimes(1);
    expect(whLogWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'reg_push',
        action_type: 'reg_push',
        status: 'success',
        reference_id: 'Uuser1',
      }),
    );
  });

  it('(E2) ⭐ push ล้ม → เขียน webhook_logs status=error (แอดมินเห็นว่าทำไมลูกค้าไม่ได้ข้อความ)', async () => {
    /* [FEAT-20260827-PUSHCORE-F] the core RESOLVES `{ok:false}` on a failure —
       it never rejects (line-push.ts:39-40). The service turns that into a throw
       itself (`pushOrThrow`), which is what keeps this best-effort path and the
       error row alive. Driving the failure this way is what makes the case able
       to catch a regression: a double that rejects would still pass even if the
       service stopped reading `ok`. */
    const push = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      reason: 'token expired 401',
    });
    const { svc, whLogWrite } = makeService({ push });
    await call(svc, { _id: 'hook123', access_token: 'enc:abc' }, 'Uuser1');
    /* [FEAT-20260827-PUSHCORE-F] this line is NEW, and it is the point of the
       edit. Until now this case asserted only the log row, so it stayed GREEN
       through the whole migration — the old `sendLinePushMessage` double was
       never called again, nothing failed, and the row was written for a reason
       that no longer existed. A case that cannot tell "the send was attempted
       and failed" from "no send happened at all" is not guarding the behaviour
       it is named after. เคสนี้เคยเขียวโดยไม่ได้วัดอะไร — พิสูจน์สดตอนย้าย 27/08 */
    expect(push).toHaveBeenCalledTimes(1);
    expect(whLogWrite).toHaveBeenCalledTimes(1);
    expect(whLogWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: 'reg_push',
        status: 'error',
      }),
    );
  });

  it('(E3) ⭐ BEST-EFFORT: webhookLog.create โยน error → pushLinkedNotice ยัง resolve', async () => {
    const whLogWrite = jest.fn().mockRejectedValue(new Error('mongo down'));
    const { svc, push } = makeService({ whLogWrite });
    await expect(
      call(svc, { _id: 'hook123', access_token: 'enc:abc' }, 'Uuser1'),
    ).resolves.toBeUndefined();
    expect(push).toHaveBeenCalledTimes(1);
  });

  // ==== [FIX-20260812-PUSHDEDUP] match() → push wiring: ยิงครั้งแรก · re-link ไม่ยิงซ้ำ ====
  // review บอก spec เดิมทดสอบ pushLinkedNotice ตรง (cast) ไม่เคยเรียก match() → การ wire
  // (ยิงเมื่อ res.ok + first-link, ไม่ยิงตอน re-link) ไม่มี test. เพิ่มตรงนี้: เรียก match()
  // จริง + spy callUpstream/alreadyLinked/pushLinkedNotice.
  describe('[FIX-20260812-PUSHDEDUP] match() wiring — push เฉพาะ first-link', () => {
    // สร้าง svc + stub เฉพาะ private ที่ match() ต้องใช้ (ไม่แตะ DB/upstream จริง)
    const makeMatchSvc = (opts: {
      upstreamOk: boolean;
      wasLinked: boolean;
    }) => {
      const { svc, push } = makeService();
      const s = svc as unknown as Record<string, unknown>;
      // stub deps ของ match()
      s.resolveConfig = () => ({});
      s['toUpstreamPayload'] = (input: Record<string, unknown>) => ({
        payload: {
          line_user_id: input.channel_user_id || input.line_user_id,
          web_code: 'w',
          phone_number: '0',
          first_name: 'x',
        },
        error: null,
      });
      s.validateMatchPayload = () => null;
      s['effectiveWebCode'] = () => 'w';
      s['callUpstream'] = jest.fn().mockResolvedValue({
        ok: opts.upstreamOk,
        status: opts.upstreamOk ? 200 : 400,
        error: opts.upstreamOk ? undefined : { code: 'X' },
      });
      s.alreadyLinked = jest.fn().mockResolvedValue(opts.wasLinked);
      s.refreshStoredProfile = jest.fn().mockResolvedValue(undefined);
      s.publishProfileEvent = jest.fn().mockResolvedValue(undefined);
      const pushSpy = jest
        .spyOn(svc as never, 'pushLinkedNotice')
        .mockResolvedValue(undefined as never);
      return { svc, push, pushSpy };
    };
    const runMatch = (svc: CustomerLinkService) =>
      (
        svc as unknown as {
          match: (i: unknown, c: unknown) => Promise<unknown>;
        }
      ).match(
        { channel_user_id: 'Uuser1' },
        {
          hook: {
            _id: 'h1',
            access_token: 'enc:abc',
            custom_tool_status: true,
            custom_tool_id: 't1',
          },
        },
      );

    /* [FIX-20260819-MATCHACTOR] the same call, but made the way an ADMIN makes it.
       The admin id rides in the link token, the controller unpacks it into `ctx`
       and hands it over — from here on it either reaches the log or it does not. */
    const runMatchAsAdmin = (
      svc: CustomerLinkService,
      adminUserId: string | null,
    ) =>
      (
        svc as unknown as {
          match: (i: unknown, c: unknown) => Promise<unknown>;
        }
      ).match(
        { channel_user_id: 'Uuser1' },
        {
          hook: {
            _id: 'h1',
            access_token: 'enc:abc',
            custom_tool_status: true,
            custom_tool_id: 't1',
          },
          adminUserId,
        },
      );

    it('(F1) ⭐ first-link (wasLinked=false) + upstream ok → push ยิง 1 ครั้ง', async () => {
      const { svc, pushSpy } = makeMatchSvc({
        upstreamOk: true,
        wasLinked: false,
      });
      await runMatch(svc);
      expect(pushSpy).toHaveBeenCalledTimes(1);
    });

    /* [FIX-20260819-MATCHACTOR] ───────────────────────────────────────────────
       WHY THIS EXISTS
         `edit()` and `adminUnlinkUpstream()` both pass `{ adminUserId }` to
         `callUpstream`; `match()` did not, and its `ctx` type did not even name
         the field. `callUpstream`'s `meta` defaults to `{}`, so nothing failed —
         the id was simply gone by the time the webhook-log row was built, and
         every admin-made registration was recorded as `actor: 'customer'`.
         TypeScript could not see it: the controller passes a VARIABLE, and excess
         property checking only fires on object literals.
       WHAT IT COSTS TO GET WRONG AGAIN
         the audit row says the customer registered themselves when an admin did it
         for them — and it cannot be reconstructed afterwards, because the id was
         never stored anywhere. เดาย้อนหลังไม่ได้ ต้องถูกตั้งแต่ตอนเขียน. */
    it('(F1b) ⭐ แอดมินกดลงทะเบียนให้ → id ของแอดมินไปถึง callUpstream', async () => {
      const { svc } = makeMatchSvc({ upstreamOk: true, wasLinked: false });
      await runMatchAsAdmin(svc, 'admin-42');
      const spy = (svc as unknown as { callUpstream: jest.Mock }).callUpstream;
      const call = spy.mock.calls[0] as unknown[];
      expect(call[1]).toBe('match');
      expect(call[3]).toEqual({ adminUserId: 'admin-42' });
    });

    it('(F1c) ⭐ ลูกค้ากดเอง (ไม่มี admin) → meta ส่งเป็น null ไม่ใช่ undefined', async () => {
      // null is what `logUpstreamCall` expects for "nobody". Leaving the key out
      // would work today by accident; the shape must match `edit()`'s exactly so
      // the two paths cannot drift apart again.
      const { svc } = makeMatchSvc({ upstreamOk: true, wasLinked: false });
      await runMatch(svc);
      const spy = (svc as unknown as { callUpstream: jest.Mock }).callUpstream;
      const call = spy.mock.calls[0] as unknown[];
      expect(call[3]).toEqual({ adminUserId: null });
    });

    it('(F2) ⭐ re-link (wasLinked=true) → push ไม่ยิง (กัน register กดซ้ำ / H1)', async () => {
      const { svc, pushSpy } = makeMatchSvc({
        upstreamOk: true,
        wasLinked: true,
      });
      await runMatch(svc);
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it('(F3) ⭐ upstream ไม่ ok (res.ok=false) → push ไม่ยิง', async () => {
      const { svc, pushSpy } = makeMatchSvc({
        upstreamOk: false,
        wasLinked: false,
      });
      await runMatch(svc);
      expect(pushSpy).not.toHaveBeenCalled();
    });
  });
});
