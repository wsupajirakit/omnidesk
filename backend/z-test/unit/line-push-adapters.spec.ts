import { BadRequestException } from '@nestjs/common';

import {
  buildAlreadyRegisteredTextMessage,
  buildBroadcastMessage,
  buildChatMessages,
  buildImageCarouselMessages,
  buildLinkedNoticeMessage,
  buildPaymentMessage,
  buildRawMessage,
  buildRegisterFlexMessage,
  buildReplyFlexMessage,
  buildReplyTextMessage,
} from '@/infra/line';

/**
 * ==== [FEAT-20260820-LINEPUSHADAPTERS] per-candidate payload builders ====
 *
 * PARITY suite, Phase 2 of the central push layer. Each expectation below is
 * TRANSCRIBED from the live call site it must one day replace, with the source
 * file:line named — the same discipline line-api.spec.ts uses against legacy.
 * The adapters are pure functions and are NOT called by any runtime code yet.
 *
 * Sources of truth (dev @ cca24ee, re-read 2026-08-20):
 *   chat      → src/modules/chat/channels/line-send-adapter.ts:103-163
 *   raw       → src/modules/external/hook-outbound.service.ts:266-350
 *   broadcast → src/modules/content/broadcasts.service.ts:77-96
 *   reply     → src/modules/webhook/line-api.service.ts:113-126, 162-169
 *   carousel  → src/modules/webhook/webhook.service.ts:4140-4199
 *   payment   → line-api.service.ts:158, 283 (altText default shared)
 *   register  → src/modules/webhook/hook-reply/customer-register.handler.ts:53-87, 224, 291
 *   cust-link → src/modules/customer-link/customer-link.service.ts:179-183
 *
 * No network stubs needed: pure functions, no I/O. ไม่มีการยิงออกแม้แต่ครั้งเดียว.
 */

describe('build-payload.chat — admin console outbound (line-send-adapter parity)', () => {
  it('text → one text message (line-send-adapter.ts:104-105)', () => {
    expect(buildChatMessages({ kind: 'text', text: 'hello' })).toEqual([
      { type: 'text', text: 'hello' },
    ]);
  });

  it('image without caption → one image, originalContentUrl = previewImageUrl (:107-116)', () => {
    expect(
      buildChatMessages({ kind: 'image', imageUrl: 'https://x/a.jpg' }),
    ).toEqual([
      {
        type: 'image',
        originalContentUrl: 'https://x/a.jpg',
        previewImageUrl: 'https://x/a.jpg',
      },
    ]);
  });

  it('image with caption → caption rides AS ITS OWN text message, AFTER the image (:117)', () => {
    expect(
      buildChatMessages({
        kind: 'image',
        imageUrl: 'https://x/a.jpg',
        text: 'cap',
      }),
    ).toEqual([
      {
        type: 'image',
        originalContentUrl: 'https://x/a.jpg',
        previewImageUrl: 'https://x/a.jpg',
      },
      { type: 'text', text: 'cap' },
    ]);
  });

  it('images + caption → images then trailing text (:136-144)', () => {
    const out = buildChatMessages({
      kind: 'images',
      imageUrls: ['https://x/1.jpg', 'https://x/2.jpg'],
      text: 'cap',
    });
    expect(out.map((m) => m['type'])).toEqual(['image', 'image', 'text']);
    expect(out[2]).toEqual({ type: 'text', text: 'cap' });
  });

  it('images with textFirst → caption LEADS (overflow-batch order, :142-144)', () => {
    const out = buildChatMessages({
      kind: 'images',
      imageUrls: ['https://x/1.jpg'],
      text: 'cap',
      textFirst: true,
    });
    expect(out.map((m) => m['type'])).toEqual(['text', 'image']);
  });

  it('empty images batch fails loudly BEFORE any send (:126-130)', () => {
    expect(() => buildChatMessages({ kind: 'images', imageUrls: [] })).toThrow(
      /at least 1 image/,
    );
  });

  it('5 images + caption = 6 objects → throws (LINE 5-per-push limit, :131-134)', () => {
    expect(() =>
      buildChatMessages({
        kind: 'images',
        imageUrls: Array.from({ length: 5 }, (_, i) => `https://x/${i}.jpg`),
        text: 'cap',
      }),
    ).toThrow(/5-per-push/);
  });

  it('sticker → one sticker message (:147-154)', () => {
    expect(
      buildChatMessages({
        kind: 'sticker',
        packageId: '446',
        stickerId: '1988',
      }),
    ).toEqual([{ type: 'sticker', packageId: '446', stickerId: '1988' }]);
  });

  it('unknown kind → throws (exhaustiveness guard, :156-162)', () => {
    expect(() => buildChatMessages({ kind: 'video' } as never)).toThrow(
      /unsupported/i,
    );
  });

  /* [FEAT-20260821-QUOTEREPLY] quoteToken rides on the message object. LINE's
     OpenAPI puts it on TextMessage and StickerMessage ONLY — never on Image —
     and absence must leave the wire shape byte-identical to the pins above. */
  describe('quoteToken (LINE quote reply)', () => {
    it('text + quoteToken → the token sits on the text object', () => {
      expect(
        buildChatMessages({ kind: 'text', text: 'hi', quoteToken: 'qt-1' }),
      ).toEqual([{ type: 'text', text: 'hi', quoteToken: 'qt-1' }]);
    });

    it('sticker + quoteToken → the token sits on the sticker object', () => {
      expect(
        buildChatMessages({
          kind: 'sticker',
          packageId: '446',
          stickerId: '1988',
          quoteToken: 'qt-2',
        }),
      ).toEqual([
        {
          type: 'sticker',
          packageId: '446',
          stickerId: '1988',
          quoteToken: 'qt-2',
        },
      ]);
    });

    it('no quoteToken → NO quoteToken key at all (not undefined, absent)', () => {
      const text = buildChatMessages({ kind: 'text', text: 'hi' })[0] as object;
      const sticker = buildChatMessages({
        kind: 'sticker',
        packageId: '1',
        stickerId: '2',
      })[0] as object;
      expect(Object.keys(text)).toEqual(['type', 'text']);
      expect(Object.keys(sticker)).toEqual(['type', 'packageId', 'stickerId']);
    });

    it('image kinds cannot carry a quoteToken — the type forbids it', () => {
      // Compile-time guard; at runtime a smuggled field must not leak onto the wire.
      const out = buildChatMessages({
        kind: 'image',
        imageUrl: 'https://x/a.jpg',
        quoteToken: 'qt-3',
      } as never);
      expect(JSON.stringify(out)).not.toContain('qt-3');
    });
  });
});

describe('build-payload.raw — dashboard raw push (buildPayloadMessage parity, EXACT error strings)', () => {
  it.each([
    [{ type: 'sticker' }, 'Invalid message type'],
    [{}, 'Invalid message type'],
    [{ type: 'text' }, 'message.text is required'],
    [{ type: 'image' }, 'message.image_url is required'],
    [
      { type: 'image', image_url: 'http://x/a.jpg' },
      'message.image_url must start with https://',
    ],
    [
      { type: 'video', video_url: 'https://x/v.mp4' },
      'message.video_url and message.preview_image_url are required',
    ],
    [
      {
        type: 'video',
        video_url: 'http://x/v.mp4',
        preview_image_url: 'https://x/p.jpg',
      },
      'video_url and preview_image_url must start with https://',
    ],
    [
      { type: 'audio', audio_url: 'https://x/a.m4a' },
      'message.audio_url and message.duration are required',
    ],
    [
      { type: 'audio', audio_url: 'http://x/a.m4a', duration: 100 },
      'message.audio_url must start with https://',
    ],
    [{ type: 'flex' }, 'message.flex_json is required'],
    [
      { type: 'flex', flex_json: '{oops' },
      'message.flex_json must be valid JSON',
    ],
  ])(
    'rejects %j with the LEGACY string — the composer shows it verbatim (hook-outbound.service.ts:266-350)',
    (message, expected) => {
      expect(() => buildRawMessage(message as never)).toThrow(
        new BadRequestException(expected).message,
      );
      try {
        buildRawMessage(message);
      } catch (err) {
        // 400 semantics are part of the contract — the route replies 400.
        expect(err).toBeInstanceOf(BadRequestException);
      }
    },
  );

  it('text passes through (:275-279)', () => {
    expect(buildRawMessage({ type: 'text', text: 'hi' })).toEqual({
      type: 'text',
      text: 'hi',
    });
  });

  it('image maps to originalContentUrl/previewImageUrl (:281-290)', () => {
    expect(
      buildRawMessage({ type: 'image', image_url: ' https://x/a.jpg ' }),
    ).toEqual({
      type: 'image',
      originalContentUrl: 'https://x/a.jpg',
      previewImageUrl: 'https://x/a.jpg',
    });
  });

  it('video carries its own preview (:292-312)', () => {
    expect(
      buildRawMessage({
        type: 'video',
        video_url: 'https://x/v.mp4',
        preview_image_url: 'https://x/p.jpg',
      }),
    ).toEqual({
      type: 'video',
      originalContentUrl: 'https://x/v.mp4',
      previewImageUrl: 'https://x/p.jpg',
    });
  });

  it('audio carries duration (:314-328)', () => {
    expect(
      buildRawMessage({
        type: 'audio',
        audio_url: 'https://x/a.m4a',
        duration: 3200,
      }),
    ).toEqual({
      type: 'audio',
      originalContentUrl: 'https://x/a.m4a',
      duration: 3200,
    });
  });

  it('flex: string flex_json is parsed, object passes through, alt_text defaults to "Message" (:330-349)', () => {
    expect(
      buildRawMessage({ type: 'flex', flex_json: '{"type":"bubble"}' }),
    ).toEqual({
      type: 'flex',
      altText: 'Message',
      contents: { type: 'bubble' },
    });
    expect(
      buildRawMessage({
        type: 'flex',
        flex_json: { type: 'bubble' },
        alt_text: 'สวัสดี',
      }),
    ).toEqual({
      type: 'flex',
      altText: 'สวัสดี',
      contents: { type: 'bubble' },
    });
  });
});

describe('build-payload.broadcast — buildLineMessage parity (broadcasts.service.ts:77-96)', () => {
  it('text (:81-83)', () => {
    expect(buildBroadcastMessage({ type: 'text', text: 'promo' })).toEqual({
      type: 'text',
      text: 'promo',
    });
  });

  it('image (:84-90)', () => {
    expect(
      buildBroadcastMessage({ type: 'image', image_url: 'https://x/b.jpg' }),
    ).toEqual({
      type: 'image',
      originalContentUrl: 'https://x/b.jpg',
      previewImageUrl: 'https://x/b.jpg',
    });
  });

  it('flex AND any unknown type → flex with the hardcoded altText (:91-95)', () => {
    expect(
      buildBroadcastMessage({ type: 'flex', flex_json: { type: 'bubble' } }),
    ).toEqual({
      type: 'flex',
      altText: 'Broadcast message',
      contents: { type: 'bubble' },
    });
    // parity quirk kept as-is: undefined message falls into the flex branch
    expect(buildBroadcastMessage(undefined)).toEqual({
      type: 'flex',
      altText: 'Broadcast message',
      contents: undefined,
    });
  });
});

describe('build-payload.webhook-reply — reply text/flex + image carousel', () => {
  it('text: quickReply attaches INSIDE the message only when present (line-api.service.ts:113-119)', () => {
    expect(buildReplyTextMessage('hi')).toEqual({ type: 'text', text: 'hi' });
    expect(buildReplyTextMessage('hi', { items: [] })).toEqual({
      type: 'text',
      text: 'hi',
      quickReply: { items: [] },
    });
  });

  it('flex: altText defaults to the legacy "Bank Transfer Details" (:158) and quickReply attaches (:162-169)', () => {
    expect(buildReplyFlexMessage({ type: 'bubble' })).toEqual({
      type: 'flex',
      altText: 'Bank Transfer Details',
      contents: { type: 'bubble' },
    });
    expect(
      buildReplyFlexMessage({ type: 'bubble' }, 'สลิป', { items: [] }),
    ).toEqual({
      type: 'flex',
      altText: 'สลิป',
      contents: { type: 'bubble' },
      quickReply: { items: [] },
    });
  });

  it('carousel, media mode: one image message per item, http rewritten to https (webhook.service.ts:4143-4155)', () => {
    expect(
      buildImageCarouselMessages(
        [{ image_url: 'http://x/1.jpg' }, { image_url: 'https://x/2.jpg' }],
        { mode: 'media' },
      ),
    ).toEqual([
      {
        type: 'image',
        originalContentUrl: 'https://x/1.jpg',
        previewImageUrl: 'https://x/1.jpg',
      },
      {
        type: 'image',
        originalContentUrl: 'https://x/2.jpg',
        previewImageUrl: 'https://x/2.jpg',
      },
    ]);
  });

  it('carousel, flex mode: exact bubble shape + fallback chain + altText fallback (:4156-4199)', () => {
    const out = buildImageCarouselMessages(
      [
        {
          image_url: 'http://x/1.jpg',
          detail_link: 'https://x/promo',
          detail_text: 'โปรพิเศษ',
        },
        { image_url: 'https://x/2.jpg' },
      ],
      { mode: 'flex', fallbackDetail: 'ดูโปรโมชั่น' },
    );
    expect(out).toEqual([
      {
        type: 'flex',
        altText: 'ดูโปรโมชั่น',
        contents: {
          type: 'carousel',
          contents: [
            {
              type: 'bubble',
              hero: {
                type: 'image',
                url: 'https://x/1.jpg',
                size: 'full',
                aspectRatio: '2:3',
                aspectMode: 'fit',
                action: { type: 'uri', uri: 'https://x/promo' },
              },
              body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: 'โปรพิเศษ',
                    weight: 'bold',
                    size: 'xs',
                    wrap: true,
                  },
                ],
              },
            },
            {
              type: 'bubble',
              hero: {
                type: 'image',
                url: 'https://x/2.jpg',
                size: 'full',
                aspectRatio: '2:3',
                aspectMode: 'fit',
              },
              body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: 'ดูโปรโมชั่น',
                    weight: 'bold',
                    size: 'xs',
                    wrap: true,
                  },
                ],
              },
            },
          ],
        },
      },
    ]);
  });

  it('carousel media mode caps at FIVE images — the live slice(0,5) (webhook.service.ts:4139-4141)', () => {
    // the live query fetches up to 10 rows (:4126-4132); media mode must trim.
    const items = Array.from({ length: 7 }, (_, i) => ({
      image_url: `https://x/${i}.jpg`,
    }));
    const out = buildImageCarouselMessages(items, { mode: 'media' });
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({ originalContentUrl: 'https://x/0.jpg' });
  });

  it('carousel flex mode does NOT cap bubbles — live maps every fetched row into ONE message (:4153)', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      image_url: `https://x/${i}.jpg`,
    }));
    const out = buildImageCarouselMessages(items, { mode: 'flex' });
    expect(out).toHaveLength(1);
    const flex = out[0] as { contents: { contents: unknown[] } };
    expect(flex.contents.contents).toHaveLength(7);
  });

  it('carousel altText/body text final fallbacks: "ดูรายการรูปภาพ" / "ดูรายละเอียด" (:4181-4196)', () => {
    const out = buildImageCarouselMessages([{ image_url: 'https://x/1.jpg' }], {
      mode: 'flex',
    });
    const flex = out[0] as {
      altText: string;
      contents: {
        contents: Array<{ body: { contents: Array<{ text: string }> } }>;
      };
    };
    expect(flex.altText).toBe('ดูรายการรูปภาพ');
    expect(flex.contents.contents[0]?.body.contents[0]?.text).toBe(
      'ดูรายละเอียด',
    );
  });
});

describe('build-payload.payment — reply and push legs share ONE message shape', () => {
  it('text leg', () => {
    expect(
      buildPaymentMessage({ kind: 'text', text: 'ยอดถึงแล้วค่ะ' }),
    ).toEqual({
      type: 'text',
      text: 'ยอดถึงแล้วค่ะ',
    });
  });

  it('flex leg keeps the shared legacy altText default (line-api.service.ts:158,283)', () => {
    expect(
      buildPaymentMessage({ kind: 'flex', flexContents: { type: 'bubble' } }),
    ).toEqual({
      type: 'flex',
      altText: 'Bank Transfer Details',
      contents: { type: 'bubble' },
    });
    expect(
      buildPaymentMessage({
        kind: 'flex',
        flexContents: { type: 'bubble' },
        altText: 'แจ้งสถานะยอดเงิน',
      }),
    ).toEqual({
      type: 'flex',
      altText: 'แจ้งสถานะยอดเงิน',
      contents: { type: 'bubble' },
    });
  });
});

describe('build-payload.register — the frozen register bubble (customer-register.handler.ts)', () => {
  it('bubble is BYTE-FROZEN except the uri; altText "ลงทะเบียนสมาชิก" (:53-87, :291)', () => {
    const url = 'https://liff.line.me/xxx?t=tok';
    expect(buildRegisterFlexMessage(url)).toEqual({
      type: 'flex',
      altText: 'ลงทะเบียนสมาชิก',
      contents: {
        type: 'bubble',
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            { type: 'separator' },
            {
              type: 'text',
              text: 'ผู้ใช้งานสามารถลงทะเบียนสมาชิก โดยการกดปุ่มสีเขียวนี้',
              margin: 'md',
              size: 'lg',
              wrap: true,
              align: 'center',
              style: 'normal',
              contents: [],
            },
            { type: 'separator' },
            {
              type: 'button',
              style: 'primary',
              height: 'sm',
              action: { type: 'uri', label: 'ลงทะเบียน', uri: url },
            },
            { type: 'box', layout: 'vertical', contents: [], margin: 'sm' },
            { type: 'separator' },
          ],
          flex: 0,
        },
      },
    });
  });

  it('already-registered copy is EXACT, spaces included (:222-224)', () => {
    expect(buildAlreadyRegisteredTextMessage('สมชาย ใจดี')).toEqual({
      type: 'text',
      text: 'คุณ สมชาย ใจดี ได้ลงทะเบียน เรียบร้อยแล้ว',
    });
  });
});

describe('build-payload.customer-link — linked-notice text push (customer-link.service.ts:179-183)', () => {
  it('wraps the caller-chosen notice text; the CHOICE stays with the caller', () => {
    expect(buildLinkedNoticeMessage('เชื่อมต่อสำเร็จแล้วค่ะ')).toEqual({
      type: 'text',
      text: 'เชื่อมต่อสำเร็จแล้วค่ะ',
    });
  });
});
