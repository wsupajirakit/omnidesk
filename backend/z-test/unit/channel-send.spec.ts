/**
 * [FIX-20260808-CHANNELSEND] The channel send-adapter layer, proven in isolation.
 *
 * Mirrors the legacy channels/ module (legacy-api/src/channels/). Two things are
 * pinned here:
 *   1. ChannelRegistry null-safety — the rule that a declared-but-unbuilt
 *      channel (e.g. "facebook") resolves to NULL and must NEVER fall back to
 *      LINE, while a legacy hook (no channel_type) defaults to LINE.
 *   2. LineSendAdapter payload mapping + error extraction, with axios stubbed —
 *      NO real network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import axios from 'axios';

import {
  ChannelRegistry,
  LineSendAdapter,
  servedByLineCore,
} from '@/modules/chat';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ChannelRegistry — getSendAdapter null-safety (legacy channels/index.js)', () => {
  const registry = new ChannelRegistry(new LineSendAdapter());

  it('legacy hook (undefined channel_type) → LINE adapter', () => {
    const a = registry.getSendAdapter(undefined);
    expect(a).not.toBeNull();
    expect(a?.channelType).toBe('line');
  });

  it("legacy hook (empty '' channel_type) → LINE adapter", () => {
    const a = registry.getSendAdapter('');
    expect(a).not.toBeNull();
    expect(a?.channelType).toBe('line');
  });

  it("'line' → LINE adapter", () => {
    const a = registry.getSendAdapter('line');
    expect(a?.channelType).toBe('line');
  });

  it("'facebook' → null, NEVER a LINE fallback (the failure this rule prevents)", () => {
    const a = registry.getSendAdapter('facebook');
    expect(a).toBeNull();
    // Explicitly assert it did not silently resolve to LINE.
    expect(a?.channelType).not.toBe('line');
  });

  it("'whatsapp' → null (declared-but-unbuilt channel cannot send)", () => {
    expect(registry.getSendAdapter('whatsapp')).toBeNull();
  });
});

describe('LineSendAdapter.send — payload mapping (axios stubbed, no network)', () => {
  const adapter = new LineSendAdapter();
  const ctx = { to: 'U123', accessToken: 'tok-abc' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
  });

  const lastCall = () => mockedAxios.post.mock.calls[0];

  it('text → [{type:text,text}] with to + Bearer auth', async () => {
    await adapter.send(ctx, { kind: 'text', text: 'hello' });
    const [url, body, cfg] = lastCall() as [
      string,
      { to: string; messages: unknown[] },
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(body.to).toBe('U123');
    expect(body.messages).toEqual([{ type: 'text', text: 'hello' }]);
    expect(cfg.headers.Authorization).toBe('Bearer tok-abc');
  });

  it('image → [{type:image,originalContentUrl,previewImageUrl}]', async () => {
    await adapter.send(ctx, {
      kind: 'image',
      imageUrl: 'https://cdn/x.jpg',
    });
    const body = (lastCall() as [string, { messages: unknown[] }])[1];
    expect(body.messages).toEqual([
      {
        type: 'image',
        originalContentUrl: 'https://cdn/x.jpg',
        previewImageUrl: 'https://cdn/x.jpg',
      },
    ]);
  });

  it('image with caption → image message + trailing text message', async () => {
    await adapter.send(ctx, {
      kind: 'image',
      imageUrl: 'https://cdn/x.jpg',
      text: 'caption',
    });
    const body = (lastCall() as [string, { messages: unknown[] }])[1];
    expect(body.messages).toEqual([
      {
        type: 'image',
        originalContentUrl: 'https://cdn/x.jpg',
        previewImageUrl: 'https://cdn/x.jpg',
      },
      { type: 'text', text: 'caption' },
    ]);
  });

  it('sticker → [{type:sticker,packageId,stickerId}]', async () => {
    await adapter.send(ctx, {
      kind: 'sticker',
      packageId: '11537',
      stickerId: '52002734',
    });
    const body = (lastCall() as [string, { messages: unknown[] }])[1];
    expect(body.messages).toEqual([
      { type: 'sticker', packageId: '11537', stickerId: '52002734' },
    ]);
  });

  it('throws with the extracted reason on a non-2xx axios error', async () => {
    const axiosErr = {
      response: {
        status: 400,
        data: {
          message: 'The property, messages[0], is invalid',
          details: [
            { property: 'messages[0].text', message: 'must not be empty' },
          ],
        },
        headers: { 'x-line-request-id': 'req-xyz' },
      },
    };
    mockedAxios.post.mockRejectedValue(axiosErr);

    const err = await adapter
      .send(ctx, { kind: 'text', text: '' })
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    const reason = (err as Error).message;
    expect(reason).toMatch(/HTTP 400/);
    expect(reason).toMatch(/The property, messages\[0\], is invalid/);
    expect(reason).toMatch(/messages\[0\]\.text: must not be empty/);
    expect(reason).toMatch(/reqId: req-xyz/);
  });
});

/**
 * [FEAT-20260816-MULTIIMG] kind:'images' — one push call carrying several image
 * objects (+ the caption, whose position the batch planner decides). The adapter
 * stays dumb: map and validate the 5-object ceiling, never split.
 */
describe('LineSendAdapter.send — images batch mapping (axios stubbed, no network)', () => {
  const adapter = new LineSendAdapter();
  const ctx = { to: 'U123', accessToken: 'tok-abc' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
  });

  const sentMessages = () =>
    (mockedAxios.post.mock.calls[0] as [string, { messages: unknown[] }])[1]
      .messages;

  const img = (u: string) => ({
    type: 'image',
    originalContentUrl: u,
    previewImageUrl: u,
  });

  it('3 images, no text → 3 image objects in order, ONE call', async () => {
    await adapter.send(ctx, {
      kind: 'images',
      imageUrls: [
        'https://cdn/a.jpg',
        'https://cdn/b.jpg',
        'https://cdn/c.jpg',
      ],
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(sentMessages()).toEqual([
      img('https://cdn/a.jpg'),
      img('https://cdn/b.jpg'),
      img('https://cdn/c.jpg'),
    ]);
  });

  it('images + trailing caption (textFirst absent) → images then text, same order as the legacy single send', async () => {
    await adapter.send(ctx, {
      kind: 'images',
      imageUrls: ['https://cdn/a.jpg'],
      text: 'cap',
    });
    expect(sentMessages()).toEqual([
      img('https://cdn/a.jpg'),
      { type: 'text', text: 'cap' },
    ]);
  });

  it("textFirst → text LEADS the images (the overflow call's arrangement)", async () => {
    await adapter.send(ctx, {
      kind: 'images',
      imageUrls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'],
      text: 'cap',
      textFirst: true,
    });
    expect(sentMessages()).toEqual([
      { type: 'text', text: 'cap' },
      img('https://cdn/a.jpg'),
      img('https://cdn/b.jpg'),
    ]);
  });

  it('5 images + text = 6 objects → throws BEFORE any network call (planner bug guard)', async () => {
    const six = await adapter
      .send(ctx, {
        kind: 'images',
        imageUrls: [
          'https://cdn/1.jpg',
          'https://cdn/2.jpg',
          'https://cdn/3.jpg',
          'https://cdn/4.jpg',
          'https://cdn/5.jpg',
        ],
        text: 'cap',
      })
      .then(() => null)
      .catch((e: Error) => e);
    expect(six).toBeInstanceOf(Error);
    expect((six as Error).message).toMatch(/5/);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('0 images → throws before any network call', async () => {
    const none = await adapter
      .send(ctx, { kind: 'images', imageUrls: [] })
      .then(() => null)
      .catch((e: Error) => e);
    expect(none).toBeInstanceOf(Error);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

/**
 * [FIX-20260827-CGATECHANNEL] 📖 todo/task/27082026/todo2_27082026_candidate-c-gate-channel-mismatch.md
 * เกตของ chat console ต้องคุ้ม "เส้นที่ส่งจริง" ไม่ใช่ "มี adapter ไหม"
 * ============================================================================
 * `ChannelRegistry` สร้างมากันเคสเดียว (คอมเมนต์ตัวเองที่ `channel-registry.ts:36-41`):
 * channel ที่ประกาศไว้แต่ยังไม่มี adapter ต้องไม่ตกไปใช้ LINE เพราะจะยิงข้อความของ
 * hook นั้นเข้า api.line.me พร้อม token ผิดตัว
 *
 * 🔴 แต่ตั้งแต่ candidate C ย้ายการส่งไปคอร์ LINE (`chat.service.ts:853`) เกตเดิม
 * กันไม่ได้อีกแล้ว: มันถามว่า "มี adapter ของ channel นี้ไหม" ส่วนเส้นที่ส่งจริงคือ
 * `LinePushDispatcher` ซึ่ง **เป็น LINE ล้วน ไม่มีพารามิเตอร์ channel เลย**
 * (`infra/line/push/line-push.ts:80-87` — KIND_URL ผูก LINE URL ทั้ง 6 kind)
 * ⇒ วันที่มีคนลงทะเบียน adapter ตัวที่สองตามที่คอมเมนต์ registry เชิญไว้
 * ("ZERO call-site changes") เกตจะ **ผ่าน** แล้วข้อความวิ่งเข้า api.line.me ทันที
 * — หายนะบรรทัดเดียวกับที่ registry สร้างมาเพื่อกัน
 *
 * ⚠️ เทสนี้ต้องลงทะเบียน adapter ปลอมเอง เพราะวันนี้รีจิสทรีมีแต่ `line` ตัวเดียว
 * ⇒ ถ้าไม่จำลอง ทั้งโค้ดที่ถูกและโค้ดที่พังให้ผลเท่ากัน = เทสไร้ฟัน
 */
describe('[FIX-20260827-CGATECHANNEL] servedByLineCore — เกตของเส้นส่งจริง', () => {
  /** adapter ปลอมของ channel อื่น — แทนวันที่ facebook ถูกเพิ่มเข้ารีจิสทรีจริง */
  const fakeFacebook = {
    channelType: 'facebook',
    capabilities: { text: true, image: false, sticker: false, flex: false },
    send: async (): Promise<void> => {},
  };

  const withFacebook = (): ChannelRegistry => {
    const r = new ChannelRegistry(new LineSendAdapter());
    // ลงทะเบียนตรง ๆ เหมือนที่คอมเมนต์ registry บอกให้ทำ (`facebook: this.facebookAdapter`)
    (r as unknown as { adapters: Record<string, unknown> }).adapters[
      'facebook'
    ] = fakeFacebook;
    return r;
  };

  it('🔴 channel ที่มี adapter แต่ไม่ใช่ line ⇒ ห้ามผ่านเกต', () => {
    /* mutation ที่เคสนี้ฆ่า: กลับไปใช้ `!!getSendAdapter(ct)` แบบเดิม — จะได้ true
       แล้วข้อความของ FB hook ถูกยิงเข้า api.line.me ด้วย token ผิด */
    const r = withFacebook();
    expect(r.getSendAdapter('facebook')).not.toBeNull(); // adapter มีจริง
    expect(servedByLineCore(r.getSendAdapter('facebook'))).toBe(false); // แต่คอร์ส่งให้ไม่ได้
  });

  it('legacy hook (undefined / empty) ⇒ ผ่าน — พฤติกรรมเดิมทุกไบต์', () => {
    const r = withFacebook();
    expect(servedByLineCore(r.getSendAdapter(undefined))).toBe(true);
    expect(servedByLineCore(r.getSendAdapter(''))).toBe(true);
  });

  it("'line' ⇒ ผ่าน", () => {
    expect(servedByLineCore(withFacebook().getSendAdapter('line'))).toBe(true);
  });

  it("channel ที่ยังไม่มี adapter เลย ('whatsapp') ⇒ ไม่ผ่าน — พฤติกรรมเดิม", () => {
    expect(servedByLineCore(withFacebook().getSendAdapter('whatsapp'))).toBe(
      false,
    );
  });
});

/**
 * [FIX-20260827-CGATECHANNEL] จุดเรียกทั้งสองต้องใช้เกตตัวใหม่จริง
 * ============================================================================
 * ระดับซอร์สแบบเดียวกับ call-site test ตัวอื่นในโปรเจกต์ — สิ่งที่พังได้คือ
 * "จุดใดจุดหนึ่งลืมเปลี่ยน" ซึ่ง mount ทั้ง service เพื่อพิสูจน์ไม่คุ้ม
 * (และ chat-media ล้มด้วย `return reject(...)` ไม่ใช่ throw ⇒ ต้องคงสไตล์เดิมของแต่ละที่)
 */
describe('[FIX-20260827-CGATECHANNEL] call sites ใช้เกตของเส้นส่งจริง', () => {
  const read = (rel: string): string =>
    readFileSync(join(process.cwd(), rel), 'utf8');

  const CHAT = read('src/modules/chat/chat.service.ts');
  const MEDIA = read('src/modules/chat/chat-media.service.ts');

  it('⭐ ทั้ง chat.service และ chat-media ใช้ sendsThroughLineCore', () => {
    /* mutation: จุดใดจุดหนึ่งกลับไปใช้ `getSendAdapter` แล้วเช็ค null ⇒ แดง */
    expect(CHAT).toMatch(/if \(!servedByLineCore\(adapter\)\)/);
    expect(MEDIA).toMatch(/if \(!servedByLineCore\(adapter\)\)/);
  });

  it('adapter ที่ resolve มา ถูกใช้จริง ไม่ได้ทิ้งไว้เฉย ๆ', () => {
    /* ปมเดิมคือ resolve แล้วไม่ใช้ — คนอ่านเข้าใจผิดว่า adapter ยังส่งอยู่
       ตอนนี้มันเป็น "ค่าที่ predicate อ่าน" ⇒ ต้องยังมีการ resolve และต้องถูกส่งต่อ */
    expect(CHAT).toMatch(/^\s*const adapter = this\.channels\.getSendAdapter/m);
    expect(MEDIA).toMatch(
      /^\s*const adapter = this\.channels\.getSendAdapter/m,
    );
    expect(CHAT).toMatch(/servedByLineCore\(adapter\)/);
    expect(MEDIA).toMatch(/servedByLineCore\(adapter\)/);
  });

  it('สไตล์การล้มของแต่ละจุดไม่ถูกเปลี่ยน (throw vs return reject)', () => {
    /* 🔴 รวบสองที่ให้เหมือนกันคือการเปลี่ยน logic — chat-media คืนค่า ไม่ throw
       ผู้เรียกของมันอ่าน object ที่คืนมา ไม่ได้ดัก exception */
    expect(CHAT).toMatch(
      /servedByLineCore\(adapter\)\) \{\s*\n\s*throw new BadRequestException/,
    );
    expect(MEDIA).toMatch(
      /servedByLineCore\(adapter\)\) \{\s*\n\s*return reject\(/,
    );
  });
});
