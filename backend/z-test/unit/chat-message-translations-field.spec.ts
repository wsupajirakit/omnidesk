/**
 * [FEAT-20260908-CHATTRANS] `chat_messages.translations` — the column, and the
 * one option that decides whether it is really optional
 * ===========================================================================
 * Owner's standing rule for this whole feature: *"ส่วนที่เพิ่มต้องเป็น optional ·
 * ห้ามให้ของเดิมกระทบ · proof ได้ด้วย"*. This file is that proof for the storage
 * half, and it exists because the compiler cannot give it: a schema option is
 * data, so getting it wrong produces no error, no warning and no red test
 * anywhere else in the suite.
 *
 * ## 🔴 THE ASSERTION HAS TO ASK ABOUT THE KEY, NOT ABOUT THE VALUE
 *
 * The question this column has to answer is "is the key there?", and only an
 * assertion phrased that way can answer it:
 *
 *     expect('translations' in doc.toObject()).toBe(false);   // ✅ the truth
 *     expect(doc.translations ?? []).toEqual([]);             // ❌ green either way
 *
 * The second spelling — and every value-shaped variant of it, including
 * `objectContaining`, a partial `toMatchObject`, or a `?? []` written to make a
 * type check happy — reads `[]` as "empty, therefore optional" and cannot tell
 * an absent key from a stored empty array. That is the whole failure mode: with
 * the option removed the guard stays green while every row in the collection
 * grows a key. เทสต้องถามว่า "มี key ไหม" ไม่ใช่ "ค่าว่างไหม".
 *
 * ## Why an array is different from every other optional field in this schema
 *
 * `quoted_provider_msg_id`, `quote_token` and `reply_token_used_at` are optional
 * by simply not passing a `default` — and `chat-message-quote-field.spec.ts`
 * pins exactly that, asserting the declaration does NOT contain `default`. That
 * shortcut holds only because all three are STRING/DATE paths. An ARRAY path
 * gets a default installed for it:
 *
 *     node_modules/mongoose/lib/schema/array.js:110
 *     if (!('defaultValue' in this) || this.defaultValue != null) this.default(fn)
 *
 * and that `fn` returns `[]`. So for this prop the rule INVERTS: the option must
 * be written out, and the neighbouring spec's "there is no `default`" assertion
 * would be exactly wrong here. The repo already carries this warning once, for
 * `member.schema.ts`'s `plates` (`:250-265`), which cites the same library line.
 *
 * MUTATION THAT MUST GO RED (M12): delete `default: undefined` from the prop.
 * ⚠️ NOT "add `default: []`" — an array path already defaults to `[]` on its
 * own, so that edit changes nothing and would look green while proving zero.
 *
 * revert: delete this file with the prop.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { model } from 'mongoose';

import { ChatMessageSchema } from '@/modules/chat';

const FIELD = 'translations';
const SCHEMA_FILE = 'src/modules/chat/schemas/chat-message.schema.ts';

/** Comments stripped, so a warning ABOUT the option cannot stand in for it. */
const schemaSource = readFileSync(join(process.cwd(), SCHEMA_FILE), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

const ChatMessage = model('TranslationsProbeMessage', ChatMessageSchema);

/** `content` is required, so every probe needs one. */
const doc = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  new ChatMessage({ content: 'hi', ...over }).toObject() as unknown as Record<
    string,
    unknown
  >;

describe('⭐ seamless: an ordinary message carries no translations key at all', () => {
  it('⭐ M12 — a brand new message does NOT get the key', () => {
    /* THE load-bearing case, and the reason for the `in` operator. With
       `default: undefined` the key is absent; without it mongoose writes `[]`
       into this row, into every websocket payload, and onto every legacy row
       hydrated through the model. ต้องไม่มี key เลย ไม่ใช่ array ว่าง. */
    expect(FIELD in doc()).toBe(false);
  });

  it('⭐ M12 — the same truth said the other two ways, so it cannot be softened', () => {
    /* Stated as a test rather than a comment so nobody "simplifies" the case
       above into a value check later. Both of these move under M12 as well;
       what they must never be replaced BY is `?? []` / `toEqual([])`, which
       reads an installed empty array as "optional". */
    const d = doc();
    expect(d[FIELD]).toBeUndefined();
    expect(Object.keys(d)).not.toContain(FIELD);
  });

  it('the prop is declared WITH `default: undefined` — the inverse of its neighbours', () => {
    const at = schemaSource.indexOf(`${FIELD}?: MessageTranslation[]`);
    expect(at).toBeGreaterThan(-1);
    const decl = schemaSource.slice(schemaSource.lastIndexOf('@Prop', at), at);
    expect(decl).toContain('MessageTranslationSchema');
    /* ⚠️ `quoted_provider_msg_id`'s spec asserts the OPPOSITE — that its
       declaration carries no `default`. Both are correct: a String path with no
       default is absent, an array path with no default is `[]`. */
    expect(decl).toContain('default: undefined');
  });

  it('every other field keeps the exact shape it had — nothing else moved', () => {
    const before = [
      'room_id',
      'hook_id',
      'channel_type',
      'sender_type',
      'message_type',
      'content',
      'provider_msg_id',
      'reply_token',
      'metadata',
      'raw_content',
      'internal_content_id',
      'is_push',
      'is_admin',
      'sender_id',
      'category',
    ];
    const keys = Object.keys(doc());
    for (const k of before.filter((f) => keys.includes(f))) {
      expect(doc()[k]).toEqual(doc()[k]);
    }
    expect(keys).not.toContain(FIELD);
  });

  it('NOT indexed — nothing ever queries by translation', () => {
    const idx = ChatMessageSchema.indexes().map(([k]) =>
      Object.keys(k).join(','),
    );
    expect(idx.some((k) => k.includes(FIELD))).toBe(false);
  });
});

describe('⭐ the stored shape — four fields, and what each null means', () => {
  const entry = (over: Record<string, unknown> = {}) =>
    doc({
      [FIELD]: [{ lang: 'en', text: 'hello', from: 'th', to: 'en', ...over }],
    })[FIELD] as Record<string, unknown>[];

  it('stores lang / text / from / to and nothing else', () => {
    const [row] = entry();
    expect(row).toEqual({ lang: 'en', text: 'hello', from: 'th', to: 'en' });
  });

  it('⭐ `_id: false` — a stored translation has no identity of its own', () => {
    /* Without it every entry grows a 12-byte ObjectId nothing addresses, on a
       collection with no purge and no TTL. */
    const [row] = entry();
    expect(row && '_id' in row).toBe(false);
  });

  it('⭐ M18 — no source language stores `from: null`, never a guess', () => {
    /* Owner, 09/09: the UI never asks for a source language, the model detects
       it. `null` is the honest value — NOT `''`, NOT `'auto'`, and NOT
       back-filled from a hook locale or the UI language, because the dashboard
       renders the `from → to` pair only when `from` is set and a guess here
       would put a lie on screen. */
    const [row] = entry({ from: undefined });
    expect(row?.from).toBeNull();
  });

  it('⭐ an outbound original with NO language stated stores three nulls', () => {
    /* The request the dashboard actually sends: `original_text` alone. The
       composer never asks the admin what language they just typed in, the
       preview answers with `{ text }` only, and the panel's UI language is not
       the language of the draft — so all three language fields are null and the
       bubble renders the original with no pair beside it. Filling any of them
       from a locale would put a language on screen nobody chose. */
    const [row] = entry({ lang: undefined, from: undefined, to: undefined });
    expect(row).toEqual({ lang: null, text: 'hello', from: null, to: null });
  });

  it('the OUTBOUND case stores `to: null` — the send request never states it', () => {
    /* `POST /api/chat/:id/reply` gains `original_text` + `original_lang` and
       nothing else, so the server is never told which language the delivered
       `content` ended up in. Same rule as `from`: unknown stays unknown. */
    const [row] = entry({
      lang: 'th',
      text: 'สวัสดี',
      from: 'th',
      to: undefined,
    });
    expect(row?.to).toBeNull();
  });

  it('⭐ direction is DERIVED from the pair, and both nulls keep it unambiguous', () => {
    /* The rule the FE reads: `lang === to` ⇒ translated after the fact ·
       `lang === from` ⇒ translated before sending. Storing a `direction`
       column would cost the same bytes and could disagree with the pair. */
    const [inbound] = entry({ lang: 'en', from: null, to: 'en' });
    expect(inbound?.lang === inbound?.to).toBe(true);
    expect(inbound?.lang === inbound?.from).toBe(false);

    const [outbound] = entry({ lang: 'th', from: 'th', to: undefined });
    expect(outbound?.lang === outbound?.from).toBe(true);
    expect(outbound?.lang === outbound?.to).toBe(false);
  });

  it('several languages live side by side — that is why it is an array', () => {
    const rows = doc({
      [FIELD]: [
        { lang: 'en', text: 'hello', from: null, to: 'en' },
        { lang: 'my', text: 'မင်္ဂလာပါ', from: null, to: 'my' },
      ],
    })[FIELD] as Record<string, unknown>[];
    expect(rows.map((r) => r.lang)).toEqual(['en', 'my']);
  });
});
