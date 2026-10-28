/* [FEAT-20260821-CHATPUSHCORE] candidate C — ticket-support console onto the push core
 * ===========================================================================
 * The admin chat console (FE `/ticket-support`) sends text, image(s) and
 * stickers through three routes that all land on `LineSendAdapter`, which POSTs
 * to LINE with its own axios call. The push core in `src/infra/line/` was built
 * in Phase 1-2 to be that one sender and has carried a chat builder since — but
 * nothing has ever called it (`grep "infra/line" src --exclude-dir=infra` found
 * only the quota reader).
 *
 * WHAT MOVING BUYS, and it is one thing, not a list: `X-Line-Retry-Key`. The
 * adapter has none (grep = 0). An admin whose network stutters mid-send has no
 * way to know whether LINE took the message: sending again risks a duplicate,
 * not sending risks silence. The core sends the same key on every attempt, and
 * treats LINE's 409 as "an earlier attempt already won".
 *
 * ⚠️ THE MIGRATION MUST CHANGE NOTHING THE CUSTOMER OR THE ADMIN CAN SEE.
 * Three things are therefore pinned here BEFORE any wiring is touched:
 *
 *   1. THE WIRE PAYLOAD. Whatever the old adapter put on the wire, the core's
 *      builder must produce byte-for-byte — for all four kinds. This suite
 *      drives the REAL adapter with axios stubbed, captures what it sent, and
 *      compares it against `buildChatMessages`. Reading both sources and
 *      agreeing they "look the same" is not proof; this is.
 *
 *   2. FAILURE IS A THROW. `chat.service.ts:717-722` does
 *      `try { adapter.send() } catch (err) { audit(err); throw err }` — the
 *      thrown error is what tells the operator the send failed. The core does
 *      the opposite by design: it NEVER throws and returns `{ok:false}`. A
 *      migration that forgets to turn a non-ok result back into a throw would
 *      show "sent" for a message LINE refused. ล้มต้องโยน ไม่ใช่คืนเงียบ ๆ.
 *
 *   3. THE TIMEOUT SPLIT. 8s for image/images, 5s for text/sticker
 *      (`line-send-adapter.ts:166`, ported from legacy). The core takes
 *      `timeoutMs` per request, so the split has to be passed explicitly or
 *      every image send silently gets the shorter budget.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import axios from 'axios';

import { LineSendAdapter } from '@/modules/chat';
import { buildChatMessages } from '@/infra/line';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

type ChatMsg = Parameters<LineSendAdapter['send']>[1];

const CASES: Array<{ name: string; msg: ChatMsg }> = [
  { name: 'text', msg: { kind: 'text', text: 'สวัสดีค่ะ' } },
  {
    name: 'image (no caption)',
    msg: { kind: 'image', imageUrl: 'https://x.test/a.jpg' },
  },
  {
    name: 'image + caption',
    msg: { kind: 'image', imageUrl: 'https://x.test/a.jpg', text: 'ดูรูปนี้' },
  },
  {
    name: 'images ×3',
    msg: {
      kind: 'images',
      imageUrls: [
        'https://x.test/1.jpg',
        'https://x.test/2.jpg',
        'https://x.test/3.jpg',
      ],
    },
  },
  {
    name: 'images ×2 + caption last',
    msg: {
      kind: 'images',
      imageUrls: ['https://x.test/1.jpg', 'https://x.test/2.jpg'],
      text: 'สองรูป',
    },
  },
  {
    name: 'images ×2 + caption FIRST (overflow batch)',
    msg: {
      kind: 'images',
      imageUrls: ['https://x.test/1.jpg', 'https://x.test/2.jpg'],
      text: 'ต่อจากชุดก่อน',
      textFirst: true,
    },
  },
  {
    name: 'sticker',
    msg: { kind: 'sticker', packageId: '446', stickerId: '1988' },
  },
];

describe('⭐ [FEAT-20260821-CHATPUSHCORE] the core builds the SAME wire payload as the adapter', () => {
  const adapter = new LineSendAdapter();
  const ctx = { to: 'U123', accessToken: 'tok-abc' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
  });

  it.each(CASES)('⭐⭐ $name — byte-for-byte', async ({ msg }) => {
    await adapter.send(ctx, msg);
    const [, body] = mockedAxios.post.mock.calls[0] as [
      string,
      { messages: unknown[] },
    ];
    /* what the adapter ACTUALLY sent, against what the core would build.
       ⚠️ ไม่ใช่การอ่านโค้ดสองไฟล์แล้วบอกว่า "เหมือนกัน" — จับของที่ยิงจริงมาเทียบ */
    expect(buildChatMessages(msg)).toEqual(body.messages);
  });

  it('⭐ the guards agree too — an empty batch is refused on both sides', () => {
    const empty = { kind: 'images' as const, imageUrls: [] };
    expect(() => buildChatMessages(empty)).toThrow(/at least 1 image/);
  });

  it('⭐ and the 5-object ceiling is the same number on both sides', () => {
    const six = {
      kind: 'images' as const,
      imageUrls: ['a', 'b', 'c', 'd', 'e'].map(
        (n) => `https://x.test/${n}.jpg`,
      ),
      text: 'หก',
    };
    expect(() => buildChatMessages(six)).toThrow(
      /exceed LINE's 5-per-push limit/,
    );
  });
});

describe('⭐ [FEAT-20260821-CHATPUSHCORE] what the migration must preserve', () => {
  const src = (p: string): string =>
    readFileSync(join(process.cwd(), p), 'utf8');

  it('⭐⭐ a non-ok result is turned back into a throw', () => {
    /* the core never throws (`line-push.ts:38-40`), the caller contract does
       (`chat.service.ts:717-722`). Without this the operator sees "sent" for a
       message LINE refused. */
    const code = src('src/modules/chat/chat.service.ts');
    expect(code).toMatch(/if \(!res\.ok\)/);
    expect(code).toMatch(/throw/);
  });

  it('⭐⭐ the failure message keeps its old wording', () => {
    /* the FE surfaces this string. The core's own `reason` is a different
       format (`HTTP 400 - … [reqId: …]`), so the old extractor is reused rather
       than swapped — otherwise the admin sees a new error text for a failure
       that has not changed. ข้อความที่แอดมินเห็นต้องไม่เปลี่ยน.

       ⚠️ ASSERT THE USE, NOT THE WORD. The first version checked only that
       `extractLineReason` appeared somewhere in the file — which the IMPORT
       line satisfies, so a mutation that swapped the call for `res.reason`
       stayed green. Pin the expression that actually builds the message.
       มีคำ ≠ ถูกใช้ (บทเรียนซ้ำรอบที่สามวันนี้). */
    const code = src('src/modules/chat/chat.service.ts');
    expect(code.replace(/\s+/g, ' ')).toContain(
      'const reason = extractLineReason(raw) ?? res.reason;',
    );
    expect(code).toContain('LINE push failed');
  });

  it('⭐⭐ the 8s/5s timeout split is passed explicitly', () => {
    const code = src('src/modules/chat/chat.service.ts');
    expect(code).toMatch(/timeoutMs/);
    expect(code).toMatch(/8000/);
    expect(code).toMatch(/5000/);
  });

  it('⭐ the audit still receives the raw axios error, not a rewritten one', () => {
    /* `outbound-audit.ts:126-149` reads `.response.status` and `.code` off the
       error to fill webhook_logs. The core keeps the untouched axios error on
       `result.raw` for exactly this. */
    const code = src('src/modules/chat/chat.service.ts');
    expect(code).toMatch(/res\.raw/);
  });

  it('⭐⭐ the image path moves too — it is the same candidate', () => {
    /* text + sticker live in `chat.service.ts`, image(s) in
       `chat-media.service.ts`. Both are the ticket-support console; migrating
       one and not the other would leave the console half on each sender. */
    const media = src('src/modules/chat/chat-media.service.ts');
    /* [FEAT-20260821-QUOTEREPLY] the dispatcher moved one layer down, into the
       send ladder both services bind (`OUTBOUND_SEND_STRATEGY`). The candidate
       is still "the console" — the proof that it is the same wire is
       chat-media-outbound-log.spec.ts passing unchanged through the real
       PushOnlySendStrategy. */
    expect(media).toContain('OUTBOUND_SEND_STRATEGY');
    expect(media).toContain('buildChatMessages');
    expect(media).toMatch(/timeoutMs/);
    expect(media).toMatch(/if \(!res\.ok\)/);
  });

  it('⭐ the old adapter is left in place — the channel layer still exists', () => {
    /* `ChannelRegistry` is the channel-agnostic seam a future non-LINE channel
       plugs into; deleting the LINE adapter would take that with it. It simply
       stops being the path the chat console uses. อย่าลบ ยังมีหน้าที่อยู่. */
    const adapter = src('src/modules/chat/channels/line-send-adapter.ts');
    expect(adapter).toContain('class LineSendAdapter');
    expect(src('src/modules/chat/channels/channel-registry.ts')).toContain(
      'class ChannelRegistry',
    );
  });

  it('⭐ it binds to the DISPATCHER, never to LinePushService directly', () => {
    /* `line-push.ts:52-54`: callers take the wrapper so a real queue can slot
       in later by swapping one provider binding.
       ⚠️ เช็คบนโค้ดที่ **ตัดคอมเมนต์แล้ว** — คอมเมนต์ข้าง ๆ อธิบายว่า "ห้ามผูกกับ
       LinePushService" ซึ่งมีชื่อนั้นอยู่ในประโยค · การพูดถึงในคอมเมนต์ ≠ การผูก
       (บทเรียนเดียวกับ avatarRingClass ใน FE เมื่อเช้า) */
    const noComments = (t: string): string =>
      t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    /* [FEAT-20260821-QUOTEREPLY] the services now hold the ladder, and the
       ladder holds the dispatcher — so the binding rule is checked where the
       binding IS. The services themselves must name neither core class. */
    const ladder = noComments(
      src('src/modules/chat/channels/outbound-send-strategy.ts'),
    );
    expect(ladder).toContain(`LinePushDispatcher`);
    expect(ladder).not.toContain(`LinePushService`);
    for (const f of [
      'src/modules/chat/chat.service.ts',
      'src/modules/chat/chat-media.service.ts',
    ]) {
      const code = noComments(src(f));
      expect(code).toContain(`OUTBOUND_SEND_STRATEGY`);
      expect(code).not.toContain(`LinePushService`);
    }
  });
});
