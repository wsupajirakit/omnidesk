/**
 * [FEAT-20260902-ADMINPOSTBACK] The contact buttons fire on a PRESS, not on words.
 * ===========================================================================
 * THE DEFECT THIS REPLACES. `{{paylink.contact_admin}}` minted a LINE `message`
 * action, which posts ordinary text on the customer's behalf. The doors that
 * consumed it therefore compared the SENTENCE:
 *
 *     if (String(msgContent).trim() === CONTACT_ADMIN_MESSAGE) { open a case }
 *
 * so a customer TYPING "ติดต่อแอดมิน" got exactly what a button press got. Proven
 * live on 02/09 — typed at 12:45, pressed at 12:49, identical rows in the database,
 * and nothing anywhere recorded which was which. Owner: it must be the button only.
 * ⇒ กดปุ่มเท่านั้น พิมพ์เองต้องไม่ทำงาน
 *
 * WHY THE FIX IS IN THE MINTER AND NOT IN THE FIELD MAP. The obvious move is to
 * flip `PAYLINK_TAG_FIELD.contact_admin` from `'text'` to `'data'`. That silently
 * breaks every card already drawn: the minter drops a node whose tag sits in the
 * "wrong" field, so all three stored cards would ship with the button simply
 * missing, and no deploy order avoids the window. The tag stays AUTHORED in `text`
 * and the minter rewrites the action — which is why the assertions below are about
 * a STRUCTURAL change to the action, not a substituted string.
 *
 * WHAT EACH GROUP GUARDS
 *   1. the rewrite is complete — a half-rewritten action still carries `text`, and
 *      LINE reads `text` on an action that has one, so the customer would post the
 *      raw `{{paylink.…}}` tag. That is the 31/08 incident repeating.
 *   2. the codec cannot drift — builder and parser are one file; if the parser
 *      stopped recognising what the builder writes, every press would fall through
 *      to the AI and answer with a menu.
 *   3. the neighbours are untouched — `retry` keeps its own grammar and THE HARD
 *      RULE, and no menu payload is ever claimed.
 *   4. the prefix cannot collide with the notice word lists. Measured, not
 *      stylistic: `pay` is a latin entry in BOTH lists.
 */
import {
  PAYLINK_MINTS_POSTBACK,
  PAYLINK_POSTBACK_PREFIX,
  PAYLINK_TAG_FIELD,
  payLinkFromPostback,
  payLinkPostbackData,
} from '@/common/utils/paylink-tag';
import {
  CONTACT_ADMIN_MESSAGE,
  CONTACT_ADMIN_WITHDRAW_MESSAGE,
} from '@/modules/payment';
import { mintPayLinks } from '@/modules/webhook/payment-reply/payment-action-mint';

type Node = Record<string, unknown>;

/** The button shape every stored card really uses — authored as a message action. */
const contactButton = (tag: string, label = '💬 ติดต่อแอดมิน'): Node => ({
  type: 'button',
  style: 'link',
  height: 'sm',
  color: '#1D4ED8',
  action: { type: 'message', label, text: `{{paylink.${tag}}}` },
});

const card = (...buttons: Node[]): Node => ({
  type: 'bubble',
  body: { type: 'box', layout: 'vertical', contents: buttons },
});

/** The buttons of a minted one-button card. */
const buttonsOf = (contents: unknown): Node[] =>
  (((contents as Node)['body'] as Node)['contents'] ?? []) as Node[];

/** Pull the single action out of a minted one-button card. */
const actionOf = (contents: unknown): Node =>
  (buttonsOf(contents)[0]?.['action'] ?? {}) as Node;

describe('⭐⭐⭐ the rewrite — a message button becomes a real postback', () => {
  it.each([
    ['contact_admin', CONTACT_ADMIN_MESSAGE],
    ['contact_admin_via_withdraw', CONTACT_ADMIN_WITHDRAW_MESSAGE],
  ])('%s mints a postback carrying its own payload', (tag, sentence) => {
    const out = mintPayLinks(card(contactButton(tag)), {});
    const action = actionOf(out.contents);

    expect(out.minted).toContain(`paylink.${tag}`);
    expect(action['type']).toBe('postback');
    expect(action['data']).toBe(payLinkPostbackData(tag));
    // The customer's phone must still show the same sentence, or the tap looks
    // broken on screen even though the case opens.
    expect(action['displayText']).toBe(sentence);
  });

  it('🔴 the authored `text` is REMOVED, not left beside the new payload', () => {
    /* The trap this whole file exists for. LINE reads `text` on an action that
       still has one, so a leftover would post the literal tag into the chat —
       exactly the 31/08 incident. A rewrite that only ADDS keys passes every
       other assertion here and fails this one. */
    const out = mintPayLinks(card(contactButton('contact_admin')), {});
    const action = actionOf(out.contents);
    expect(action['text']).toBeUndefined();
    expect(JSON.stringify(out.contents)).not.toContain('{{paylink');
  });

  it('⭐⭐ every other key the operator drew survives untouched', () => {
    /* The rewrite must be invisible in the FE. If a redesign's colour or label
       were dropped, the operator would see their card change by itself. */
    const out = mintPayLinks(
      card(contactButton('contact_admin', '📤 คุยกับแอดมิน')),
      {},
    );
    const action = actionOf(out.contents);
    const button = buttonsOf(out.contents)[0] as Node;
    expect(action['label']).toBe('📤 คุยกับแอดมิน');
    expect(button['style']).toBe('link');
    expect(button['color']).toBe('#1D4ED8');
    expect(button['height']).toBe('sm');
  });

  it('⭐⭐ the two buttons never mint the same payload', () => {
    /* One payload for both would send every withdraw press down the plain door,
       skipping the withdraw notice screens entirely — silently. */
    expect(payLinkPostbackData('contact_admin')).not.toBe(
      payLinkPostbackData('contact_admin_via_withdraw'),
    );
  });
});

describe('🔴 typing the sentence is not pressing the button', () => {
  it.each([
    ['the plain sentence', CONTACT_ADMIN_MESSAGE],
    ['the withdraw sentence', CONTACT_ADMIN_WITHDRAW_MESSAGE],
  ])('%s is not a payload the doors accept', (_what, sentence) => {
    /* If either of these ever answered a tag name, the doors would fire on typed
       text again and 02/09 would be undone with nothing to show it. */
    expect(payLinkFromPostback(sentence)).toBeNull();
  });

  it('⭐⭐⭐ the payload is not something a customer would ever type', () => {
    // Belt and braces: the door ALSO tests `event.type === 'postback'`, but a
    // payload equal to a natural sentence would make that the only guard.
    for (const name of PAYLINK_MINTS_POSTBACK) {
      const payload = payLinkPostbackData(name);
      expect(payload).toContain(PAYLINK_POSTBACK_PREFIX);
      expect(payload).not.toBe(CONTACT_ADMIN_MESSAGE);
      expect(payload).not.toBe(CONTACT_ADMIN_WITHDRAW_MESSAGE);
    }
  });
});

describe('the codec — builder and parser cannot drift apart', () => {
  it.each([...PAYLINK_MINTS_POSTBACK])('%s survives a round trip', (name) => {
    expect(payLinkFromPostback(payLinkPostbackData(name))).toBe(name);
  });

  it.each([
    ['a menu open payload', 'menu:v1:open:main-menu'],
    ['a menu scenario payload', 'menu:v1:register:item-3'],
    ['the payment resume payload', 'pay:resume:6a79f0:3'],
    ['the un-minted tag itself', '{{paylink.contact_admin}}'],
    ['a name this version does not mint', 'paylink:v1:nope'],
    ['a bare namespace', 'paylink:v1:'],
    ['an empty string', ''],
  ])('refuses %s', (_what, payload) => {
    /* Each of these really travels through the same pipeline, so a parser that
       got greedy would steal a live payload from its owner. */
    expect(payLinkFromPostback(payload)).toBeNull();
  });

  it.each([[null], [undefined], [42], [{}], [['paylink:v1:contact_admin']]])(
    'refuses the non-string %p without throwing',
    (payload) => {
      expect(payLinkFromPostback(payload)).toBeNull();
    },
  );

  it('🔴 the prefix cannot match the notice word "pay"', () => {
    /* MEASURED, not stylistic. `pay` is a latin entry in BOTH DEPOSIT_WORDS and
       WITHDRAW_WORDS and is matched on \b boundaries; `:` is a non-word char, so
       a `pay:` prefix matches `\bpay\b`. The deposit cases are screened first, so
       a customer pressing an ADMIN button would be answered with a DEPOSIT card.
       ⇒ ห้ามขึ้นต้นด้วย pay: เด็ดขาด */
    expect(/\bpay\b/.test(PAYLINK_POSTBACK_PREFIX)).toBe(false);
    expect(PAYLINK_POSTBACK_PREFIX.startsWith('menu:')).toBe(false);
  });
});

describe('⭐ the neighbours are untouched', () => {
  const retryButton: Node = {
    type: 'button',
    action: { type: 'postback', label: 'ลองใหม่', data: '{{paylink.retry}}' },
  };

  it('retry still mints its own resume payload, in `data`', () => {
    const out = mintPayLinks(card(retryButton), {
      resume: { runId: 'r1', nextIdx: 2 },
    });
    const action = actionOf(out.contents);
    expect(action['type']).toBe('postback');
    expect(action['data']).toBe('pay:resume:r1:2');
    // It is NOT part of the paylink postback namespace — two grammars.
    expect(payLinkFromPostback(action['data'])).toBeNull();
  });

  it('🔴 THE HARD RULE survives: no resume ⇒ the retry node is removed', () => {
    const out = mintPayLinks(card(retryButton), {});
    expect(out.dropped).toContain('paylink.retry');
    expect(JSON.stringify(out.contents)).not.toContain('paylink');
  });

  it('⭐⭐ a tag in the WRONG field is still dropped, not rewritten', () => {
    /* The rewrite must not become a licence to accept anything anywhere. `retry`
       written into a message button's `text` can never carry a resume payload,
       so the node still goes. */
    const wrong = {
      type: 'button',
      action: { type: 'message', label: 'x', text: '{{paylink.retry}}' },
    };
    const out = mintPayLinks(card(wrong), {
      resume: { runId: 'r', nextIdx: 0 },
    });
    expect(out.dropped).toContain('paylink.retry');
  });

  it('⭐⭐ the authored field map still says `text` for both contact tags', () => {
    /* Flipping either row to 'data' makes the minter refuse every card already in
       the database. The comment in paylink-tag.ts says so; this makes it fail
       loudly instead of being read and ignored. */
    expect(PAYLINK_TAG_FIELD['contact_admin']).toBe('text');
    expect(PAYLINK_TAG_FIELD['contact_admin_via_withdraw']).toBe('text');
  });

  it('a card with no paylink tag comes back unchanged', () => {
    const plain = card({
      type: 'button',
      action: { type: 'uri', label: 'เว็บ', uri: 'https://example.test' },
    });
    const out = mintPayLinks(plain, {});
    expect(out.contents).toEqual(plain);
    expect(out.minted).toHaveLength(0);
    expect(out.dropped).toHaveLength(0);
  });
});
