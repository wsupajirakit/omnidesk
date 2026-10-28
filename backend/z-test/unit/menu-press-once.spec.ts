/**
 * [FEAT-20260902-MENUPRESSONCE] one press per button per RENDERED card.
 *
 * ── WHAT THE OWNER ASKED FOR (02/09) ────────────────────────────────────────
 * A card of `flex_type: "menu"` is sent. Each button on THAT SENT CARD is worth
 * a fixed number of presses (3 today). Press it again past that and nothing
 * happens — silently. Send the card again and the new one carries a fresh
 * budget; the old one stays spent. `uri` and `message` buttons are out of scope
 * and cannot be covered by any server-side design — accepted, not worked around.
 *
 * ── WHY THE PAYLOAD HAD TO GROW A STAMP ─────────────────────────────────────
 * Every menu payload is a pure function of its DESTINATION, so two presses on
 * two different cards are byte-identical events. A LINE postback carries no
 * reference to the message its button sits on, and LINE has no API to edit or
 * disable a card once sent. The render identity therefore cannot be discovered
 * at press time — it has to be minted before the send and carried in `data`.
 *
 * ── WHAT THIS SUITE IS FOR ──────────────────────────────────────────────────
 * The 431 cases already covering the menu prove nothing about this feature;
 * they prove it did not BREAK anything. These are the cases that fail without
 * it. Each one names the mistake it is standing guard over.
 */
/* The codec is imported from the FILE, not the barrel: the barrel is
   deliberately narrow (an export nobody calls is an unproven export), and these
   are internals the seat never touches. */
import {
  MENU_RENDER_SEPARATOR,
  parseMenuOpenFlexPostback,
  parseMenuOpenPostback,
  parseMenuPostback,
  stampMenuPostback,
} from '../../src/modules/menu/menu-postback.util';
import {
  mintRenderId,
  pressItemOf,
  pressRenderOf,
} from '../../src/modules/menu';
import { stampCardButtons } from '../../src/modules/menu/renderers/press-stamp';
import { MenuPressService } from '../../src/modules/menu-press/menu-press.service';
import {
  DEFAULT_MENU_PRESS_POLICY,
  pressClaimId,
  type MenuPressPolicy,
} from '../../src/modules/menu-press/menu-press.policy';
import type { MenuPressStore } from '../../src/modules/menu-press/stores/menu-press.store.port';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FLEX = 'menu:v1:open:flex:menu_main_00010';
const SLUG = 'menu:v1:open:sub-register';
const SCEN = 'menu:v1:primary-a:item-1';
const RENDER = 'a1b2c3d4';

/** A store that counts in memory, so the RULES are what is under test. */
class FakeStore implements MenuPressStore {
  public readonly counts = new Map<string, number>();
  public released: string[] = [];
  public constructor(private readonly broken = false) {}
  public reserve(id: string): Promise<number | null> {
    if (this.broken) return Promise.resolve(null);
    const next = (this.counts.get(id) ?? 0) + 1;
    this.counts.set(id, next);
    return Promise.resolve(next);
  }
  public release(id: string): Promise<void> {
    this.released.push(id);
    this.counts.set(id, Math.max(0, (this.counts.get(id) ?? 0) - 1));
    return Promise.resolve();
  }
}

const svc = (store: MenuPressStore, policy?: Partial<MenuPressPolicy>) =>
  new MenuPressService(store, { ...DEFAULT_MENU_PRESS_POLICY, ...policy });

const press = (n: number) => ({
  render: RENDER,
  item: 'menu_main_00010',
  lineUserId: 'Uabc',
  hookId: `hook${n === 0 ? '' : ''}`,
});

describe('[MENUPRESSONCE] the codec — a stamp must not change what anything means', () => {
  it('⭐⭐⭐ an UNSTAMPED payload parses exactly as before — every card already on a phone', () => {
    /* LINE cannot delete or edit a sent card, so every menu ever sent is still
       tappable. If the stamp had changed how a bare payload parses, this feature
       would have broken buttons that worked yesterday. */
    expect(parseMenuOpenFlexPostback(FLEX)).toEqual({ tag: 'menu_main_00010' });
    expect(parseMenuOpenPostback(SLUG)).toEqual({ slug: 'sub-register' });
    expect(parseMenuPostback(SCEN)).toEqual({
      scenarioKey: 'primary-a',
      itemId: 'item-1',
    });
  });

  it('⭐⭐ a stamped payload parses to the SAME destination, plus the render', () => {
    expect(parseMenuOpenFlexPostback(stampMenuPostback(FLEX, RENDER))).toEqual({
      tag: 'menu_main_00010',
      render: RENDER,
    });
    expect(parseMenuOpenPostback(stampMenuPostback(SLUG, RENDER))).toEqual({
      slug: 'sub-register',
      render: RENDER,
    });
    expect(parseMenuPostback(stampMenuPostback(SCEN, RENDER))).toEqual({
      scenarioKey: 'primary-a',
      itemId: 'item-1',
      render: RENDER,
    });
  });

  it('🔴 the separator is @ — because - and _ are CLAIMED and would re-point the button', () => {
    /* This is the near miss the design was measured against. `-` and `_` are
       inside ITEM_ID_CHARSET, so `menu:v1:open:sub-register-a1b2c3d4` parses as
       the SLUG "sub-register-a1b2c3d4" — a card that does not exist — and the
       button would silently open nothing. Anyone tempted to "tidy" the
       separator has to make this case go red first. */
    expect(MENU_RENDER_SEPARATOR).toBe('@');
    expect(parseMenuOpenPostback(`${SLUG}-${RENDER}`)).toEqual({
      slug: `sub-register-${RENDER}`,
    });
    expect(parseMenuOpenPostback(`${SLUG}_${RENDER}`)).toEqual({
      slug: `sub-register_${RENDER}`,
    });
  });

  it('🔴 a MALFORMED stamp is not peeled — it must read as NOT OURS, not as unstamped', () => {
    /* Otherwise editing one character of the render id would be a way to opt out
       of the press budget entirely. */
    expect(parseMenuOpenFlexPostback(`${FLEX}@zzz`)).toBeNull();
    expect(parseMenuOpenPostback(`${SLUG}@TOOLONG99`)).toBeNull();
  });

  it('the render id is 8 hex characters — the alphabet is not decoration', () => {
    /* An unclaimed postback payload becomes chat text and reaches the notice
       word screens, where latin words match on \\b boundaries. Hex cannot spell
       the words those screens look for. */
    for (let i = 0; i < 50; i += 1) {
      expect(mintRenderId()).toMatch(/^[0-9a-f]{8}$/);
    }
    expect(new Set(Array.from({ length: 200 }, mintRenderId)).size).toBe(200);
  });
});

describe('[MENUPRESSONCE] stamping a card — it touches ours and nothing else', () => {
  const bubble = () => ({
    type: 'bubble',
    body: {
      contents: [
        { type: 'button', action: { type: 'postback', data: FLEX } },
        { type: 'button', action: { type: 'postback', data: SLUG } },
        {
          type: 'button',
          action: { type: 'uri', uri: 'https://example.test' },
        },
        { type: 'button', action: { type: 'message', text: 'ติดต่อแอดมิน' } },
        {
          type: 'button',
          action: { type: 'postback', data: 'paylink:v1:contact_admin' },
        },
        { type: 'button', action: { type: 'postback', data: 'pay:resume:1' } },
      ],
    },
  });

  const actions = (doc: Record<string, unknown>) =>
    (
      (doc['body'] as Record<string, unknown>)['contents'] as {
        action: Record<string, unknown>;
      }[]
    ).map((c) => c.action);

  it('⭐⭐⭐ only OUR postbacks are stamped — uri, message, paylink and pay: are untouched', () => {
    /* The boundary is inherited from mintButtons rather than invented, so the
       two passes cannot disagree about what an operator's own button is. */
    const out = actions(stampCardButtons(bubble(), RENDER));
    expect(out[0]!['data']).toBe(`${FLEX}@${RENDER}`);
    expect(out[1]!['data']).toBe(`${SLUG}@${RENDER}`);
    expect(out[2]).toEqual({ type: 'uri', uri: 'https://example.test' });
    expect(out[3]).toEqual({ type: 'message', text: 'ติดต่อแอดมิน' });
    expect(out[4]!['data']).toBe('paylink:v1:contact_admin');
    expect(out[5]!['data']).toBe('pay:resume:1');
  });

  it('⭐⭐ re-rendering REPLACES the stamp — a second send is a fresh budget', () => {
    /* Appending instead of replacing would produce `…@aaa@bbb`, which parses as
       one stamp over a body ending in `@aaa` — i.e. NOT OURS — and the button
       would go dead on the second render. */
    const once = stampCardButtons(bubble(), 'aaaaaaaa');
    const twice = stampCardButtons(once, 'bbbbbbbb');
    expect(actions(twice)[0]!['data']).toBe(`${FLEX}@bbbbbbbb`);
    expect(parseMenuOpenFlexPostback(actions(twice)[0]!['data'])).toEqual({
      tag: 'menu_main_00010',
      render: 'bbbbbbbb',
    });
  });

  it('the source document is never mutated — the next customer must not inherit a render id', () => {
    const doc = bubble();
    stampCardButtons(doc, RENDER);
    expect(actions(doc as unknown as Record<string, unknown>)[0]!['data']).toBe(
      FLEX,
    );
  });

  it('the press key reads the BUTTON out of the payload, so it cannot disagree with it', () => {
    expect(pressItemOf(`${FLEX}@${RENDER}`)).toBe('menu_main_00010');
    expect(pressItemOf(`${SLUG}@${RENDER}`)).toBe('sub-register');
    expect(pressItemOf(`${SCEN}@${RENDER}`)).toBe('primary-a:item-1');
    expect(pressItemOf('pay:resume:1')).toBeNull();
    expect(pressRenderOf(FLEX)).toBeUndefined();
    expect(pressRenderOf(`${FLEX}@${RENDER}`)).toBe(RENDER);
  });
});

describe('[MENUPRESSONCE] the rule', () => {
  it('⭐⭐⭐ presses 1..max are allowed and the next one is refused (max = 3 today)', async () => {
    const store = new FakeStore();
    const s = svc(store);
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await s.attempt(press(0)));
    expect(results.map((r) => r.allowed)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(results.map((r) => r.press)).toEqual([1, 2, 3, 4, 5]);
  });

  it('⭐⭐ raising the budget is ONE number — nothing else in the feature knows about 3', async () => {
    /* The owner moved 1 → 3 on 02/09 with no other edit. This case is what makes
       that claim measurable rather than a promise. */
    const s = svc(new FakeStore(), { max: 1 });
    expect((await s.attempt(press(0))).allowed).toBe(true);
    expect((await s.attempt(press(0))).allowed).toBe(false);
    const s5 = svc(new FakeStore(), { max: 5 });
    for (let i = 0; i < 5; i += 1)
      expect((await s5.attempt(press(0))).allowed).toBe(true);
    expect((await s5.attempt(press(0))).allowed).toBe(false);
  });

  it('⭐⭐ a DIFFERENT button on the same card keeps its own budget', async () => {
    const store = new FakeStore();
    const s = svc(store, { max: 1 });
    expect(
      (await s.attempt({ ...press(0), item: 'sub-register' })).allowed,
    ).toBe(true);
    expect(
      (await s.attempt({ ...press(0), item: 'sub-web-url' })).allowed,
    ).toBe(true);
    expect(
      (await s.attempt({ ...press(0), item: 'sub-register' })).allowed,
    ).toBe(false);
  });

  it('⭐⭐⭐ a NEW render of the same card is a fresh budget — the whole point of the stamp', async () => {
    const store = new FakeStore();
    const s = svc(store, { max: 1 });
    expect((await s.attempt({ ...press(0), render: 'aaaaaaaa' })).allowed).toBe(
      true,
    );
    expect((await s.attempt({ ...press(0), render: 'aaaaaaaa' })).allowed).toBe(
      false,
    );
    expect((await s.attempt({ ...press(0), render: 'bbbbbbbb' })).allowed).toBe(
      true,
    );
  });

  it('🔴 another PERSON is a different budget — the multicast argument', async () => {
    /* One rendered message object goes to N people. Without the person in the
       key the first to press would consume everybody's budget. */
    const store = new FakeStore();
    const s = svc(store, { max: 1 });
    expect((await s.attempt({ ...press(0), lineUserId: 'Uone' })).allowed).toBe(
      true,
    );
    expect((await s.attempt({ ...press(0), lineUserId: 'Utwo' })).allowed).toBe(
      true,
    );
    expect((await s.attempt({ ...press(0), lineUserId: 'Uone' })).allowed).toBe(
      false,
    );
  });

  it('another OA is a different budget', async () => {
    const store = new FakeStore();
    const s = svc(store, { max: 1 });
    expect((await s.attempt({ ...press(0), hookId: 'h1' })).allowed).toBe(true);
    expect((await s.attempt({ ...press(0), hookId: 'h2' })).allowed).toBe(true);
    expect((await s.attempt({ ...press(0), hookId: 'h1' })).allowed).toBe(
      false,
    );
  });

  it('⭐⭐⭐ an UNSTAMPED press is always allowed, and writes nothing', async () => {
    /* Cards sent before this shipped are still on customers' phones for ever. */
    const store = new FakeStore();
    const s = svc(store, { max: 1 });
    for (let i = 0; i < 10; i += 1) {
      const d = await s.attempt({ ...press(0), render: undefined });
      expect(d.allowed).toBe(true);
      expect(d.claimId).toBeUndefined();
    }
    expect(store.counts.size).toBe(0);
  });

  it('⭐⭐⭐ the store being unreachable FAILS OPEN — an outage costs a press, not the menu', async () => {
    const s = svc(new FakeStore(true), { max: 1 });
    for (let i = 0; i < 5; i += 1)
      expect((await s.attempt(press(0))).allowed).toBe(true);
  });

  it('the switch turns the whole feature inert — nothing is read, nothing is written', async () => {
    const store = new FakeStore();
    const s = svc(store, { enabled: false, max: 1 });
    for (let i = 0; i < 5; i += 1)
      expect((await s.attempt(press(0))).allowed).toBe(true);
    expect(store.counts.size).toBe(0);
  });
});

describe('[MENUPRESSONCE] reserve → settle: a press the customer never received must be given back', () => {
  it('⭐⭐⭐ releasing a claim restores the budget', async () => {
    /* THE BUG THIS EXISTS FOR: the first draft charged before the send and never
       gave anything back. `coreSend` throws by design when LINE refuses the
       reply token — so a failure that was OURS spent the customer's press and
       left the button dead until the TTL. */
    const store = new FakeStore();
    const s = svc(store, { max: 1 });
    const first = await s.attempt(press(0));
    expect(first.allowed).toBe(true);
    expect(first.claimId).toBeDefined();

    await s.release(first.claimId!);
    expect(store.released).toEqual([first.claimId]);

    /* the press is available again — the card never arrived, so it was not spent */
    expect((await s.attempt(press(0))).allowed).toBe(true);
  });

  it('a REFUSED press carries no receipt — there is nothing to give back', async () => {
    const s = svc(new FakeStore(), { max: 1 });
    await s.attempt(press(0));
    const refused = await s.attempt(press(0));
    expect(refused.allowed).toBe(false);
    expect(refused.claimId).toBeUndefined();
  });

  it('the claim id spells the four parts in ONE order', () => {
    /* A key assembled differently by a second caller is a budget that silently
       resets, so there is exactly one function that builds it. */
    expect(
      pressClaimId({
        render: RENDER,
        item: 'menu_main_00010',
        lineUserId: 'Uabc',
        hookId: 'hook1',
      }),
    ).toBe(`${RENDER}:menu_main_00010:Uabc:hook1`);
  });
});

describe('[MENUPRESSONCE] the seat settles the reservation', () => {
  const seat = readFileSync(
    join(__dirname, '..', '..', 'src/modules/webhook/webhook.service.ts'),
    'utf8',
  );

  it('⭐⭐⭐ a throw from the engine releases the press before it propagates', () => {
    /* Source-text, deliberately: the alternative is booting the whole webhook to
       prove one ordering. What matters is that the release exists on the throw
       path AND that the error is re-thrown rather than swallowed. */
    expect(seat).toContain(
      'if (pressClaim) await this.menuPress?.release(pressClaim);',
    );
    expect(seat).toMatch(/release\(pressClaim\);\s*\n\s*throw err;/);
  });

  it("⭐⭐ anything other than action:'sent' releases the press", () => {
    expect(seat).toContain("if (pressClaim && menuPb.action !== 'sent') {");
  });

  it('⭐⭐ the guard runs BEFORE the engine, and a refusal returns without sending', () => {
    const guardAt = seat.indexOf('this.menuPress.attempt({');
    const engineAt = seat.indexOf('menuEngine.handlePostback({');
    expect(guardAt).toBeGreaterThan(-1);
    expect(engineAt).toBeGreaterThan(guardAt);
    expect(seat).toContain('if (!decision.allowed) return;');
  });

  it('🔴 only a menu card is stamped — scoped by TYPE, not by tag', () => {
    /* Owner 02/09: every card on the FE's "เมนู (Flex Menu)" tab, so a card
       created tomorrow is covered without anybody editing a list. */
    expect(seat).toContain("const MENU_PRESS_FLEX_TYPE = 'menu';");
    expect(
      seat.match(/card\.flex_type === MENU_PRESS_FLEX_TYPE/g)?.length,
    ).toBe(2);
  });
});
