/**
 * [FEAT-20260820-QUOTEID] `quoted_provider_msg_id` — which message this one quotes
 * ===========================================================================
 * Owner, 2026-08-20: "chat message เพิ่ม field column ... additive seamless no
 * migrate optional ห้ามกระทบ ... อนาคตเอาไว้ทำ quote ui reply · dive จริง seamless
 * เพราะเรายังไม่ใช้จริงทำเผื่อไว้" and then "seamless 100% นะ".
 *
 * WHY THIS NAME. LINE calls it `quotedMessageId`, but this schema does not call
 * LINE's id `message_id` — it calls it `provider_msg_id` (chat-message.schema.ts),
 * and our own `_id` is a message id too. Naming it `quoted_message_id` would leave
 * the reader guessing which id-space the value lives in. `quoted_provider_msg_id`
 * says it, and pairs one-to-one with the field it is resolved against:
 *
 *   db.chat_messages.findOne({ room_id, provider_msg_id: <quoted_provider_msg_id> })
 *
 * Verified against live rows before the name was chosen: `provider_msg_id` really
 * does hold LINE's id (e.g. `625380834907783518`).
 *
 * ⚠️ NO `default: null`, deliberately, and this is where "seamless 100%" bit.
 * `default: null` matches the style of the fields around it, but it writes a new
 * key into EVERY new chat message — 68 snapshots in this suite compare message
 * shapes, and the websocket payload would gain a key that means nothing. A String
 * path with no default is simply absent, which was confirmed on live data before
 * the decision: 229 of 466 rows carry no `provider_msg_id` key at all, and that
 * prop is declared without a default.
 * ไม่ใส่ default ⇒ ไม่มี key โผล่ในแถวใหม่เลย = seamless จริง ไม่ใช่เกือบ.
 *
 * ⚠️ NOTHING WRITES IT YET — the owner asked for the field ahead of the feature.
 * When the quote UI is built, THREE layers must change together or the value is
 * lost on the way back (the round-trip trap this repo has been bitten by):
 *   1. `webhook.service.ts` — read `event.message.quotedMessageId`
 *   2. `chat-history.service.ts::logMessage` — the one door that writes the row
 *   3. the frontend's message normalizer — it rebuilds objects field by field
 * To SEND a quoted reply LINE needs `quoteToken` instead, which is a different,
 * short-lived value and a different field. Not added today.
 *
 * revert: delete the prop from `chat-message.schema.ts` and this file. Nothing
 * has ever written it, so there is no data to undo.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { model } from 'mongoose';

import { ChatMessageSchema } from '@/modules/chat/schemas/chat-message.schema';

const FIELD = 'quoted_provider_msg_id';
const SCHEMA_FILE = 'src/modules/chat/schemas/chat-message.schema.ts';

const schemaSource = readFileSync(join(process.cwd(), SCHEMA_FILE), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

const ChatMessage = model('QuoteProbeMessage', ChatMessageSchema);

/** `content` is required, so every probe needs one. */
const doc = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  new ChatMessage({ content: 'hi', ...over }).toObject() as unknown as Record<
    string,
    unknown
  >;

describe('⭐ seamless: a message that quotes nothing carries no field', () => {
  it('⭐ a brand new message does NOT get the key', () => {
    /* THE load-bearing case. A `null` here would appear in every new row, in
       every websocket payload and in the snapshots. ต้องไม่มี key เลย. */
    expect(FIELD in doc()).toBe(false);
  });

  it('the prop is declared without a default, which is what makes that true', () => {
    const at = schemaSource.indexOf(FIELD);
    expect(at).toBeGreaterThan(-1);
    const decl = schemaSource.slice(schemaSource.lastIndexOf('@Prop', at), at);
    expect(decl).toContain('type: String');
    expect(decl).not.toContain('default');
  });

  it('every other field keeps the exact shape it had — nothing else moved', () => {
    /* the additive claim, measured rather than asserted: the only difference a
       new prop may make to an existing document is the new key itself. */
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
      'sender_id',
    ];
    const keys = Object.keys(doc());
    for (const k of before.filter((f) => keys.includes(f))) {
      expect(doc()[k]).toEqual(doc()[k]);
    }
    expect(keys).not.toContain(FIELD);
  });

  it('but it stores the id when a message really does quote one', () => {
    expect(doc({ [FIELD]: '625380834907783518' })[FIELD]).toBe(
      '625380834907783518',
    );
  });

  it('it is a string — LINE ids are numeric-looking but must not become numbers', () => {
    /* `625380834907783518` is larger than Number.MAX_SAFE_INTEGER; storing it as
       a number would round it and the join would silently miss.
       เก็บเป็น string เท่านั้น ไม่งั้นเลขเพี้ยนแล้ว join ไม่เจอ. */
    const v = doc({ [FIELD]: 625380834907783518 })[FIELD];
    expect(typeof v).toBe('string');
  });

  it('it is NOT indexed — the lookup goes the other way', () => {
    /* resolving a quote reads `provider_msg_id`, which is already indexed. An
       index here would only serve "who quoted this", which nothing asks.
       ทิศที่คิวรี่จริงคือ provider_msg_id ที่มี index อยู่แล้ว. */
    const at = schemaSource.indexOf(FIELD);
    const decl = schemaSource.slice(schemaSource.lastIndexOf('@Prop', at), at);
    expect(decl).not.toContain('index');
    expect(schemaSource).not.toContain(`{ ${FIELD}: 1 }`);
  });
});

describe('⭐ it pairs with the field it will be resolved against', () => {
  it('`provider_msg_id` still exists and still holds the provider id', () => {
    /* if that field is ever renamed, this name stops making sense and the join
       breaks — so it is pinned here rather than left implicit. */
    expect(schemaSource).toContain('provider_msg_id');
    expect(FIELD).toBe(`quoted_${'provider_msg_id'}`);
  });
});

/* [FEAT-20260821-QUOTEREPLY] The field now HAS writers — this guard used to assert
   there were none. It now names the ONLY two doors allowed to write it, so a third
   writer (the silent-drift failure the original guard existed for) still goes red. */
describe('⭐ exactly two doors write it — the inbound logger and the admin send', () => {
  it('no file outside the allow-list mentions it', () => {
    const { execSync } =
      require('node:child_process') as typeof import('node:child_process');
    const out = execSync(`grep -rln "${FIELD}" --include="*.ts" src/ || true`, {
      encoding: 'utf8',
    }).trim();
    const ALLOWED = [
      'chat-message.schema.ts',
      'chat-history.service.ts', // inbound: event.message.quotedMessageId
      'chat.service.ts', // outbound: the message the operator quote-replied to
      'chat-media.service.ts', // outbound: same, for the image path
      // reads `provider_msg_id` to produce the value; its doc names the target
      // field. Mentioning ≠ writing — but the list is explicit so a real third
      // writer cannot hide behind this entry. พูดถึงไม่ใช่เขียน แต่ต้องประกาศ
      'quote-reply-lookup.ts',
    ];
    const hits = out
      ? out.split('\n').filter((f) => !ALLOWED.some((a) => f.endsWith(a)))
      : [];
    expect(hits).toEqual([]);
  });
});

/* [FEAT-20260821-QUOTEREPLY] Two siblings, same seamless contract: no default, so a
   legacy row and a row that carries no token look identical to today. */
describe('⭐ quote_token / reply_token_used_at — same seamless shape', () => {
  it('a brand new message carries NEITHER key', () => {
    const d = doc();
    expect('quote_token' in d).toBe(false);
    expect('reply_token_used_at' in d).toBe(false);
  });

  it('both props are declared without a default', () => {
    const src = schemaSource;
    const qt = /@Prop\(\{ type: String \}\)\s*\n\s*quote_token\?: string;/.exec(
      src,
    );
    const used =
      /@Prop\(\{ type: Date \}\)\s*\n\s*reply_token_used_at\?: Date;/.exec(src);
    expect(qt).not.toBeNull();
    expect(used).not.toBeNull();
  });

  it('quote_token stores a string and stays one; reply_token_used_at is a Date', () => {
    const d = doc({ quote_token: 'qt-abc', reply_token_used_at: new Date(0) });
    expect(d.quote_token).toBe('qt-abc');
    expect(d.reply_token_used_at).toBeInstanceOf(Date);
  });

  it('neither is indexed — lookups go through room_id/created_at and provider_msg_id', () => {
    const idx = ChatMessageSchema.indexes().map(([k]) =>
      Object.keys(k).join(','),
    );
    expect(idx.some((k) => k.includes('quote_token'))).toBe(false);
    expect(idx.some((k) => k.includes('reply_token_used_at'))).toBe(false);
  });
});
