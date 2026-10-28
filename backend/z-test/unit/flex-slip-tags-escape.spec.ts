/**
 * ==== [FIX-20260819-SLIPTAGESCAPE] a slip value may not break out of the card JSON
 *
 * WHAT IS WRONG. `substituteSlipTags` renders by SERIALISING the card, running a
 * string `.replace()` per tag, then `JSON.parse`ing the result
 * (`flex-slip-tags.util.ts:135-143`). The substituted text lands INSIDE a JSON
 * string literal, but it is spliced in raw. Six of the tags are third-party
 * strings copied straight out of the slip-verification response with no coercion:
 *
 *   sender_bank_name · sender_name · sender_acc_no
 *   receiver_bank_name · receiver_name · receiver_acc_no
 *
 * The other tags cannot carry a hostile character and are NOT the subject here:
 *   · `amount` — `Number(...)` then `toLocaleString('en-US')` ⇒ digits, comma,
 *     dot, minus, or the literal "NaN". Numerically coerced, verified.
 *   · `slip_date` / `date_on_slip` — `formatSlipDate`, built from regex-captured
 *     digits and a fixed Thai month table, else `toLocaleDateString`.
 *   · `check_datetime` / `current_datetime` — `formatThaiDateTime(slipCreatedAt)`,
 *     and `slipCreatedAt` is typed `Date | null` from OUR side, not the slip.
 *   · `sender_bank_logo` / `receiver_bank_logo` — `getBankLogoUrl` uses the slip's
 *     bank id only as a lookup KEY; the string returned is our own base URL plus
 *     an entry from the internal bank table.
 *
 * MEASURED against the unchanged code, all three vectors land:
 *   · a `"` in a bank name INJECTED A PROPERTY into the card node and threw
 *     nothing at all — `{"type":"text","text":"BANK","color":"#ff0000"}`;
 *   · a trailing `\` threw `SyntaxError: Expected ',' or '}' after property value`;
 *   · a `$'` threw `SyntaxError: Unexpected non-whitespace character after JSON`
 *     — `String.replace` reads `$'` in the REPLACEMENT as "everything after the
 *     match", so the rest of the serialised card was spliced into the string.
 *
 * The quote case is the dangerous one: no error surfaces, the card renders, and
 * the shape a customer sees is whatever the slip response asked for.
 *
 * ⚠️ THE FIRST CASE BELOW IS THE ONE THAT MATTERS. It is a byte-for-byte record of
 * what this function renders TODAY for ordinary values, captured from the
 * unchanged code before the fix was written. A card customers already read must
 * not shift by one character. If it fails, the fix is wrong — do not update the
 * string. ค่าที่เขียนไว้คือสิ่งที่ลูกค้าเห็นอยู่ตอนนี้ ห้ามแก้ตาม.
 */
import { substituteSlipTags } from '@/modules/webhook/slip-flex/flex-slip-tags.util';

/** The same realistic Swiftcheck `rawSlip` the golden spec uses. */
const V_DATA = {
  amount: { amount: 1500 },
  date: '2026-04-06T08:03:07+07:00',
  sender: {
    bank: { id: '006', name: 'ธนาคารกรุงไทย' },
    account: {
      name: { th: 'น.ส.ญาณเทพ ป', en: 'MS. YANTHEP P' },
      bank: { account: 'XXX-X-XX564-4' },
    },
  },
  receiver: {
    bank: { id: '014', name: 'ธนาคารไทยพาณิชย์' },
    account: {
      name: { th: 'บจก. บุญโฟน', en: 'ACME CO' },
      bank: { account: 'XXX-X-XX917-2' },
    },
  },
};

const mkCtx = (vData: unknown) => ({
  vData: vData as never,
  baseUrl: 'https://cdn.example.test',
  slipCreatedAt: new Date('2026-04-06T15:26:10+07:00'),
  formatThaiDateTime: () => '06/04/2569 15:26:10',
});

/** A card exercising every tag, both synonyms, a logo url and an unknown tag. */
const CARD = {
  type: 'bubble',
  hero: { type: 'image', url: '{{sender_bank_logo}}' },
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: 'ยอด {{amount}} บาท' },
      {
        type: 'text',
        text: '{{ SENDER_NAME }} · {{sender_bank_name}} · {{sender_acc_no}}',
      },
      {
        type: 'text',
        text: '{{receiver_name}} · {{receiver_bank_name}} · {{receiver_acc_no}}',
      },
      { type: 'text', text: '{{slip_date}} / {{date_on_slip}}' },
      { type: 'text', text: '{{check_datetime}} / {{current_datetime}}' },
      { type: 'image', url: '{{receiver_bank_logo}}' },
      { type: 'text', text: '{{unknown_tag}}' },
    ],
  },
};

/** Captured from the UNCHANGED implementation. This is the contract. */
const RENDERED_TODAY =
  '{"type":"bubble","hero":{"type":"image","url":"https://cdn.example.test/bank-logos/ktb.png"},' +
  '"body":{"type":"box","layout":"vertical","contents":[' +
  '{"type":"text","text":"ยอด 1,500.00 บาท"},' +
  '{"type":"text","text":"น.ส.ญาณเทพ ป · ธนาคารกรุงไทย · XXX-X-XX564-4"},' +
  '{"type":"text","text":"บจก. บุญโฟน · ธนาคารไทยพาณิชย์ · XXX-X-XX917-2"},' +
  '{"type":"text","text":"06 เมษายน 69 08:03:07 / 06 เมษายน 69 08:03:07"},' +
  '{"type":"text","text":"06/04/2569 15:26:10 / 06/04/2569 15:26:10"},' +
  '{"type":"image","url":"https://cdn.example.test/bank-logos/scb.png"},' +
  '{"type":"text","text":"{{unknown_tag}}"}]}}';

/** Same shape, one hostile field, everything else realistic. */
const hostileSender = (name: string) => ({
  ...V_DATA,
  sender: {
    ...V_DATA.sender,
    bank: { ...V_DATA.sender.bank, name },
  },
});

describe('[FIX-20260819-SLIPTAGESCAPE] ordinary cards must not move', () => {
  it('renders byte-identically to the pre-fix output', () => {
    const out = substituteSlipTags(CARD, mkCtx(V_DATA));
    expect(JSON.stringify(out)).toBe(RENDERED_TODAY);
  });

  it('still reports the unknown tag as leftover, unchanged', () => {
    const { leftover } = substituteSlipTags(CARD, mkCtx(V_DATA), {
      report: true,
    }) as { leftover: string[] };
    expect(leftover).toEqual(['{{unknown_tag}}']);
  });
});

describe('[FIX-20260819-SLIPTAGESCAPE] a hostile slip value stays a value', () => {
  const SMALL = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '{{sender_bank_name}}' },
        { type: 'text', text: 'after' },
      ],
    },
  };

  /** The rendered card must always keep its shape, whatever the slip said. */
  const expectShapeKept = (out: unknown, text: string) => {
    expect(out).toEqual({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text },
          { type: 'text', text: 'after' },
        ],
      },
    });
  };

  it('a double quote in a bank name cannot inject a property', () => {
    // Pre-fix this produced {"type":"text","text":"BANK","color":"#ff0000"} —
    // an extra property on a customer-visible node, with NO error raised.
    const out = substituteSlipTags(
      SMALL,
      mkCtx(hostileSender('BANK" , "color":"#ff0000')),
    );
    expectShapeKept(out, 'BANK" , "color":"#ff0000');
  });

  it('a trailing backslash in a bank name does not break the parse', () => {
    // Pre-fix: SyntaxError: Expected ',' or '}' after property value in JSON.
    const out = substituteSlipTags(SMALL, mkCtx(hostileSender('BANK\\')));
    expectShapeKept(out, 'BANK\\');
  });

  it("a `$'` in a bank name is not read as a replacement pattern", () => {
    // Pre-fix: SyntaxError — `String.replace` expanded `$'` to the rest of the
    // serialised card. Escaping the value alone does not fix this; the
    // replacement must not be interpreted as a pattern at all.
    const out = substituteSlipTags(SMALL, mkCtx(hostileSender("BANK$'")));
    expectShapeKept(out, "BANK$'");
  });

  it('an account name with a quote survives on the receiver side too', () => {
    const v = {
      ...V_DATA,
      receiver: {
        ...V_DATA.receiver,
        account: {
          ...V_DATA.receiver.account,
          name: { th: 'บจก. "ควิก" เพย์', en: 'QUICK PAY' },
        },
      },
    };
    const card = {
      type: 'box',
      contents: [{ type: 'text', text: '{{receiver_name}}' }],
    };
    expect(substituteSlipTags(card, mkCtx(v))).toEqual({
      type: 'box',
      contents: [{ type: 'text', text: 'บจก. "ควิก" เพย์' }],
    });
  });

  it('a `$&` in a bank name does not re-inject the placeholder it replaced', () => {
    // The quietest of the four. Pre-fix `String.replace` expanded `$&` to the
    // MATCHED TEXT, so the card handed the customer a literal
    // `{{sender_bank_name}}` instead of a bank — and no exception was raised,
    // unlike the `$'` and backslash cases. Worse, the re-injected braces then
    // showed up in `leftover`, so the one signal an operator could have acted
    // on reported a tag that had in fact been substituted. Both halves are
    // pinned here: the rendered text AND the emptiness of `leftover`.
    const { contents, leftover } = substituteSlipTags(
      SMALL,
      mkCtx(hostileSender('BANK$&')),
      { report: true },
    ) as { contents: unknown; leftover: string[] };
    expectShapeKept(contents, 'BANK$&');
    expect(leftover).toEqual([]);
  });

  it('a newline in a bank name does not break the parse', () => {
    // The third throw vector, and the one neither the quote nor the `$` case
    // covers: a raw control character is illegal inside a JSON string literal,
    // so pre-fix this was `SyntaxError: Bad control character in string
    // literal`. Escaping via JSON.stringify turns it into `\n` and the value
    // survives as text.
    const out = substituteSlipTags(SMALL, mkCtx(hostileSender('BANK\nLINE2')));
    expectShapeKept(out, 'BANK\nLINE2');
  });
});
