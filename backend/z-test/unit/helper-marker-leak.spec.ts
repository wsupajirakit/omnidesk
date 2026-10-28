import {
  CUSTOMER_HELPER_DEFAULT_TEXT,
  resolveCustomerHelperText,
  resolveReplyTags,
} from '@/modules/webhook/hook-reply/reply-tags.util';
import {
  resolveHookTextReply,
  resolveHookTextReplyMode,
} from '@/modules/webhook/hook-reply/hook-text-reply';

/**
 * [FIX-20260812-HELPERMARKERLEAK] hook-field replies must not leak markers.
 *
 * THE BUG: `missing_api_data_text` and `image_answer_text` are frequently set to the
 * marker `[[[customer-helper]]]` — the tag that is supposed to turn into a register
 * button. But the three sites that send those fields never call `resolveReplyTags`
 * (it runs only on the AI path, `webhook.service.ts:2911`), so the customer receives
 * the literal brackets. The repo already forbids this outright:
 * "The owner's rule is absolute: a reply sent to a customer must never contain
 * `[[[...]]]` or `[[...]]`" (`reply-tags.util.ts:224-226`).
 *
 * ⚠️ THE TRAP THIS FILE EXISTS TO PIN: a marker-only field strips down to an EMPTY
 * string. Sending that as text makes LINE answer 400 and the customer gets silence —
 * strictly worse than seeing brackets. That exact bug already happened once
 * (`[FIX-20260801-HELPEREMPTY]`, `webhook.service.ts:3055-3060`), and the fix was to
 * substitute `resolveCustomerHelperText(hook)` whenever the tag is present. Any change
 * to the marker handling must keep that substitution alive; these tests fail if it is
 * dropped.
 *
 * Written BEFORE the fix and green on unchanged code: everything here describes
 * `reply-tags.util` behaviour that the fix depends on, so it is a characterization
 * test first and a regression guard afterwards.
 */
describe('[FIX-20260812-HELPERMARKERLEAK] marker resolution contract', () => {
  it('a marker-only field strips to an EMPTY string — never send it as text', () => {
    const tags = resolveReplyTags('[[[customer-helper]]]', '');

    // This is the whole reason a naive "just strip it" fix is wrong.
    expect(tags.finalReplyForLine).toBe('');
    expect(tags.wantsHelperQuickReply).toBe(true);
  });

  it('two-bracket spelling is recognised too', () => {
    const tags = resolveReplyTags('[[customer-helper]]', '');

    expect(tags.wantsHelperQuickReply).toBe(true);
    expect(tags.finalReplyForLine).toBe('');
  });

  it('the substitution text is what saves the customer from silence', () => {
    // No per-OA copy configured ⇒ the shared Thai default.
    expect(resolveCustomerHelperText({})).toBe(CUSTOMER_HELPER_DEFAULT_TEXT);
    // Per-OA copy wins when set.
    expect(
      resolveCustomerHelperText({ customer_helper_text: 'ลงทะเบียนที่นี่' }),
    ).toBe('ลงทะเบียนที่นี่');
  });

  it('a marker mixed with real text keeps the text and drops the brackets', () => {
    const tags = resolveReplyTags('ยังไม่พบข้อมูล [[[customer-helper]]]', '');

    expect(tags.finalReplyForLine).toBe('ยังไม่พบข้อมูล');
    expect(tags.wantsHelperQuickReply).toBe(true);
  });

  /**
   * The safety property for every OA that did NOT put a marker in the field: the
   * resolver must be a behavioural no-op. If this ever goes red, the fix has started
   * rewriting ordinary replies, which is exactly what must not happen.
   */
  it.each([
    'ขออภัย ไม่พบข้อมูลของท่าน',
    'กรุณาผูกบัญชีก่อนค่ะ',
    'missing api data',
    'รับรูปแล้วค่ะ รอสักครู่นะคะ',
    'ยังไม่ได้ผูกบัญชี กรุณาผูกบัญชีก่อนแล้วส่งสลิปอีกครั้ง',
  ])('plain text passes through untouched: %s', (text) => {
    const tags = resolveReplyTags(text, '');

    expect(tags.finalReplyForLine).toBe(text);
    expect(tags.wantsHelperQuickReply).toBe(false);
  });

  /**
   * Unknown markers must still never reach a customer — the catch-all at
   * `reply-tags.util.ts:261-288` covers markers nobody strips by name.
   */
  it.each([
    ['[[[unknown_tag]]]', ''],
    ['[[bracket2]]', ''],
    // The catch-all also collapses the double space the removal would leave behind.
    ['ข้อความ [[[history]]] ต่อ', 'ข้อความ ต่อ'],
  ])('unknown marker %s is swept by the catch-all', (input, expected) => {
    expect(resolveReplyTags(input, '').finalReplyForLine).toBe(expected);
  });
});

/**
 * The helper that the three send-sites use. Three modes so a rollout can stop at any
 * step, and so the fix can be switched off without a deploy — the owner asked for
 * "ถอดได้ หยุดได้ สลับได้".
 */
describe('[FIX-20260812-HELPERMARKERLEAK] resolveHookTextReply modes', () => {
  const MARKER = '[[[customer-helper]]]';
  const hook = { customer_helper_text: 'กดปุ่มลงทะเบียนได้เลยค่ะ' };

  /* ── [FIX-20260901-OFFMENUTAG] this assertion was INVERTED on 01/09 ──────────
     What stood here:

       it("mode 'off' is byte-identical to the old behaviour — brackets included")
         expect(r.text).toBe(MARKER)

     It pinned `off` sending `[[[customer-helper]]]` to a customer verbatim, which
     is precisely the leak the file's own header calls a bug the repo "forbids
     outright". The contradiction was never noticed because `off` was framed as
     "the feature is switched off" — but measured on 01/09, 13 of 28 hooks hold
     this marker, every one in `missing_api_data_text`, and all of them read as
     `off`. So the fix written in 08/2026 had never run on most of the product.

     The owner's decision on 01/09 — `off` is the only mode, and it must work —
     retires the old contract. `off` now resolves the three families that must
     never reach a customer raw, and nothing else. */
  it("mode 'off' now removes the marker and substitutes the helper copy", () => {
    const r = resolveHookTextReply({ rawText: MARKER, hook, mode: 'off' });

    expect(r.text).toBe('กดปุ่มลงทะเบียนได้เลยค่ะ');
    expect(r.text).not.toContain('[[[');
    /* Still false: buttons belong to `button` mode. Removing a marker does not
       imply the customer asked for a register button. */
    expect(r.wantsHelperQuickReply).toBe(false);
  });

  it("mode 'strip' removes the marker and substitutes the helper copy (never empty)", () => {
    const r = resolveHookTextReply({ rawText: MARKER, hook, mode: 'strip' });

    expect(r.text).toBe('กดปุ่มลงทะเบียนได้เลยค่ะ');
    expect(r.text).not.toContain('[[[');
    // 'strip' deliberately stops short of buttons.
    expect(r.wantsHelperQuickReply).toBe(false);
  });

  it("mode 'button' gives the same text plus the register quick reply", () => {
    const r = resolveHookTextReply({ rawText: MARKER, hook, mode: 'button' });

    expect(r.text).toBe('กดปุ่มลงทะเบียนได้เลยค่ะ');
    expect(r.wantsHelperQuickReply).toBe(true);
  });

  it('falls back to the shared default when the OA wrote no helper copy', () => {
    const r = resolveHookTextReply({
      rawText: MARKER,
      hook: {},
      mode: 'button',
    });

    expect(r.text).toBe(CUSTOMER_HELPER_DEFAULT_TEXT);
  });

  /**
   * ⭐ The property that keeps every existing OA safe: a field with no marker must
   * come out of every mode unchanged and without buttons.
   */
  it.each(['off', 'strip', 'button'] as const)(
    'plain text is untouched in mode %s',
    (mode) => {
      const r = resolveHookTextReply({
        rawText: 'ขออภัย ไม่พบข้อมูลของท่าน',
        hook,
        mode,
      });

      expect(r.text).toBe('ขออภัย ไม่พบข้อมูลของท่าน');
      expect(r.wantsHelperQuickReply).toBe(false);
    },
  );

  it('keeps surrounding text when the marker is only part of the field', () => {
    const r = resolveHookTextReply({
      rawText: `ยังไม่พบข้อมูล ${MARKER}`,
      hook,
      mode: 'button',
    });

    // Real text present ⇒ no substitution needed, just the marker removed.
    expect(r.text).toBe('ยังไม่พบข้อมูล');
    expect(r.wantsHelperQuickReply).toBe(true);
  });

  it('never throws on empty or missing input', () => {
    expect(
      resolveHookTextReply({ rawText: '', hook, mode: 'button' }).text,
    ).toBe('');
    expect(
      resolveHookTextReply({ rawText: undefined, hook: null, mode: 'strip' })
        .text,
    ).toBe('');
  });
});

describe('[FIX-20260812-HELPERMARKERLEAK] resolveHookTextReplyMode', () => {
  it('defaults to off when unset', () => {
    expect(resolveHookTextReplyMode(undefined)).toBe('off');
    expect(resolveHookTextReplyMode({})).toBe('off');
  });

  it('reads the configured mode', () => {
    expect(resolveHookTextReplyMode({ hook_text_reply_mode: 'strip' })).toBe(
      'strip',
    );
    expect(resolveHookTextReplyMode({ hook_text_reply_mode: 'button' })).toBe(
      'button',
    );
  });

  /** A typo must not silently switch on a customer-visible change. */
  it.each(['Button', 'on', 'true', 1, null])(
    'falls back to off for junk value %s',
    (junk) => {
      expect(resolveHookTextReplyMode({ hook_text_reply_mode: junk })).toBe(
        'off',
      );
    },
  );
});

/* [FEAT-20260831-MENUMAINTAG] an operator field may name a MENU CARD.
   ────────────────────────────────────────────────────────────────────────────
   เจ้าของตั้ง `image_answer_text = "[[[menu_main_00010]]]"` and the bot answered
   nothing. The log said it exactly:

     [REPLY-DEBUG] Reply with Image Answer Text:            ← empty
     [ASSIST] Failed to send image_answer_text: … status code 400

   The resolver strips every marker it knows — correctly, a marker must never
   reach a customer — and this field was NOTHING BUT a marker, so what remained
   was "" and LINE refuses an empty text message. Stripping was right; throwing
   the card away with it was not.

   The resolver therefore REPORTS the menu card the operator named, exactly as
   `resolveReplyTags` already reports it for the AI path. Sending is the caller's
   job — this function stays pure. */
describe('[MENUCARDTAG] the hook-text resolver reports a menu card', () => {
  const hook = { hook_text_reply_mode: 'flex' } as Record<string, unknown>;

  it('⭐⭐⭐ a field that is only a menu marker reports the tag', () => {
    const r = resolveHookTextReply({
      rawText: '[[[menu_main_00010]]]',
      hook,
      mode: 'flex',
    });
    expect(r.wantedMenuCardTag).toBe('menu_main_00010');
  });

  it('⭐⭐⭐ the text is still empty — the marker never leaks', () => {
    const r = resolveHookTextReply({
      rawText: '[[[menu_main_00010]]]',
      hook,
      mode: 'flex',
    });
    expect(r.text).not.toContain('menu_main_00010');
    expect(r.text).not.toContain('[[[');
  });

  it('⭐⭐ an operator sentence around the marker is kept', () => {
    const r = resolveHookTextReply({
      rawText: 'เลือกเมนูได้เลยค่ะ [[[menu_main_00010]]]',
      hook,
      mode: 'flex',
    });
    expect(r.wantedMenuCardTag).toBe('menu_main_00010');
    expect(r.text).toContain('เลือกเมนูได้เลยค่ะ');
  });

  it('⭐⭐ a field with no menu marker reports null — nothing else changes', () => {
    const r = resolveHookTextReply({
      rawText: 'ขอบคุณค่ะ',
      hook,
      mode: 'flex',
    });
    expect(r.wantedMenuCardTag).toBeNull();
    expect(r.text).toBe('ขอบคุณค่ะ');
  });

  /* ── [FIX-20260901-OFFMENUTAG] this block REPLACES an assertion, deliberately ──
     What stood here until 01/09:

       it("⭐ mode 'off' is the untouched path — no reading, no reporting")
         expect(r.text).toBe('[[[menu_main_00010]]]')
         expect(r.wantedMenuCardTag).toBeNull()

     It pinned `off` returning the marker VERBATIM. That is no longer wanted, and
     the reason is a production measurement rather than a preference. Run on the
     live OA on 01/09, both directions:

       off   marker sent RAW to the admin row AND the customer · [[odk_s_*]] fine
       flex  the menu card is sent                             · [[odk_s_*]] deleted

     Neither mode was correct and they failed in opposite directions, so no
     setting could fix it. The owner's decision: `off` only, and `off` must work.

     The old contract protected an operator's own words. A marker is not their
     words — it is an instruction only this system can carry out, and returning it
     verbatim is a failure to act on it, not neutrality. `off` also cannot mean
     "deliberately chosen": there is no UI for this column at all (four i18n
     labels, zero rendered inputs — re-verified 01/09, and `refusal-reply-mode.ts`
     already reasoned from that same fact on 19/08).

     The cases below pin the NEW contract, and the last one is the reason the fix
     is shaped the way it is rather than the obvious way. */
  it("⭐ mode 'off' now reports the card and removes only its marker", () => {
    const r = resolveHookTextReply({
      rawText: '[[[menu_main_00010]]]',
      hook: {},
      mode: 'off',
    });
    expect(r.wantedMenuCardTag).toBe('menu_main_00010');
    expect(r.text).toBe('');
    expect(r.text).not.toContain('[[[');
  });

  it("⭐⭐ mode 'off' keeps the operator's own sentence around the marker", () => {
    const r = resolveHookTextReply({
      rawText: 'เลือกเมนูได้เลยค่ะ [[[menu_main_00010]]]',
      hook: {},
      mode: 'off',
    });
    expect(r.wantedMenuCardTag).toBe('menu_main_00010');
    expect(r.text).toBe('เลือกเมนูได้เลยค่ะ');
  });

  /* The regression guard that matters most: `off` is still the untouched path for
     every shape it does NOT own. If this moves, the change reached hooks it was
     never aimed at — and `off` is what almost every hook resolves to.

     ⚠️ `[[[assist]]]` is in this list on purpose. Every customer-facing site
        already strips it (`reply-tags.util.ts:276`, `webhook.service.ts:4794`)
        and the ticket decision reads the RAW field independently (`:3039`), so a
        fourth stripper here would be a second owner for one job. The admin row is
        also REQUIRED to keep it (owner, 12/08). */
  /* [FIX-20260901-OFFRAWGUARD] NARROWED on 01/09, and the narrowing is the fix.
   *
   * This case used to assert that `off` returns EVERY unowned shape byte-for-byte,
   * `[[[flex_m00019]]]` and `[[odk_p_00003]]` included. Running the compiled code
   * against that contract showed what it really bought:
   *
   *     field content                  customer received
   *     `ดูโปรได้ค่ะ [[[flex_m00019]]]`   `ดูโปรได้ค่ะ [[[flex_m00019]]]`
   *     `hello [[whatever]] there`      `hello [[whatever]] there`
   *     `a [START_OF_BASIC_INFO] b`     `a [START_OF_BASIC_INFO] b`
   *
   * "Byte-identical" and "no marker reaches a customer" cannot both hold, and the
   * second one is the older, absolute rule — it covers the ADMIN row too. So the
   * promise is now narrower and true: ordinary prose is byte-identical, and
   * `[[[assist]]]` is byte-identical, and nothing else is promised.
   * ⇒ ข้อความธรรมดาไม่ขยับ · assist ไม่ขยับ · ที่เหลือห้ามดิบ
   */
  it("⭐⭐⭐ mode 'off' leaves ordinary prose and assist byte-identical", () => {
    for (const raw of [
      'ขออภัยนะคะ ยังตอบไม่ได้',
      /* ⚠️ `[[[assist]]]` MUST come back untouched. Every customer-facing site
         already strips it (`reply-tags.util.ts`, `webhook.service.ts:4794`), the
         ticket decision reads the RAW field independently, and the admin row is
         REQUIRED to keep it (owner, 12/08). It is the one exception to the
         no-raw-markers rule, which is why the sweep takes a `keepAssist` flag
         instead of being called plainly. */
      'ขอส่งต่อแอดมินนะคะ [[[assist]]]',
      'ดูรูปได้ที่ [1] หรือ [ดูรูป] ค่ะ',
      '',
    ]) {
      const r = resolveHookTextReply({ rawText: raw, hook: {}, mode: 'off' });
      expect(r.text).toBe(raw);
      expect(r.wantedMenuCardTag).toBeNull();
      expect(r.wantsHelperQuickReply).toBe(false);
    }
  });

  /* 🔴 The other half of the same rule, and the reason the case above shrank.
     These shapes have no answer on this path — it runs when something upstream
     already failed, so no tag values were ever fetched — and the rule that a
     marker must never reach a customer or the admin row wins over keeping them. */
  it('🔴 mode off lets NO unowned marker through — customer or admin', () => {
    for (const [raw, expected] of [
      ['ดูโปรได้ค่ะ [[[flex_m00019]]]', 'ดูโปรได้ค่ะ'],
      ['hello [[whatever]] there', 'hello there'],
      ['hello [[[totally_made_up]]] there', 'hello there'],
      ['a [START_OF_BASIC_INFO] b', 'a b'],
    ] as const) {
      const r = resolveHookTextReply({ rawText: raw, hook: {}, mode: 'off' });
      expect(r.text).toBe(expected);
      expect(r.text).not.toMatch(/\[\[/);
    }
  });

  /* ── the two families added on 01/09 after the menu one ────────────────────
     `[FIX-20260812-HELPERMARKERLEAK]` was written in 08/2026 to stop the helper
     marker reaching customers, but it was gated on a mode whose default is `off`
     — so on 13 of 28 hooks (measured 01/09, every one in `missing_api_data_text`)
     that fix had never run. Same shape as the dead menu rung: the code existed
     and nothing reached it. */
  it("⭐⭐ mode 'off' removes the customer-helper marker", () => {
    const r = resolveHookTextReply({
      rawText: 'เชื่อมข้อมูลก่อนนะคะ [[[customer-helper]]]',
      hook: {},
      mode: 'off',
    });
    expect(r.text).toBe('เชื่อมข้อมูลก่อนนะคะ');
    /* still false — the quick reply belongs to `button` mode, and removing a
       marker does not imply the customer asked for buttons. */
    expect(r.wantsHelperQuickReply).toBe(false);
  });

  /* Empty is worse than brackets: LINE refuses an empty message and the customer
     gets silence (`[FIX-20260801-HELPEREMPTY]`). `off` gives the same answer the
     stripping path already gives rather than inventing a second one. */
  it('⭐⭐ a helper-marker-only field falls back to customer_helper_text, never empty', () => {
    const r = resolveHookTextReply({
      rawText: '[[[customer-helper]]]',
      hook: { customer_helper_text: 'กรุณาลงทะเบียนก่อนนะคะ' },
      mode: 'off',
    });
    expect(r.text).toBe('กรุณาลงทะเบียนก่อนนะคะ');
    expect(r.text).not.toBe('');
  });

  it("⭐⭐ mode 'off' substitutes [[link]] with the OA's answer_link", () => {
    const r = resolveHookTextReply({
      rawText: 'สมัครที่นี่ [[link]]',
      hook: { answer_link: 'https://example.test/reg' },
      mode: 'off',
    });
    expect(r.text).toBe('สมัครที่นี่ https://example.test/reg');
  });

  /* A missing link must REMOVE the tag, never write the word "undefined" into a
     customer's sentence. */
  it('⭐⭐ [[link]] with no answer_link removes the tag rather than writing undefined', () => {
    const r = resolveHookTextReply({
      rawText: 'สมัครที่นี่ [[link]]',
      hook: {},
      mode: 'off',
    });
    expect(r.text).not.toContain('[[link]]');
    expect(r.text).not.toContain('undefined');
  });

  /* Several families in ONE field, which is what a real hook looks like: the link
     is substituted, the two markers go, the card is reported. */
  it('🔴 several families at once: link substituted, markers go, card reported', () => {
    const r = resolveHookTextReply({
      rawText:
        'สมัคร [[link]] [[[customer-helper]]] [[[menu_main_00010]]] [[[assist]]]',
      hook: { answer_link: 'https://example.test/reg' },
      mode: 'off',
    });
    expect(r.text).toContain('https://example.test/reg');
    expect(r.text).not.toContain('customer-helper');
    expect(r.text).not.toContain('menu_main_00010');
    /* assist is the exception and must still be on the admin row. */
    expect(r.text).toContain('[[[assist]]]');
    expect(r.wantedMenuCardTag).toBe('menu_main_00010');
  });

  /* ═══════════════════════════════════════════════════════════════════════════
   * [FIX-20260901-OFFRAWGUARD] WHERE THE TRADE-BACK GUARD LIVES NOW
   * ═══════════════════════════════════════════════════════════════════════════
   * Three cases used to sit here asserting that `off` returns `[[odk_s_*]]`
   * untouched. They were written to stop an obvious wrong fix — routing `off`
   * through the stripping path — from silently re-breaking production, where a
   * customer was told the deposit minimum was nothing at all on 01/09.
   *
   * That danger was real, but this was the wrong place to hold it, for a reason
   * the owner settled on 01/09: **a dynamic tag only ever lives in the Training
   * Document.** Admins do not type one into `default_answer_text` or its
   * siblings — measured the same day, 0 occurrences across 28 hooks × 7 reply
   * fields, and that zero is a rule being followed, not a coincidence.
   *
   * So these cases were guarding an input that cannot occur, while forcing this
   * path to leak every OTHER unowned marker to keep the promise. The real defect
   * lives one layer up — a tag in the MODEL'S ANSWER — and it is now fixed there
   * by substitution rather than by refusing to strip:
   *
   *     z-test/unit/dyntag-escape-substitute.spec.ts
   *       "a tag the model echoed arrives with its VALUE"     -> ฝากขั้นต่ำ 100 บาท
   *       "the same answer WITHOUT the pass loses the value"  -> ฝากขั้นต่ำ บาท
   *
   * Both go red if someone routes the answer through the catch-all instead of
   * substituting, which is exactly what the deleted cases were protecting.
   * ⇒ dyntag อยู่ใน training doc เท่านั้น · ตัวกันการเทรดกลับย้ายไปอยู่ที่ที่บั๊กเกิดจริง
   */
  it('⭐⭐ a dynamic tag in a hook field is stripped, never sent raw', () => {
    const r = resolveHookTextReply({
      rawText: 'ฝากขั้นต่ำ [[odk_s_00001]] บาท [[[menu_main_00010]]]',
      hook: {},
      mode: 'off',
    });
    expect(r.wantedMenuCardTag).toBe('menu_main_00010');
    expect(r.text).not.toContain('[[');
    /* No value is reachable here — this path runs after something upstream
       failed and no tags were fetched — so the only choice is between raw and
       gone, and raw is forbidden on both the customer and the admin side. */
    expect(r.text).toBe('ฝากขั้นต่ำ บาท');
  });
});
