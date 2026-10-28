/**
 * ==== [FEAT-20260810-PAYSTATEFLEX] `{{paylink.*}}` mint — behaviour lock ====
 *
 * WHAT THIS PINS: the two things that can hurt a paying customer.
 *
 *   1. THE PAYLOAD IS A CONTRACT. `{{paylink.retry}}` must become EXACTLY what
 *      `buildRetryPostbackData` produces — the postback handler parses that
 *      string by position (`payment-postback.handler.ts:156-172`). A "cleaner"
 *      format here and the tap resolves to no run, so the money never lands. The
 *      expectation therefore CALLS the builder rather than hard-coding `pay:...`:
 *      the two must move together, or not at all.
 *
 *   2. NO DEAD BUTTON, EVER. With no resume context the whole button NODE is
 *      gone — not blanked, not left raw. A blanked button is silent when tapped;
 *      a raw one shows the customer `{{paylink.retry}}`. Both are pinned as
 *      absent, and the "no `{{` anywhere" assertion is the one that catches a
 *      future string-replace shortcut.
 *
 * ⚠️ These are contract assertions, not a snapshot. A failure here asks whether
 * the CODE regressed. ห้ามแก้ตัวเลขให้ตรงโค้ด.
 */
import { CONTACT_ADMIN_MESSAGE } from '@/modules/payment';
/* eslint-disable no-restricted-imports -- the payment-reply barrel does not export
 * the mint yet (the integrator adds it when wiring `sendPaymentReply`); until then
 * the test reaches the file directly, exactly as `paytool-p3-mint-flex.spec.ts:14`
 * does for STATE_NOTES. Delete these two lines once the barrel re-exports it. */
import { buildRetryPostbackData } from '@/modules/webhook/payment-reply';
import { mintPayLinks } from '@/modules/webhook/payment-reply/payment-action-mint';
/* eslint-enable no-restricted-imports */

const RESUME = { resume: { runId: 'run_abc123', nextIdx: 4 } };

/** A retry button exactly as an admin authors it on the web page. */
const retryButton = () => ({
  type: 'button',
  style: 'primary',
  action: { type: 'postback', label: 'ลองใหม่', data: '{{paylink.retry}}' },
});

const contactButton = () => ({
  type: 'button',
  style: 'secondary',
  action: {
    type: 'message',
    label: 'ติดต่อแอดมิน',
    text: '{{paylink.contact_admin}}',
  },
});

/** A realistic admin card: bubble → body text, footer → both buttons. */
const card = (footer: unknown[]) => ({
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: 'ไม่พบรายการที่ตรงกับสลิปนี้', wrap: true },
    ],
  },
  footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer },
});

/** Every string in the result, so "no raw tag survived" can be asserted globally. */
const flatten = (v: unknown): string[] => {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(flatten);
  if (v && typeof v === 'object') return Object.values(v).flatMap(flatten);
  return [];
};

const findByType = (v: unknown, type: string): Record<string, unknown>[] => {
  const hits: Record<string, unknown>[] = [];
  const visit = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o['type'] === type) hits.push(o);
    Object.values(o).forEach(visit);
  };
  visit(v);
  return hits;
};

describe('[FEAT-20260810-PAYSTATEFLEX] mintPayLinks', () => {
  describe('with resume context (state no_match_retry)', () => {
    it('mints the retry data to EXACTLY buildRetryPostbackData output', () => {
      const res = mintPayLinks(card([retryButton()]), RESUME);

      const buttons = findByType(res.contents, 'button');
      expect(buttons).toHaveLength(1);
      expect((buttons[0]!['action'] as Record<string, unknown>)['data']).toBe(
        buildRetryPostbackData('run_abc123', 4),
      );
      // Belt and braces: the format itself, so a change to the builder that
      // breaks the handler's positional parse is visible here too.
      expect((buttons[0]!['action'] as Record<string, unknown>)['data']).toBe(
        'pay:resume:run_abc123:4',
      );
      expect(res.minted).toEqual(['paylink.retry']);
      expect(res.dropped).toEqual([]);
    });

    it('keeps the rest of the button (label, style, type) untouched', () => {
      const res = mintPayLinks(card([retryButton()]), RESUME);
      const btn = findByType(res.contents, 'button')[0]!;
      expect(btn['style']).toBe('primary');
      expect(btn['action']).toMatchObject({
        type: 'postback',
        label: 'ลองใหม่',
      });
    });

    it('mints contact_admin alongside retry', () => {
      /* [FEAT-20260902-ADMINPOSTBACK] this used to assert `action.text === CONTACT_ADMIN_MESSAGE`.
         The tag is still AUTHORED in `text` on a `message` button — every stored card
         says so — but it is now minted into a POSTBACK, because a message action posts
         ordinary text and the doors could not tell a press from a customer typing the
         same words. The sentence survives as `displayText`, so the customer's phone
         still shows it. ⇒ ปุ่มเดิม แต่ส่งกลับเป็น postback */
      const res = mintPayLinks(card([retryButton(), contactButton()]), RESUME);
      const buttons = findByType(res.contents, 'button');
      expect(buttons).toHaveLength(2);
      const contact = buttons[1]!['action'] as Record<string, unknown>;
      expect(contact['type']).toBe('postback');
      expect(contact['data']).toBe('paylink:v1:contact_admin');
      expect(contact['displayText']).toBe(CONTACT_ADMIN_MESSAGE);
      // the authored field is REMOVED, or LINE would post the raw tag from it.
      expect(contact['text']).toBeUndefined();
      expect(res.minted).toEqual(['paylink.retry', 'paylink.contact_admin']);
    });

    it('handles TWO retry buttons — both get the same live payload', () => {
      const res = mintPayLinks(
        card([retryButton(), contactButton(), retryButton()]),
        RESUME,
      );
      /* [FEAT-20260902-ADMINPOSTBACK] the contact button now carries a `data` too, so
         this reads the RESUME payloads specifically rather than "every data". Both
         retries must still get the same live one — the point of the case. */
      const datas = findByType(res.contents, 'button')
        .map((b) => (b['action'] as Record<string, unknown>)['data'])
        .filter((d): d is string => typeof d === 'string')
        .filter((d) => d.startsWith('pay:resume:'));
      expect(datas).toEqual([
        buildRetryPostbackData('run_abc123', 4),
        buildRetryPostbackData('run_abc123', 4),
      ]);
      expect(res.minted.filter((m) => m === 'paylink.retry')).toHaveLength(2);
    });

    it('mints a tag nested arbitrarily deep', () => {
      const deep = {
        type: 'carousel',
        contents: [
          {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [retryButton()],
                },
              ],
            },
          },
        ],
      };
      const res = mintPayLinks(deep, RESUME);
      expect(res.minted).toEqual(['paylink.retry']);
      expect(flatten(res.contents)).toContain('pay:resume:run_abc123:4');
    });
  });

  describe('WITHOUT resume context (state review / statements exhausted)', () => {
    it('REMOVES the whole retry button node — no blank, no raw tag', () => {
      const res = mintPayLinks(card([retryButton(), contactButton()]), {});

      const buttons = findByType(res.contents, 'button');
      expect(buttons).toHaveLength(1); // only contact_admin survives

      /* [FEAT-20260902-ADMINPOSTBACK] the survivor is now a postback too, so "no
         postback anywhere" stopped being the way to say "the dead control is gone".
         The precise statement is that no RESUME payload survives — a blanked or
         half-pruned retry would leave one. ⇒ ต้องไม่เหลือ payload ของ retry เลย */
      const resumePayloads = findByType(res.contents, 'button')
        .map((b) => (b['action'] as Record<string, unknown>)['data'])
        .filter((d): d is string => typeof d === 'string')
        .filter((d) => d.startsWith('pay:resume:'));
      expect(resumePayloads).toHaveLength(0);
      expect(buttons[0]!['action']).toMatchObject({
        type: 'postback',
        data: 'paylink:v1:contact_admin',
      });
      const strings = flatten(res.contents);
      expect(strings.some((s) => s.includes('{{'))).toBe(false);
      expect(strings).not.toContain('');
      expect(res.dropped).toEqual(['paylink.retry']);
    });

    it('still mints contact_admin', () => {
      const res = mintPayLinks(card([retryButton(), contactButton()]), {});
      expect(res.minted).toEqual(['paylink.contact_admin']);
      expect(flatten(res.contents)).toContain(CONTACT_ADMIN_MESSAGE);
    });

    it('drops BOTH retry buttons when the card has two', () => {
      const res = mintPayLinks(
        card([retryButton(), contactButton(), retryButton()]),
        {},
      );
      expect(findByType(res.contents, 'button')).toHaveLength(1);
      expect(res.dropped).toEqual(['paylink.retry', 'paylink.retry']);
    });

    it('prunes the container when the retry button was its ONLY child', () => {
      const res = mintPayLinks(card([retryButton()]), {});
      const out = res.contents as Record<string, unknown>;

      // An empty `contents: []` is an API error in LINE flex, so the footer box
      // must be gone entirely — the bubble stays valid (body only), which is the
      // same shape buildMintFlex renders when no button survives.
      expect(out['footer']).toBeUndefined();
      expect(out['type']).toBe('bubble');
      expect(out['body']).toBeDefined();
      expect(res.dropped).toEqual(['paylink.retry', 'empty:box']);
    });

    it('prunes NESTED empty containers recursively', () => {
      const nested = {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'ตรวจสอบไม่ได้' },
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [retryButton()],
                },
              ],
            },
          ],
        },
      };
      const res = mintPayLinks(nested, {});
      const body = (res.contents as Record<string, unknown>)['body'] as Record<
        string,
        unknown
      >;
      // Both wrapper boxes collapsed; only the text row is left.
      expect(body['contents']).toEqual([
        { type: 'text', text: 'ตรวจสอบไม่ได้' },
      ]);
      expect(res.dropped).toEqual(['paylink.retry', 'empty:box', 'empty:box']);
    });

    it('returns the ORIGINAL card when pruning would leave nothing at all', () => {
      // A card that IS only a dead button. Sending nothing is not an option, so
      // the caller gets the input back plus a note and can decide.
      const only = retryButton();
      const res = mintPayLinks(only, {});
      expect(res.contents).toBe(only);
      expect(res.dropped).toContain('card:unrenderable');
    });
  });

  describe('safety', () => {
    it('never mutates the input', () => {
      const input = card([retryButton(), contactButton()]);
      const before = JSON.stringify(input);

      mintPayLinks(input, RESUME);
      mintPayLinks(input, {});

      expect(JSON.stringify(input)).toBe(before);
    });

    it('returns a NEW structure, not the same object references', () => {
      const input = card([contactButton()]);
      const res = mintPayLinks(input, RESUME);
      expect(res.contents).not.toBe(input);
      expect(res.contents).toMatchObject({ type: 'bubble' });
    });

    it('leaves an UNKNOWN paylink tag unminted and reports it', () => {
      const weird = card([
        {
          type: 'button',
          action: { type: 'postback', label: '?', data: '{{paylink.xxx}}' },
        },
      ]);
      const res = mintPayLinks(weird, RESUME);
      // Never silently minted: it is not in the allowlist, so it cannot become a
      // real payload. Reported so an operator learns the card asks for something
      // this version cannot do.
      expect(res.minted).toEqual([]);
      expect(res.dropped).toContain('paylink.xxx');
      expect(flatten(res.contents)).not.toContain('{{paylink.xxx}}');
    });

    it('leaves NON-paylink tags for the slip substitution to handle', () => {
      // The two substitutions are independent and run in sequence — this one must
      // not touch `{{amount}}`, or the slip util would find nothing left to fill.
      const res = mintPayLinks(
        card([{ type: 'text', text: 'ยอด {{amount}} บาท' }, contactButton()]),
        RESUME,
      );
      expect(flatten(res.contents)).toContain('ยอด {{amount}} บาท');
    });

    it('ignores a paylink tag written into the WRONG action field', () => {
      // `retry` belongs in `data`; in `text` it can never work as a postback, so
      // it is dropped rather than "helpfully" minted into a broken button.
      const res = mintPayLinks(
        card([
          {
            type: 'button',
            action: {
              type: 'message',
              label: 'x',
              text: '{{paylink.retry}}',
            },
          },
        ]),
        RESUME,
      );
      expect(res.minted).toEqual([]);
      expect(res.dropped).toContain('paylink.retry');
    });

    it('tolerates whitespace and casing in the tag', () => {
      const res = mintPayLinks(
        card([
          {
            type: 'button',
            action: {
              type: 'postback',
              label: 'r',
              data: '{{ PayLink.Retry }}',
            },
          },
        ]),
        RESUME,
      );
      expect(res.minted).toEqual(['paylink.retry']);
      expect(flatten(res.contents)).toContain('pay:resume:run_abc123:4');
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'not a card'],
      ['a number', 42],
      ['an empty object', {}],
      ['an empty array', []],
    ])('does not throw on %s', (_label, input) => {
      expect(() => mintPayLinks(input, RESUME)).not.toThrow();
      expect(() => mintPayLinks(input, {})).not.toThrow();
    });

    it('does not throw or hang on a CYCLIC card', () => {
      const cyclic: Record<string, unknown> = {
        type: 'box',
        layout: 'vertical',
        contents: [retryButton()],
      };
      (cyclic['contents'] as unknown[]).push(cyclic); // self-reference

      let res!: ReturnType<typeof mintPayLinks>;
      expect(() => {
        res = mintPayLinks(cyclic, RESUME);
      }).not.toThrow();
      expect(res.dropped).toContain('card:cycle');
    });

    it('leaves a card with no paylink tag at all completely alone', () => {
      const plain = card([{ type: 'text', text: 'ติดต่อแอดมิน' }]);
      const res = mintPayLinks(plain, {});
      expect(res.contents).toEqual(plain);
      expect(res.minted).toEqual([]);
      expect(res.dropped).toEqual([]);
    });
  });
});

describe('[FIX-20260810-KEEPSPACER] an empty box with a size is a spacer', () => {
  it('keeps an empty box that carries height/width/flex', () => {
    /* LINE rejects `contents: []`, which is why empty containers are pruned — but an
     * empty box GIVEN A SIZE is the standard spacer idiom and renders fine. Pruning
     * those silently tightened the layout of every admin-authored card, a visual
     * change that has no business happening while we mint a button.
     * Found on the real templates in `todo/flex/`, whose 20px spacer disappeared. */
    const card = {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'hi' },
          { type: 'box', layout: 'vertical', contents: [], height: '20px' },
          { type: 'box', layout: 'vertical', contents: [], flex: 1 },
        ],
      },
    };
    const out = mintPayLinks(card, {});
    const s = JSON.stringify(out.contents);
    expect(s).toContain('"20px"');
    expect(s).toContain('"flex":1');
    expect(out.dropped).not.toContain('empty:box');
  });

  it('still drops a truly empty box — that IS the invalid shape', () => {
    const card = {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'hi' },
          { type: 'box', layout: 'vertical', contents: [] },
        ],
      },
    };
    const out = mintPayLinks(card, {});
    expect((out.contents as any).body.contents).toHaveLength(1);
    expect(out.dropped).toContain('empty:box');
  });
});
