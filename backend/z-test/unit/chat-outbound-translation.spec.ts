/**
 * [FEAT-20260908-CHATTRANS] the admin send keeps the original, and an ordinary
 * send does not move one byte
 * ===========================================================================
 * On this side the direction inverts. The TRANSLATED text is what reaches the
 * customer and lands in `content`; the admin's own wording rides along on the
 * same request and is stored beside it. The invariant that holds on both sides:
 *
 *   `content` is ALWAYS the text the customer saw.
 *   `translations` ALWAYS holds the same message in the other language.
 *   content = สิ่งที่ลูกค้าเห็นเสมอ · คอลัมน์ = ข้อความเดียวกันอีกภาษา
 *
 * ## 🔴 THE CASE THAT MATTERS MOST IS THE ONE WHERE NOTHING WAS ADDED
 *
 * The owner's rule is that everything this feature adds is OPTIONAL and that it
 * is PROVED, not asserted. So the first describe below takes the document the
 * service creates for a send that mentions no translation at all and compares
 * its KEY SET — not a subset, not `objectContaining` — against the exact set
 * that send produced before this feature existed. A new key of any kind, on any
 * send, fails it.
 *
 * The frozen list is not a copy of the current code: it is the list
 * `chat-service-quote-reply.spec.ts`'s "a plain text send is byte-identical to
 * before" case has been guarding since 21/08, read off the `create()` call that
 * predates this work.
 *
 * ## Why the TEXT decides, and the language is allowed to be missing
 *
 * `original_lang` is optional and in practice usually ABSENT: the composer never
 * asks the admin what language they just typed in, the preview answers with
 * `{ text }` only, and the panel's UI language is not the language of the draft.
 * So the dashboard sends the original text alone rather than guess (agent E,
 * 09/09), and the entry is stored with `lang`/`from` null — the bubble renders
 * the original with no language pair, which is exactly what is known about it.
 * Requiring both would have made this half of the feature silently dead for the
 * request the dashboard actually sends.
 *
 * A language with NO text is still nothing, and that case is below.
 *
 * ## The alias that produced a wrong cross-repo contract
 *
 * `@Post([':id/push', ':id/reply'])` mounts two paths on ONE handler with ONE
 * body type. The dashboard has called `/push` since 28/07 and has never called
 * `/reply`, so a reader of either name alone sees half the surface. The second
 * describe pins the alias itself.
 *
 * revert: delete this file with the two DTO fields.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Types } from 'mongoose';

import { outboundTranslationEntry } from '@/modules/chat/translate/translation-store';

import { ChatService, PushOnlySendStrategy } from '@/modules/chat';

const roomId = new Types.ObjectId();
const hookId = new Types.ObjectId();
const ourId = new Types.ObjectId();

const SUPER = {
  userId: 'a0d00000000000000000000a',
  username: 'op1',
  displayName: 'Operator One',
  roleName: 'superadmin',
} as never;

/**
 * The EXACT key set an admin text send has written since [FEAT-20260808-ISPUSH].
 * 🔴 Read off the pre-existing `create()` call, not off today's code. If this
 * feature ever adds a key to an ordinary send, this list is what says so.
 */
const KEYS_BEFORE_THIS_FEATURE = [
  'channel_type',
  'content',
  'hook_id',
  'is_admin',
  'is_push',
  'message_type',
  'metadata',
  'room_id',
  'sender_id',
  'sender_type',
];

function build() {
  const created: Record<string, unknown>[] = [];
  const wire: Record<string, unknown>[] = [];
  const core = {
    dispatch: jest.fn((req: Record<string, unknown>) => {
      wire.push(req);
      return Promise.resolve({
        ok: true,
        status: 200,
        attempts: 1,
        durationMs: 1,
        data: {},
      });
    }),
  };
  const chatMessageModel = {
    create: jest.fn((doc: Record<string, unknown>) => {
      created.push(doc);
      const row: Record<string, unknown> = { _id: ourId, ...doc };
      row['set'] = (patch: Record<string, unknown>) =>
        Object.assign(row, patch);
      return Promise.resolve(row);
    }),
    findOne: jest.fn(() => {
      const chain = {
        sort: () => chain,
        select: () => chain,
        lean: () => Promise.resolve(null),
      };
      return chain;
    }),
    updateOne: jest.fn(() => ({
      exec: () => Promise.resolve({ matchedCount: 1 }),
    })),
  };
  const svc = new ChatService(
    {
      findById: jest.fn().mockResolvedValue({
        _id: roomId,
        hook_id: hookId,
        channel_type: 'line',
        line_user_id: 'Uabc',
      }),
    } as never,
    chatMessageModel as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      findById: jest.fn().mockResolvedValue({
        _id: hookId,
        alias: 'oa-1',
        channel_type: 'line',
        access_token: 'unit-test-token',
      }),
    } as never,
    { publish: jest.fn().mockResolvedValue(undefined) } as never,
    { safeDecrypt: jest.fn((v: unknown) => v) } as never,
    {} as never,
    {
      getSendAdapter: jest.fn(() => ({
        channelType: 'line',
        send: jest.fn(),
      })),
    } as never,
    { createLog: jest.fn(() => Promise.resolve({})) } as never,
    new PushOnlySendStrategy(core as never),
  );
  return { svc, created, wire, chatMessageModel };
}

const send = (h: ReturnType<typeof build>, dto: Record<string, unknown>) =>
  h.svc.sendChatReply(String(roomId), undefined, dto, SUPER);

describe('⭐ an ordinary send is byte-identical to before', () => {
  it('⭐ M12/optionality — the created document grows NO key at all', async () => {
    const h = build();
    await send(h, { text: 'hello' });

    /* the whole key set, sorted — not a subset and not objectContaining, so a
       key added anywhere by anything fails this. */
    expect(Object.keys(h.created[0] ?? {}).sort()).toEqual(
      KEYS_BEFORE_THIS_FEATURE,
    );
    expect('translations' in (h.created[0] ?? {})).toBe(false);
  });

  it('and what goes on the wire to the customer is untouched', async () => {
    const h = build();
    await send(h, { text: 'hello' });
    expect(h.wire).toEqual([
      {
        kind: 'push',
        token: 'unit-test-token',
        to: 'Uabc',
        messages: [{ type: 'text', text: 'hello' }],
        timeoutMs: 5000,
      },
    ]);
  });

  it('⭐ M19 — the TEXT is what decides: a language with no text stores nothing', async () => {
    /* `original_lang` alone is not a translation — there is nothing to render.
       Reversing the predicate to look at the language instead of the text
       reddens this. */
    for (const dto of [
      { text: 'hello' },
      { text: 'hello', original_lang: 'th' },
      { text: 'hello', original_text: '   ' },
      { text: 'hello', original_text: '   ', original_lang: 'th' },
    ]) {
      const h = build();
      await send(h, dto);
      expect(Object.keys(h.created[0] ?? {}).sort()).toEqual(
        KEYS_BEFORE_THIS_FEATURE,
      );
    }
  });
});

describe('⭐ ONE dto serves BOTH mounted paths — the alias nobody sees', () => {
  it('⭐ `:id/push` and `:id/reply` are one handler, so both accept the new fields', () => {
    /* This alias is the trap that produced a wrong cross-repo contract on
       09/09. The dashboard has posted to `/api/chat/:id/push` since 28/07
       (`[FIX-20260728-PUSHNAME]`) and has NOT called `/reply`; anyone reading
       either name alone sees only half the surface. `@Post([...])` mounts both
       on one method taking one `SendChatReplyDto`, so adding the two optional
       fields covers the path actually used — and there must NEVER be a second
       DTO or a second handler for `/push`. */
    const src = readFileSync(
      join(process.cwd(), 'src/modules/chat/chat.controller.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    expect(src).toContain("@Post([':id/push', ':id/reply'])");
    /* exactly ONE handler binds that array, and exactly ONE body type */
    expect(src.match(/@Post\(\[':id\/push', ':id\/reply'\]\)/g)).toHaveLength(
      1,
    );
    expect(src.match(/@Body\(\) dto: SendChatReplyDto/g)).toHaveLength(1);
    /* and no second mount of either name anywhere in the controller */
    expect(src.match(/@Post\('.*push.*'\)/g)).toBeNull();
  });

  it('⭐ the DTO the ACTUALLY-CALLED path uses accepts the two optional fields', async () => {
    /* Driven through `sendChatReply` itself — the one method both routes reach
       — with the body the composer really sends: the original text, no
       language, because nobody is in a position to state one. */
    const h = build();
    await send(h, { text: 'Hello', original_text: 'สวัสดี' });
    expect(h.created[0]?.translations).toEqual([
      { lang: null, text: 'สวัสดี', from: null, to: null },
    ]);
  });
});

describe('⭐⭐⭐ [OUTBOUNDTARGET] the language the customer is reading', () => {
  it("⭐⭐⭐ `translated_lang` is stored as the entry's `to`", () => {
    /* 🔴 The admin PICKED this in the composer — it is not detected and not
       guessed. The send simply never carried it, so an admin bubble had no
       language label at all while the customer\'s bubble had one. */
    expect(outboundTranslationEntry('สวัสดี', 'th', 'my')).toEqual({
      lang: 'th',
      text: 'สวัสดี',
      from: 'th',
      to: 'my',
    });
  });

  it('⭐⭐⭐ absent ⇒ the row is byte-identical to yesterday — no backfill, no guess', () => {
    /* Owner, 10/09: no backfill. Every row written before today keeps `to: null`
       and the bubble renders what it has. A send from an older dashboard must
       produce exactly the same document it always did. */
    expect(outboundTranslationEntry('สวัสดี', 'th')).toEqual({
      lang: 'th',
      text: 'สวัสดี',
      from: 'th',
      to: null,
    });
    expect(outboundTranslationEntry('สวัสดี', null, '  ')).toEqual({
      lang: null,
      text: 'สวัสดี',
      from: null,
      to: null,
    });
  });

  it('⭐⭐ …and it reaches the document through the real send', async () => {
    const h = build();
    await send(h, {
      text: '早安',
      original_text: 'good morning',
      original_lang: 'en',
      translated_lang: 'zh-Hant',
    });
    expect(h.created[0]?.translations).toEqual([
      { lang: 'en', text: 'good morning', from: 'en', to: 'zh-Hant' },
    ]);
  });
});

describe('⭐ a translated send stores the original beside the delivered text', () => {
  it('⭐ ONE insert carries both — content is what the customer got', async () => {
    const h = build();
    await send(h, {
      text: 'Hello, how may I help?',
      original_text: 'สวัสดีครับ มีอะไรให้ช่วยไหม',
      original_lang: 'th',
    });

    /* exactly one write — an insert cannot half-happen, so there is no second
       operation left to fail after the customer already has the text. */
    expect(h.chatMessageModel.create).toHaveBeenCalledTimes(1);

    const doc = h.created[0] ?? {};
    expect(doc.content).toBe('Hello, how may I help?');
    expect(doc.translations).toEqual([
      {
        lang: 'th',
        text: 'สวัสดีครับ มีอะไรให้ช่วยไหม',
        from: 'th',
        to: null,
      },
    ]);
  });

  it('⭐ the CUSTOMER receives the translated text, never the Thai original', async () => {
    /* The one mistake on this path that reaches a real person: swapping the two
       sends the admin's own language to someone who cannot read it. */
    const h = build();
    await send(h, {
      text: 'Hello, how may I help?',
      original_text: 'สวัสดีครับ',
      original_lang: 'th',
    });
    const messages = (h.wire[0]?.messages ?? []) as { text: string }[];
    expect(messages[0]?.text).toBe('Hello, how may I help?');
    expect(messages[0]?.text).not.toContain('สวัสดี');
  });

  it('the direction derives to "translated BEFORE sending"', async () => {
    /* `lang === from` on an outbound entry · `lang === to` on an inbound one.
       Nothing stores a `direction` column: it would cost the same bytes and
       could disagree with the pair it is derived from. */
    const h = build();
    await send(h, {
      text: 'hi',
      original_text: 'สวัสดี',
      original_lang: 'th',
    });
    const [entry] = (h.created[0]?.translations ?? []) as {
      lang: string;
      from: string | null;
      to: string | null;
    }[];
    expect(entry?.lang === entry?.from).toBe(true);
    expect(entry?.lang === entry?.to).toBe(false);
  });

  it('the original is trimmed, so trailing whitespace never becomes a stored word', async () => {
    const h = build();
    await send(h, {
      text: 'hi',
      original_text: '  สวัสดี  ',
      original_lang: ' th ',
    });
    const [entry] = (h.created[0]?.translations ?? []) as { text: string }[];
    expect(entry?.text).toBe('สวัสดี');
  });
});
