/**
 * [FEAT-20260829-MENUTAG-S3] the menu is WIRED — prove it lives beside the others.
 *
 * Owner, 29/08: "เพิ่มการทดสอบ menutag ว่าเข้ากันได้และทำงานได้กับเพื่อน ๆ ไม่มั่ว tag".
 *
 * The menu now has a real seat in the webhook, so the question is no longer
 * "does the module work" but "does having it there change anybody else". Two
 * ways it could, and both are checked here against the REAL grammar:
 *
 *   1. it steals somebody's postback — `pay:` and `hoc:` are the two other
 *      prefixes in this file, and the payment seat sits ABOVE the menu one
 *      (webhook.service.ts:1631 vs :1700), so payment keeps priority by
 *      position; the menu must additionally decline them by CONTENT.
 *   2. it steals somebody's text tag — `[[[...]]]` is shared with
 *      customer-helper, assist, history and the dynamic tags.
 *
 * A tag family that answers "not mine" is what makes the webhook fall through
 * byte-identically. Every `handled:false` below is that contract.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MenuEngineService,
  FixedFlexRenderer,
  parseMenuPostback,
  parseMenuOpenPostback,
  parseMenuTag,
  findMenuTag,
  hasMenuTag,
  buildMenuOpenPostback,
  buildMenuPostback,
  type MenuContext,
  type MenuDefinition,
} from '@/modules/menu';

const ctx = (): MenuContext => ({
  hook: { group: 'g1' },
  lineUserId: 'U1',
  member: null,
  siteRules: null,
  silence: { silenced: false, by: null },
});

const def: MenuDefinition = {
  key: 'primary',
  level: 'primary',
  variant: null,
  enabled: true,
  title: 'เมนู',
  items: [
    {
      id: 'dep',
      label: 'ฝาก',
      action: { type: 'result', result: { kind: 'text', text: 'ฝาก' } },
    },
  ],
};

const engine = () => {
  const send = jest.fn().mockResolvedValue({});
  return {
    send,
    e: new MenuEngineService({
      sources: [{ get: () => def }],
      renderer: new FixedFlexRenderer(),
      coreSend: send,
    }),
  };
};

/** Real payloads other features own, taken from the webhook source. */
const FOREIGN_POSTBACKS = [
  'pay:retry:64f0a1',
  'pay:resume:64f0a1:2',
  'hoc:accept',
  'hoc:decline:x',
  // near-misses on OUR grammar that must still be refused
  'menu:open:sub-a',
  'menu:v1',
  'menu:v1:',
  'menuv1:open:x',
  'MENU:V1:OPEN:X',
  '',
];

/** Real `[[[...]]]` markers other features own — grepped from src/ on 29/08. */
const FOREIGN_TAGS = [
  '[[[assist]]]',
  '[[[customer-helper]]]',
  '[[[history]]]',
  '[[[custom_content_1]]]',
  '[[[flex_profile]]]',
  '[[[flex_m00001]]]',
  '[[[flex_pc00001]]]',
  '[[[customer-register]]]',
  '[[[img_promo]]]',
  '[[[tag]]]',
  '[[[name]]]',
];

describe('[COEXIST] the menu never answers another feature postback', () => {
  it.each(FOREIGN_POSTBACKS)('declines %s at the engine door', async (data) => {
    const { e, send } = engine();
    const out = await e.handlePostback({
      data,
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out).toEqual({ handled: false });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(FOREIGN_POSTBACKS)(
    '%s parses as NOT-OURS in both codec forms',
    (data) => {
      expect(parseMenuPostback(data)).toBeNull();
      expect(parseMenuOpenPostback(data)).toBeNull();
    },
  );

  it('⭐ but OUR postbacks are still answered — the door is not simply shut', async () => {
    const { e, send } = engine();
    const out = await e.handlePostback({
      data: buildMenuPostback('primary', 'dep'),
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out.handled).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('⭐ and so are slug links', () => {
    expect(parseMenuOpenPostback(buildMenuOpenPostback('sub-a'))).toEqual({
      slug: 'sub-a',
    });
  });
});

describe('[COEXIST] the menu never claims another feature text tag', () => {
  it.each(FOREIGN_TAGS)('does not open a menu for %s', async (text) => {
    const { e, send } = engine();
    const out = await e.handleTap({ text, replyToken: 'rt', context: ctx() });
    expect(out).toEqual({ handled: false });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(FOREIGN_TAGS)(
    '%s is invisible to the outbound detector too',
    (text) => {
      /* The outbound side matters as much: a detector that fired on somebody
       else's marker would strip or rewrite their answer. */
      expect(findMenuTag(`ก่อน ${text} หลัง`)).toBeNull();
      expect(hasMenuTag(text)).toBe(false);
      expect(parseMenuTag(text)).toBeNull();
    },
  );

  it('⭐ a menu tag sitting NEXT to a foreign one is still found, and only ours', () => {
    expect(findMenuTag('[[[customer-helper]]] [[[menu-second-b]]]')).toEqual({
      level: 'second',
      variant: 'b',
    });
  });

  it('⭐⭐ ordinary customer prose never opens a menu', async () => {
    for (const text of [
      'สวัสดีครับ',
      'ขอดูเมนู',
      'menu',
      'เมนูหลัก',
      'ฝากเงินยังไง',
    ]) {
      const { e, send } = engine();
      const out = await e.handleTap({ text, replyToken: 'rt', context: ctx() });
      expect(out).toEqual({ handled: false });
      expect(send).not.toHaveBeenCalled();
    }
  });
});

describe('[COEXIST] the seat itself is gated (source census)', () => {
  const svc = () =>
    readFileSync(
      join(__dirname, '..', '..', 'src/modules/webhook/webhook.service.ts'),
      'utf8',
    );

  it('⭐⭐⭐ the payment seat still runs BEFORE the menu seat', () => {
    /* Position is what guarantees `pay:` keeps priority. If the menu block ever
       moved above it, a payment retry could be inspected by the menu first. */
    const s = svc();
    const pay = s.indexOf("event.type === 'postback' && this.paymentRunner");
    const menu = s.indexOf("event.type === 'postback' && this.menuCards");
    expect(pay).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(pay);
  });

  it('the menu seat only runs for postback events, and only when wired', () => {
    expect(svc()).toContain(
      "event.type === 'postback' && this.menuCards && userId",
    );
  });

  it('an unhandled menu postback falls through instead of returning', () => {
    /* `return` happens only inside `if (menuPb.handled)`, so a payload we do
       not own continues down the existing path untouched. */
    expect(svc()).toContain('if (menuPb.handled) return;');
  });
});
