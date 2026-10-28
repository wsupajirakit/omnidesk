/**
 * [FEAT-20260918-AUTOTRANS] Inbound auto-translation — the decision and the seam
 * =============================================================================
 * Owner's hard requirement, 18/09: *"ห้ามกระทบ flow เด็ดขาด ต้องทำงานเหมือนเดิม
 * กรณีปิดการแปล หรือไม่มีการตั้งค่าเลย"*. So the load-bearing cases here are the
 * NEGATIVE ones: an OA that never opened the translate tab must reach the
 * translator ZERO times — proved with a spy call count, not with "it returned
 * null", because those are different failures and only one of them is free.
 *
 * The second requirement is the fallback: *"แปลไม่สำเร็จ (ทุกกรณี) ก็เก็บแบบเดิม"*.
 * Every way the core can fail is driven below and every one must leave the
 * message alone and stay quiet.
 */

import {
  INBOUND_TARGET,
  hasTranslatableText,
  inboundTextRefusal,
  looksAlreadyInTarget,
  shouldAutoTranslateInbound,
} from '@/modules/chat/translate/auto/should-auto-translate';
import { AutoTranslateInboundService } from '@/modules/chat/translate/auto/auto-translate-inbound.service';

describe('[FEAT-20260918-AUTOTRANS] the decision', () => {
  const CUSTOMER_TEXT = {
    senderType: 'customer',
    messageType: 'text',
    content: 'မင်္ဂလာပါ ငွေသွင်းချင်ပါတယ်',
  };

  describe('🔴 off, or never configured, is the default answer', () => {
    it('a hook that never opened the translate tab translates nothing', () => {
      const d = shouldAutoTranslateInbound({
        ...CUSTOMER_TEXT,
        room: {},
        hook: {},
      });

      expect(d).toEqual({ translate: false, reason: 'auto-translate-off' });
    });

    it('a room and hook that do not exist at all translate nothing', () => {
      const d = shouldAutoTranslateInbound({
        ...CUSTOMER_TEXT,
        room: null,
        hook: null,
      });

      expect(d.translate).toBe(false);
    });

    it('🔴 a room switched OFF still follows the hook — it is not a mute', () => {
      /* CHANGED 18/09. This case used to assert the opposite, and that rule was
         the direct cause of "ตั้งค่าระดับ OA ให้แปล แต่มันไม่แปล": a room saved as
         `false` blocked the OA switch from ever reaching it. Owner's rule now:
         either level may switch translation ON; `false` here means "this room
         asks for nothing". ห้อง false = ไปอ่าน OA ต่อ */
      const d = shouldAutoTranslateInbound({
        ...CUSTOMER_TEXT,
        room: { auto_translate: false },
        hook: { auto_translate: true },
      });

      expect(d).toEqual({ translate: true, to: 'th' });
    });

    it('both levels off is the only way translation stops', () => {
      const d = shouldAutoTranslateInbound({
        ...CUSTOMER_TEXT,
        room: { auto_translate: false },
        hook: { auto_translate: false },
      });

      expect(d).toEqual({ translate: false, reason: 'auto-translate-off' });
    });
  });

  describe('positive — it runs, and into the right language', () => {
    it('a room switched ON translates into the console default when no target is set', () => {
      const d = shouldAutoTranslateInbound({
        ...CUSTOMER_TEXT,
        room: { auto_translate: true },
        hook: {},
      });

      expect(d).toEqual({ translate: true, to: INBOUND_TARGET });
    });

    it('inherits ON from the hook when the room never chose', () => {
      const d = shouldAutoTranslateInbound({
        ...CUSTOMER_TEXT,
        room: { auto_translate: null },
        hook: { auto_translate: true },
      });

      expect(d).toEqual({ translate: true, to: 'th' });
    });

    /* 🔴 THE ROOM'S LANGUAGE IS THE CUSTOMER'S, AND IT IS NOT THE INBOUND TARGET.
       The room modal says so in its own words — step 3: *"ภาษาของห้องแชท · ระบุ
       ภาษาของลูกค้าในห้องนี้ เพื่อใช้แปลและตอบกลับ"*. Translating an inbound message
       into it would translate the customer's Burmese into Burmese. It decides the
       REPLY direction; inbound always lands in Thai.
       These cases exist because the first version of this file got it wrong. */
    it.each([
      [
        'a room whose customer writes English',
        { translate_lang: 'en' },
        { translate_lang: 'lo' },
      ],
      [
        'a hook default of Traditional Chinese',
        { translate_lang: null },
        { translate_lang: 'zh-Hant' },
      ],
      ['neither side naming a language', {}, {}],
    ])('%s still reads INTO Thai', (_name, roomLang, hookLang) => {
      const d = shouldAutoTranslateInbound({
        ...CUSTOMER_TEXT,
        room: { auto_translate: true, ...roomLang },
        hook: { auto_translate: true, ...hookLang },
      });

      expect(d).toEqual({ translate: true, to: 'th' });
    });

    it.each(['my', 'lo', 'km', 'zh-Hans', 'zh-Hant', 'en'])(
      'translates a customer writing in %s',
      (lang) => {
        const samples: Record<string, string> = {
          my: 'ငွေသွင်းချင်ပါတယ်',
          lo: 'ຂ້ອຍຢາກຝາກເງິນ',
          km: 'ខ្ញុំចង់ដាក់ប្រាក់',
          'zh-Hans': '我想存钱',
          'zh-Hant': '我想存錢',
          en: 'I want to deposit money',
        };

        const d = shouldAutoTranslateInbound({
          senderType: 'customer',
          messageType: 'text',
          content: samples[lang],
          room: { auto_translate: true },
          hook: {},
        });

        expect(d).toEqual({ translate: true, to: 'th' });
      },
    );
  });

  describe('negative — the message itself disqualifies, before any lookup', () => {
    const ON = { room: { auto_translate: true }, hook: {} };

    it.each([
      [
        'the admin’s own reply',
        { senderType: 'admin' },
        'not-a-customer-message',
      ],
      ['a bot message', { senderType: 'bot' }, 'not-a-customer-message'],
      ['an image', { messageType: 'image' }, 'not-text'],
      ['a sticker', { messageType: 'sticker' }, 'not-text'],
      ['a flex card', { messageType: 'flex' }, 'not-text'],
      ['an empty string', { content: '' }, 'empty'],
      ['whitespace only', { content: '   \n  ' }, 'empty'],
      ['a non-string body', { content: { text: 'hi' } }, 'empty'],
      ['emoji only', { content: '😀😀😀' }, 'nothing-to-translate'],
      ['digits only', { content: '500' }, 'nothing-to-translate'],
      [
        'an amount with punctuation',
        { content: '1,500.00 ✅' },
        'nothing-to-translate',
      ],
      [
        'a bare link',
        { content: 'https://example.com/a/b?c=1' },
        'nothing-to-translate',
      ],
    ])('refuses %s', (_name, override, reason) => {
      const d = shouldAutoTranslateInbound({
        ...CUSTOMER_TEXT,
        ...ON,
        ...override,
      });

      expect(d).toEqual({ translate: false, reason });
    });

    it('skips a Thai message when Thai is the target', () => {
      const d = shouldAutoTranslateInbound({
        ...ON,
        senderType: 'customer',
        messageType: 'text',
        content: 'สวัสดีครับ ขอสอบถามยอดหน่อย',
      });

      expect(d).toEqual({ translate: false, reason: 'already-in-target' });
    });

    it('skips a Thai message even in a room whose language is English', () => {
      /* Naming the room's language `en` says "this customer writes English" —
         it does not ask for the operator's view to be in English. A Thai line is
         already readable, so nothing is spent on it. */
      const d = shouldAutoTranslateInbound({
        room: { auto_translate: true, translate_lang: 'en' },
        hook: {},
        senderType: 'customer',
        messageType: 'text',
        content: 'สวัสดีครับ',
      });

      expect(d).toEqual({ translate: false, reason: 'already-in-target' });
    });

    it('a mixed Thai/English line is NOT treated as already-Thai', () => {
      // The English half may be exactly the part the operator cannot read.
      const d = shouldAutoTranslateInbound({
        ...ON,
        senderType: 'customer',
        messageType: 'text',
        content: 'โอน 500 already done ok?',
      });

      expect(d).toEqual({ translate: true, to: 'th' });
    });
  });

  describe('the helpers, directly', () => {
    it.each([
      ['hello', true],
      ['สวัสดี', true],
      ['😀', false],
      ['...', false],
      ['   ', false],
      ['https://a.b', false],
      ['https://a.b check this', true],
    ])('hasTranslatableText(%j) = %s', (text, expected) => {
      expect(hasTranslatableText(text)).toBe(expected);
    });

    it('looksAlreadyInTarget only ever answers for Thai', () => {
      expect(looksAlreadyInTarget('สวัสดี', 'th')).toBe(true);
      expect(looksAlreadyInTarget('สวัสดี', 'en')).toBe(false);
      expect(looksAlreadyInTarget('hello', 'th')).toBe(false);
      expect(looksAlreadyInTarget('我想存钱', 'th')).toBe(false);
    });

    it('inboundTextRefusal answers null when the message qualifies', () => {
      expect(inboundTextRefusal(CUSTOMER_TEXT)).toBeNull();
    });
  });
});

describe('[FEAT-20260918-AUTOTRANS] the wrapper around the one core translator', () => {
  type Call = [string, { to: string }, unknown, string];

  function build(opts: {
    room?: Record<string, unknown> | null;
    hook?: Record<string, unknown> | null;
    translateImpl?: () => Promise<unknown>;
  }) {
    const calls: Call[] = [];
    const lookups: string[] = [];
    const published: Array<{ type: string; data: unknown }> = [];

    const lean = (doc: unknown) => ({
      select: () => ({ lean: () => Promise.resolve(doc) }),
    });

    const roomModel = {
      findById: (id: unknown) => {
        lookups.push(`room:${String(id)}`);
        return lean(
          opts.room === undefined ? { auto_translate: true } : opts.room,
        );
      },
    };
    const hookModel = {
      findById: (id: unknown) => {
        lookups.push(`hook:${String(id)}`);
        return lean(opts.hook ?? null);
      },
    };
    const translate = {
      translateMessage: (...args: Call) => {
        calls.push(args);
        return opts.translateImpl
          ? opts.translateImpl()
          : Promise.resolve({ success: true });
      },
    };

    const svc = new AutoTranslateInboundService(
      roomModel as never,
      hookModel as never,
      translate as never,
      {
        publish: (type: string, data: unknown) => {
          published.push({ type, data });
          return Promise.resolve();
        },
      } as never,
    );
    return { svc, calls, lookups, published };
  }

  const INBOUND = {
    messageId: 'msg-1',
    roomId: 'room-1',
    hookId: 'hook-1',
    text: 'ငွေသွင်းချင်ပါတယ်',
    senderType: 'customer',
    messageType: 'text',
  };

  it('calls the ONE core translator, as the system, reading INTO Thai', async () => {
    /* The room names English as the CUSTOMER's language; the operator still
       reads Thai. See INBOUND_TARGET. */
    const { svc, calls } = build({
      room: { auto_translate: true, translate_lang: 'en' },
    });

    await expect(svc.onInboundMessage(INBOUND)).resolves.toBe('th');

    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('msg-1');
    expect(calls[0]![1]).toEqual({ to: 'th' });
    expect(calls[0]![2]).toBeUndefined(); // no operator pressed anything
    expect(calls[0]![3]).toBe('system');
  });

  describe('telling the open room, without breaking the gateway’s scoping', () => {
    it('publishes message:updated carrying the entry, scoped by hook_id', async () => {
      const { svc, published } = build({ room: { auto_translate: true } });

      await svc.onInboundMessage(INBOUND);

      expect(published).toHaveLength(1);
      expect(published[0]!.type).toBe('message:updated');
      expect(published[0]!.data).toMatchObject({
        hook_id: 'hook-1',
        _id: 'msg-1',
        room_id: 'room-1',
        message_type: 'text',
      });
    });

    it('🔴 stays SILENT when there is no hook_id — an unscoped event reaches every tenant', async () => {
      const { svc, published } = build({ room: { auto_translate: true } });

      await svc.onInboundMessage({ ...INBOUND, hookId: null });

      expect(published).toEqual([]);
    });

    it('a failing publish does not undo a translation that already succeeded', async () => {
      const { svc } = build({ room: { auto_translate: true } });
      // The publisher used by the harness resolves; this asserts the contract
      // the call site relies on — the publish is `.catch`ed, never awaited for
      // success. Driven here by making the room resolve and the publish throw.
      const exploding = new AutoTranslateInboundService(
        {
          findById: () => ({
            select: () => ({
              lean: () => Promise.resolve({ auto_translate: true }),
            }),
          }),
        } as never,
        {
          findById: () => ({
            select: () => ({ lean: () => Promise.resolve(null) }),
          }),
        } as never,
        {
          translateMessage: () => Promise.resolve({ data: { lang: 'th' } }),
        } as never,
        { publish: () => Promise.reject(new Error('redis down')) } as never,
      );

      await expect(exploding.onInboundMessage(INBOUND)).resolves.toBe('th');
      expect(svc).toBeTruthy();
    });
  });

  it('🔴 a message that cannot qualify costs ZERO database lookups', async () => {
    const { svc, calls, lookups } = build({});

    await svc.onInboundMessage({ ...INBOUND, senderType: 'admin' });
    await svc.onInboundMessage({ ...INBOUND, messageType: 'image' });
    await svc.onInboundMessage({ ...INBOUND, text: '😀' });
    await svc.onInboundMessage({ ...INBOUND, text: '' });

    expect(lookups).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('🔴 a room and hook with translation off never reach the translator', async () => {
    const { svc, calls } = build({ room: {}, hook: {} });

    await expect(svc.onInboundMessage(INBOUND)).resolves.toBeNull();

    expect(calls).toEqual([]);
  });

  it('does not read the hook when the message already failed on the room', async () => {
    const { svc, lookups } = build({ room: null });

    await svc.onInboundMessage(INBOUND);

    expect(lookups).toEqual(['room:room-1']);
  });

  describe('🔴 fallback — every failure keeps the message as it was stored', () => {
    it.each([
      ['the vendor is down', new Error('ECONNRESET')],
      [
        'the cap ledger is full',
        new Error('translate call cap reached (20/20)'),
      ],
      ['the OA has no key', new Error('Line access token is required')],
      ['the OA is out of scope', new Error('insufficient OA access')],
      ['the model timed out', new Error('timeout of 20000ms exceeded')],
      ['something threw a string', 'not even an Error'],
    ])('%s', async (_name, thrown) => {
      const { svc, calls } = build({
        room: { auto_translate: true },
        translateImpl: () => Promise.reject(thrown),
      });

      // Resolves, never rejects: the storage path calls this with `void`.
      await expect(svc.onInboundMessage(INBOUND)).resolves.toBeNull();
      expect(calls).toHaveLength(1);
    });

    it('a failing room lookup is survivable too', async () => {
      const exploding = {
        findById: () => {
          throw new Error('mongo is down');
        },
      };
      const svc = new AutoTranslateInboundService(
        exploding as never,
        exploding as never,
        { translateMessage: () => Promise.resolve({}) } as never,
        { publish: () => Promise.resolve() } as never,
      );

      await expect(svc.onInboundMessage(INBOUND)).resolves.toBeNull();
    });
  });
});
