import {
  applyFlexProfileVars,
  buildContextVarMap,
  extractFlexProfileFields,
  renderFlexDoc,
  resolveSourceRoles,
} from '@/modules/webhook/flex/flex-render.util';
import { FALLBACK_IMAGE_URL } from '@/modules/webhook/flex/flex-image-fallback.util';
import {
  MAX_LENGTH,
  resolveReplyTags,
} from '@/modules/webhook/hook-reply/reply-tags.util';
import {
  buildSuggestionForHook,
  formatHistory,
  injectHistory,
  resolveHistoryLimit,
  substituteCtxVars,
} from '@/modules/webhook/ai-reply/prompt-context.util';

/**
 * The reply render path.
 *
 * Nothing here performs I/O, so no provider host is reachable from this file at
 * all — but the process-wide guard in `z-test/lib/no-ai-outbound.ts` is loaded
 * regardless and would reject any fetch that appeared.
 */

describe('resolveReplyTags — order is the contract (legacy:4494-4529)', () => {
  it('strips the assist tag and substitutes [[link]]', () => {
    const out = resolveReplyTags(
      '[[[assist]]] ดูที่ [[link]] นะคะ',
      'https://example.com',
    );
    expect(out.finalReplyForLine).toBe('ดูที่ https://example.com นะคะ');
  });

  it('detects the helper tag BEFORE stripping it', () => {
    const out = resolveReplyTags(
      'ต้องการลงทะเบียนไหมคะ [[[customer-helper]]]',
      '',
    );
    expect(out.wantsHelperQuickReply).toBe(true);
    expect(out.finalReplyForLine).toBe('ต้องการลงทะเบียนไหมคะ');
  });

  it('accepts the two-bracket helper form as well', () => {
    expect(
      resolveReplyTags('x [[customer-helper]]', '').wantsHelperQuickReply,
    ).toBe(true);
  });

  it('an answer that is ONLY the helper tag still requests the buttons', () => {
    // [FIX-20260801-HELPEREMPTY]: the bug this catches made the bot fall silent
    // — the text emptied out and the empty-guard returned before the buttons.
    const out = resolveReplyTags('[[[customer-helper]]] [[[assist]]]', '');
    expect(out.wantsHelperQuickReply).toBe(true);
    expect(out.finalReplyForLine).toBe('');
  });

  describe('flex route precedence — only one card per answer', () => {
    it('flex_profile wins over flex_m and flex_pc', () => {
      const out = resolveReplyTags(
        'ข้อมูล [[[flex_profile]]] [[[flex_m00001]]] [[[flex_pc00002]]]',
        '',
      );
      expect(out.wantsFlexProfile).toBe(true);
      expect(out.wantedFlexTag).toBeNull();
      expect(out.wantedFlexPcTag).toBeNull();
      // Every losing tag is still stripped — brackets must never reach anyone.
      expect(out.finalReplyForLine).toBe('ข้อมูล');
    });

    it('flex_m wins over flex_pc', () => {
      const out = resolveReplyTags(
        '[[[flex_m00007]]] [[[flex_pc00002]]] ดูนี่',
        '',
      );
      expect(out.wantedFlexTag).toBe('flex_m00007');
      expect(out.wantedFlexPcTag).toBeNull();
      expect(out.finalReplyForLine).toBe('ดูนี่');
    });

    it('the first flex_m wins when several appear', () => {
      const out = resolveReplyTags(
        '[[[flex_m00002]]] a [[[flex_m00009]]] b',
        '',
      );
      expect(out.wantedFlexTag).toBe('flex_m00002');
      // Was `'a  b'` — two spaces, the gap each removed tag left behind.
      // [FIX-20260807-NOMARKERLEAK] collapses runs of whitespace afterwards, so
      // a stripped marker no longer leaves a visible hole in the sentence. The
      // part that matters here is unchanged: the FIRST tag still wins.
      expect(out.finalReplyForLine).toBe('a b');
    });

    it('flex_pc alone is taken', () => {
      expect(
        resolveReplyTags('[[[flex_pc00003]]] hi', '').wantedFlexPcTag,
      ).toBe('flex_pc00003');
    });

    /**
     * A four-digit tag is not a flex tag (they are five digits), so no card is
     * selected — that half is unchanged.
     *
     * What CHANGED is the text: it used to be left visible, and the customer saw
     * `[[[flex_m0001]]]` in their chat. [FIX-20260807-NOMARKERLEAK] removes it.
     * The owner's rule is that no `[[[...]]]` may ever reach a customer, and a
     * malformed tag is the case where leaking is most likely — it is what a typo
     * in a prompt or a model slip actually produces.
     *
     * So the reply is now empty, and an empty reply is not sent at all. The
     * customer sees nothing rather than seeing brackets. Legacy leaked this
     * identically until the same fix was applied there.
     */
    it('a four-digit tag selects no card, and no longer leaks to the customer', () => {
      const out = resolveReplyTags('[[[flex_m0001]]]', '');
      expect(out.wantedFlexTag).toBeNull();
      expect(out.finalReplyForLine).toBe('');
    });

    it('surrounding text survives when a malformed tag is stripped', () => {
      // The stripping must take the marker and nothing else — this is what
      // proves the catch-all is not eating the answer along with the tag.
      const out = resolveReplyTags('สวัสดีค่ะ [[[flex_m0001]]] ยินดีค่ะ', '');
      expect(out.finalReplyForLine).toBe('สวัสดีค่ะ ยินดีค่ะ');
    });
  });

  describe('length guard', () => {
    it('truncates at 4000 characters', () => {
      const out = resolveReplyTags('ก'.repeat(5000), '');
      expect(out.finalReplyForLine).toHaveLength(MAX_LENGTH);
    });

    it('strips tags BEFORE truncating, so a trailing tag cannot survive', () => {
      // The tag sits past 4000; if truncation ran first it would be cut in half
      // and its remains shipped to the customer.
      const out = resolveReplyTags(`${'ก'.repeat(4500)}[[[flex_m00001]]]`, '');
      expect(out.wantedFlexTag).toBe('flex_m00001');
      expect(out.finalReplyForLine).not.toContain('flex_m');
      expect(out.finalReplyForLine).toHaveLength(MAX_LENGTH);
    });

    it('a flex_pc JSON body is EXEMPT — truncating it would break the parse', () => {
      const json = `{"flex_pc00001":"x","body":"${'y'.repeat(5000)}"}`;
      const out = resolveReplyTags(json, '');
      expect(out.finalReplyForLine.length).toBeGreaterThan(MAX_LENGTH);
    });
  });

  it('an ordinary answer passes through unchanged apart from trimming', () => {
    expect(resolveReplyTags('สวัสดีค่ะ', '').finalReplyForLine).toBe(
      'สวัสดีค่ะ',
    );
  });
});

describe('applyFlexProfileVars', () => {
  const card = () => ({
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'ชื่อ: {{full_name}}' },
        { type: 'text', text: '{{custom_content_1}}' },
        { type: 'image', url: '{{promo_img}}' },
      ],
    },
  });

  it('substitutes string values and never keys', () => {
    const out = applyFlexProfileVars(card(), { full_name: 'สมชาย' }) as Record<
      string,
      never
    >;
    const contents = (
      out['body'] as unknown as { contents: { text: string }[] }
    ).contents;
    expect(contents[0]!.text).toBe('ชื่อ: สมชาย');
  });

  it('never mutates the document it was given', () => {
    const doc = card();
    const before = JSON.stringify(doc);
    applyFlexProfileVars(doc, { full_name: 'สมชาย' });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('an unknown tag keeps its literal text so a typo is visible', () => {
    const out = applyFlexProfileVars(
      { type: 'text', text: '{{nope}}' },
      {},
    ) as {
      text: string;
    };
    expect(out.text).toBe('{{nope}}');
  });

  it('an empty text component becomes "-" (legacy [FIX-20260801-FLEXEMPTYTEXT])', () => {
    // LINE 400s on an empty text component and the customer gets NOTHING.
    const out = applyFlexProfileVars(
      { type: 'text', text: '{{full_name}}' },
      { full_name: '' },
    ) as { text: string };
    expect(out.text).toBe('-');
  });

  it('an unusable image url becomes the fallback (legacy [FEAT-20260804-FLEXIMGFALLBACK])', () => {
    for (const url of [
      '',
      '-',
      'img.example.net/a.png',
      'http://x.com/a.png',
      '{{unset}}',
    ]) {
      const out = applyFlexProfileVars({ type: 'image', url }, {}) as {
        url: string;
      };
      expect(out.url).toBe(FALLBACK_IMAGE_URL);
    }
  });

  it('a usable https url is left alone', () => {
    const out = applyFlexProfileVars(
      { type: 'image', url: 'https://cdn.example.com/a.png' },
      {},
    ) as { url: string };
    expect(out.url).toBe('https://cdn.example.com/a.png');
  });

  describe('dropWhenEmpty — content slots', () => {
    const declared = new Set(['custom_content_1']);

    it('an unfilled declared slot removes its whole component', () => {
      const out = applyFlexProfileVars(
        {
          type: 'box',
          contents: [
            { type: 'text', text: '{{custom_content_1}}' },
            { type: 'text', text: 'คงอยู่' },
          ],
        },
        { custom_content_1: '' },
        { dropWhenEmpty: declared },
      ) as { contents: { text: string }[] };
      expect(out.contents).toHaveLength(1);
      expect(out.contents[0]!.text).toBe('คงอยู่');
    });

    it('a slot mixed with other text is NOT dropped — deleting would eat the text', () => {
      const out = applyFlexProfileVars(
        { type: 'text', text: '{{custom_content_1}} บาท' },
        { custom_content_1: '' },
        { dropWhenEmpty: declared },
      ) as { text: string };
      // The component survives with the surrounding words intact. Note it does
      // NOT become '-' either: the '-' rule only fires for a text component that
      // is empty AFTER substitution, and ' บาท' is not empty. `isOnlyDeclaredTags`
      // is consulted solely inside that empty branch, so a mixed string never
      // reaches the drop decision at all.
      expect(out.text).toBe(' บาท');
    });

    it('a box emptied by drops removes itself, cascading upward', () => {
      const out = applyFlexProfileVars(
        {
          type: 'box',
          contents: [
            {
              type: 'box',
              contents: [{ type: 'text', text: '{{custom_content_1}}' }],
            },
          ],
        },
        { custom_content_1: '' },
        { dropWhenEmpty: declared },
      );
      expect(out).toBeNull();
    });

    it('with NO declarations the cascade cannot fire — legacy cards are safe by construction', () => {
      const doc = { type: 'box', contents: [] };
      expect(applyFlexProfileVars(doc, {})).toEqual({
        type: 'box',
        contents: [],
      });
    });

    it('the drop Symbol never escapes to the caller', () => {
      // A Symbol reaching JSON.stringify becomes a malformed payload and LINE
      // rejects the whole message.
      const out = applyFlexProfileVars(
        { type: 'text', text: '{{custom_content_1}}' },
        { custom_content_1: '' },
        { dropWhenEmpty: declared },
      );
      expect(out).toBeNull();
      expect(JSON.stringify(out)).toBe('null');
    });

    it('an emptied section is deleted rather than sent as an empty box', () => {
      const out = applyFlexProfileVars(
        {
          type: 'bubble',
          header: {
            type: 'box',
            contents: [{ type: 'text', text: '{{custom_content_1}}' }],
          },
          body: { type: 'box', contents: [{ type: 'text', text: 'อยู่' }] },
        },
        { custom_content_1: '' },
        { dropWhenEmpty: declared },
      ) as Record<string, unknown>;
      expect(out['header']).toBeUndefined();
      expect(out['body']).toBeDefined();
    });
  });
});

describe('renderFlexDoc — where the content slots plug in (legacy:1394-1424)', () => {
  const doc = {
    content_json: {
      type: 'box',
      contents: [
        { type: 'text', text: '{{custom_content_1}}' },
        { type: 'text', text: '{{custom_content_2}}' },
        { type: 'text', text: 'เว็บ {{hook_domain}}' },
      ],
    },
    content_tags: [
      { no: 1, label: 'ทักทาย' },
      { no: 2, label: 'ปิดท้าย' },
    ],
  };
  const hook = { domain_name: 'example.com' };

  it('routes the model markers into their slots', () => {
    const out = renderFlexDoc(
      doc,
      {},
      '[[[custom_content_1]]] สวัสดีค่ะ [[[custom_content_2]]] ขอบคุณค่ะ',
      hook,
    ) as { contents: { text: string }[] };
    expect(out.contents[0]!.text).toBe('สวัสดีค่ะ');
    expect(out.contents[1]!.text).toBe('ขอบคุณค่ะ');
    expect(out.contents[2]!.text).toBe('เว็บ example.com');
  });

  it('an unmarked answer fills the lowest slot and the rest disappear', () => {
    const out = renderFlexDoc(doc, {}, 'คำตอบธรรมดา', hook) as {
      contents: { text: string }[];
    };
    expect(out.contents[0]!.text).toBe('คำตอบธรรมดา');
    // Slot 2 was declared and unfilled → its component is gone, not a dash.
    expect(out.contents).toHaveLength(2);
    expect(out.contents[1]!.text).toBe('เว็บ example.com');
  });

  it('{{content}} is marker-stripped for EVERY card (legacy [FIX-20260805-STRIPALL])', () => {
    // A legacy card that declares nothing, given an answer in the marker
    // format: the customer must not see the brackets.
    const legacyCard = {
      content_json: { type: 'text', text: '{{content}}' },
      content_tags: [],
    };
    const out = renderFlexDoc(
      legacyCard,
      {},
      '[[[custom_content_1]]] สวัสดี',
      hook,
    ) as { text: string };
    expect(out.text).toBe('สวัสดี');
    expect(out.text).not.toContain('custom_content');
  });

  it('an ordinary answer keeps every space (legacy [FIX-20260805-STRIPNOOP])', () => {
    const legacyCard = {
      content_json: { type: 'text', text: '{{content}}' },
      content_tags: [],
    };
    const out = renderFlexDoc(legacyCard, {}, 'สวัสดี  ครับ', hook) as {
      text: string;
    };
    expect(out.text).toBe('สวัสดี  ครับ');
  });

  it("a card's own slots outrank system-wide variables", () => {
    const clash = {
      content_json: { type: 'text', text: '{{custom_content_1}}' },
      content_tags: [{ no: 1, label: 'x' }],
    };
    const out = renderFlexDoc(
      clash,
      { custom_content_1: 'จากแหล่งข้อมูล' },
      '[[[custom_content_1]]] จากการ์ด',
      hook,
    ) as { text: string };
    expect(out.text).toBe('จากการ์ด');
  });

  it('context variables outrank data-source variables', () => {
    const card = {
      content_json: { type: 'text', text: '{{hook_domain}}' },
      content_tags: [],
    };
    const out = renderFlexDoc(
      card,
      { hook_domain: 'hijacked.example' },
      'x',
      hook,
    ) as {
      text: string;
    };
    expect(out.text).toBe('example.com');
  });
});

describe('buildContextVarMap', () => {
  it('an unset hook field is EMPTY, not "-"', () => {
    const out = buildContextVarMap({ hook: {}, content: 'x' });
    expect(out['hook_domain']).toBe('');
    expect(out['hook_name']).toBe('');
    expect(out['hook_detail']).toBe('');
  });

  it('but unset content IS "-"', () => {
    expect(buildContextVarMap({ hook: {} })['content']).toBe('-');
  });

  it('content is returned untrimmed — trim only decides emptiness', () => {
    expect(buildContextVarMap({ content: '  hi  ' })['content']).toBe('  hi  ');
    expect(buildContextVarMap({ content: '   ' })['content']).toBe('-');
  });

  it('an array joins, an object is empty', () => {
    expect(
      buildContextVarMap({ hook: { domain_name: ['a', 'b'] } })['hook_domain'],
    ).toBe('a, b');
    expect(
      buildContextVarMap({ hook: { domain_name: {} } })['hook_domain'],
    ).toBe('');
  });
});

describe('resolveSourceRoles', () => {
  const registry = { profile: {}, site_rules: {} };

  it('the implicit source is always present (legacy [FIX-20260802-NSBASE])', () => {
    expect(
      resolveSourceRoles({ source_roles: ['site_rules'] }, registry),
    ).toEqual(['profile', 'site_rules']);
  });

  it('falls back through source_roles → source_role → [profile]', () => {
    expect(resolveSourceRoles({ source_role: 'site_rules' }, registry)).toEqual(
      ['profile', 'site_rules'],
    );
    expect(resolveSourceRoles({}, registry)).toEqual(['profile']);
    expect(resolveSourceRoles(null, registry)).toEqual(['profile']);
  });

  it('an unregistered source is dropped rather than throwing', () => {
    expect(
      resolveSourceRoles({ source_roles: ['deleted_source'] }, registry),
    ).toEqual(['profile']);
  });
});

describe('extractFlexProfileFields (legacy [FIX-20260801-FLEXPROFILEPATH])', () => {
  it('reads the double-nested shape the custom tool actually stores', () => {
    const combined = {
      MY_ENDPOINT: {
        is_profile: true,
        data: {
          data: {
            profile: { phone: '0812345678', bank: { account_name: 'สมชาย' } },
          },
        },
      },
    };
    expect(extractFlexProfileFields(combined)).toMatchObject({
      fullName: 'สมชาย',
      phone: '0812345678',
      hasProfile: true,
    });
  });

  it('prefers a flagged block that HAS a profile over a flagged block that failed', () => {
    const combined = {
      BROKEN: { is_profile: true, data: { message: 'upstream error' } },
      OTHER: { data: { data: { profile: { phone: '0899999999' } } } },
    };
    expect(extractFlexProfileFields(combined).phone).toBe('0899999999');
  });

  it('no profile anywhere → hasProfile false and empty strings, never a throw', () => {
    expect(extractFlexProfileFields(null)).toEqual({
      fullName: '',
      phone: '',
      hasProfile: false,
      profile: null,
    });
  });
});

describe('prompt context', () => {
  it('a legacy-shaped suggestion_text is sent untouched', () => {
    const hook = {
      suggestion_text: 'เนื้อหาเดิม [END_OF_BASIC_INFO] ต่อท้าย',
      suggestion_company_text: 'ไม่ควรถูกใช้',
    };
    expect(buildSuggestionForHook(hook, true)).toBe(hook.suggestion_text);
  });

  // [PROMPT-20260813-DROPNOPROFILE] no_profile box is intentionally NOT sent.
  it('a legacy row with no profile returns suggestion_text, NOT the no_profile box', () => {
    const hook = {
      suggestion_text: 'x [END_OF_BASIC_INFO]',
      suggestion_text_no_profile: 'ยังไม่ผูกบัญชี',
    };
    // Was 'ยังไม่ผูกบัญชี' before the drop; now the basic text, unchanged.
    expect(buildSuggestionForHook(hook, false)).toBe('x [END_OF_BASIC_INFO]');
  });

  it('a new-shape hook drops ONLY the no_profile box — basic + company survive byte-for-byte', () => {
    const out = buildSuggestionForHook(
      {
        suggestion_text: 'พื้นฐาน',
        suggestion_company_text: 'บริษัท',
        suggestion_text_no_profile: 'ไม่มีโปรไฟล์',
      },
      true,
    );
    // basic + company assembled exactly as before; no_profile absent.
    expect(out).toBe(
      '[START_OF_BASIC_INFO]\nพื้นฐาน\n[END_OF_BASIC_INFO]\n' +
        '[START_OF_COMPANY_INFO]\nบริษัท\n[END_OF_COMPANY_INFO]',
    );
    expect(out).not.toContain('NO_PROFILE_DATA');
    expect(out).not.toContain('ไม่มีโปรไฟล์');
  });

  it('an empty box does not grow an empty block', () => {
    expect(buildSuggestionForHook({ suggestion_text: '   ' }, true)).toBe('');
  });

  it.each([
    [undefined, 5],
    [null, 5],
    [0, 5],
    [-3, 5],
    ['abc', 5],
    [1, 1],
    [7, 7],
    [7.9, 7],
    [30, 30],
    [999, 30],
  ])('resolveHistoryLimit(%j) → %i', (value, want) => {
    expect(resolveHistoryLimit({ ai_history_limit: value })).toBe(want);
  });

  it('formatHistory reverses to oldest-first and wraps in markers', () => {
    const out = formatHistory([
      { sender_type: 'bot', content: 'ตอบ' },
      { sender_type: 'customer', content: 'ถาม' },
    ]);
    expect(out).toBe(
      '[start-of-history]\nCustomer: ถาม\nBot: ตอบ\n[end-of-history]',
    );
  });

  it('formatHistory masks image tags and truncates at 250', () => {
    const out = formatHistory([
      { sender_type: 'bot', content: '[[[img_abc]]]' },
      { sender_type: 'customer', content: 'ก'.repeat(300) },
    ]);
    expect(out).toContain('Bot: [Image sent to customer]');
    expect(out).toContain(`Customer: ${'ก'.repeat(250)}...`);
  });

  /* [FIX-20260821-HISTMARKERS] ป้ายภายในต้องไม่ถูกป้อนเข้าโมเดลดิบ ๆ
   * =========================================================================
   * เจอจริงจาก prod 20/08 (ห้อง a0d000000000000000000008, member U07afe64…):
   * ลูกค้าถาม "ขอลิ้งค์เว็บหน่อยค่ะ" สองครั้งห่างกัน 34 วินาที
   *   ครั้งแรก  → บอทส่งการ์ด · แถวประวัติเก็บ content = "[Flex] ข้อมูลส่วนนี้…"
   *   ครั้งที่สอง → โมเดล **ลอกบรรทัดนั้นออกมาทั้งบรรทัดรวมป้าย `[Flex] `**
   *                (เหมือนกันครบ 117 ตัวอักษร byte-for-byte)
   * ผล: ลูกค้าบน LINE ได้ข้อความขึ้นต้นว่า `[Flex] ` และหน้าจอแอดมินวาดการ์ดแดง
   * (FE เห็น `[Flex]` แล้วส่งเข้า FlexSlipCard พอไม่มี flex_json เลยสังเคราะห์เอง)
   *
   * ยืนยันครบวง ไม่ใช่การเดา: `content` ถูกเขียนตอนสร้างแถวจาก `replyText`
   * (webhook.service.ts:4099) และแถวนั้นมี created_at = updated_at เป๊ะ ⇒ ไม่มีใคร
   * มาแก้ทีหลัง ⇒ ตัวอักษรนั้นออกมาจากโมเดลจริง · และ Training Doc ของ OA นั้น
   * มี `[[[history]]]` จริง (38,691 ตัวอักษร) ⇒ ประวัติถูกป้อนเข้าไปแน่นอน
   *
   * ⚠️ ห้ามแก้ที่ปลายทางอื่น: `webhook.service.ts:2237-2241` เขียนกำกับไว้ว่า
   * เจ้าของสั่งให้ห้องแชท **ต้องเห็นป้าย** (แอดมินจะได้รู้ว่าทำไมห้องถูกส่งมา)
   * ⇒ ป้ายต้องอยู่ใน DB ต่อไป และต้องถอดตอนป้อนเข้าโมเดลเท่านั้น
   *
   * ⚠️ `[[[assist]]]` อันตรายกว่า `[Flex]` มาก — ถ้าโมเดลลอกออกมา มันจะ
   * ยึดห้อง + เปิด ticket + ยิงการ์ดเข้า Telegram โดยไม่มีใครสั่ง
   * ของจริงในฐานข้อมูลมี 71 แถวที่ค้างป้ายนี้ไว้ใน content
   */
  describe('⭐ [FIX-20260821-HISTMARKERS] ป้ายภายในไม่ถูกป้อนเข้าโมเดล', () => {
    const hist = (content: string, sender = 'bot') =>
      formatHistory([{ sender_type: sender, content }]);

    it('⭐⭐ `[Flex] ` ไม่หลุดเข้าโมเดล แต่เนื้อความยังอยู่ครบ', () => {
      const out = hist(
        '[Flex] ข้อมูลส่วนนี้ต้องลงทะเบียนเข้าใช้งานก่อนตรวจสอบ',
      );
      expect(out).not.toContain('[Flex]');
      expect(out).toContain('ข้อมูลส่วนนี้ต้องลงทะเบียนเข้าใช้งานก่อนตรวจสอบ');
    });

    it('⭐ ยังบอกโมเดลว่า "เคยส่งการ์ดไปแล้ว" — ไม่ใช่ลบทิ้งเฉย ๆ', () => {
      /* ถ้าตัดแถวทิ้งหรือลอกป้ายออกเปล่า ๆ โมเดลจะไม่รู้ว่าเคยส่งการ์ดขอ
         ลงทะเบียนไปแล้ว ⇒ ถามซ้ำได้ · ต้องเหลือคำอธิบายเป็นภาษาคนไว้ */
      expect(hist('[Flex] ก')).toContain('[ส่งการ์ดให้ลูกค้าแล้ว]');
    });

    it('⭐ `[Flex-Error]` ก็ต้องโดนด้วย — ป้ายชนิดที่สอง', () => {
      const out = hist('[Flex-Error] การ์ดมีปัญหา');
      expect(out).not.toContain('[Flex-Error]');
      expect(out).toContain('การ์ดมีปัญหา');
    });

    it('⭐⭐ `[[[assist]]]` ถูกถอด แต่ประโยคยังอยู่ทั้งประโยค', () => {
      /* ป้ายนี้อยู่ **ท้ายประโยค** ไม่ใช่หัว ⇒ ลอกทั้งบรรทัดไม่ได้ ต้องถอดเฉพาะป้าย
         แถวจริง: "ขออภัยนะคะ 🙏 … ขอส่งให้พี่แอดมินช่วยดูแลต่อนะคะ [[[assist]]]" */
      const out = hist('ขอส่งให้พี่แอดมินช่วยดูแลต่อนะคะ [[[assist]]]');
      expect(out).not.toContain('[[[assist]]]');
      expect(out).toContain('ขอส่งให้พี่แอดมินช่วยดูแลต่อนะคะ');
    });

    it('⭐ `[[[customer-helper]]]` ถูกถอด ประโยคยังอยู่', () => {
      const out = hist('กรุณาลงทะเบียนก่อนนะคะ [[[customer-helper]]]');
      expect(out).not.toContain('customer-helper');
      expect(out).toContain('กรุณาลงทะเบียนก่อนนะคะ');
    });

    it('⭐⭐ ป้ายที่วงเล็บไม่ครบก็ต้องถอด — ตัวรับในระบบยอมรับแบบหลวมอยู่แล้ว', () => {
      /* `reply-tags.util.ts` และเพื่อน ๆ ใช้ `\[\[\[?customer-helper\]\]\]?`
         ⇒ `[[assist]]` ทำงานเหมือน `[[[assist]]]` ทุกประการ
         ถ้าตัวถอดจับแค่แบบสวย ป้ายแบบหลวมจะรอดเข้า prompt แล้วโมเดลลอกได้
         และตัวรับก็จะทำงานจริง ⇒ รูย้ายที่ ไม่ได้ถูกปิด
         ⚠️ เคสนี้เกิดจาก mutation ที่ **หลุด**: บีบ regex ให้บังคับปิดสามชั้น
            แล้วเทสทั้งชุดยังเขียว เพราะทุกเคสที่มีอยู่ใช้แบบสวยหมด */
      expect(hist('ขอส่งแอดมินนะคะ [[assist]]')).not.toContain('assist');
      expect(hist('ขอส่งแอดมินนะคะ [[[assist]]')).not.toContain('assist');
      expect(hist('ขอส่งแอดมินนะคะ [[customer-helper]]')).not.toContain(
        'customer-helper',
      );
      /* เนื้อความต้องยังอยู่ทุกแบบ */
      expect(hist('ขอส่งแอดมินนะคะ [[assist]]')).toContain('ขอส่งแอดมินนะคะ');
    });

    it('⭐ ป้ายวงเล็บสามชั้นแบบอื่นก็ไม่หลุด', () => {
      expect(hist('ก [[[flex_profile]]]')).not.toContain('[[[');
      expect(hist('ก [[[flex_m12345]]]')).not.toContain('[[[');
    });

    it('⭐⭐ ข้อความธรรมดาไม่ถูกแตะแม้แต่ตัวอักษรเดียว', () => {
      /* วัดจากของจริง 633 แถว: 503 แถวไม่มีป้ายเลย ห้ามขยับสักตัว */
      const plain = 'ตอนนี้ระบบของทางเว็บไซต์เปิดให้บริการตามปกตินะคะ';
      expect(hist(plain)).toBe(
        `[start-of-history]\nBot: ${plain}\n[end-of-history]`,
      );
    });

    it('⭐⭐ `[image]` / `[sticker]` ของลูกค้าไม่โดน — คนละคำ', () => {
      /* ของจริง: [image] 81 แถว · [sticker] 5 แถว · ทั้งคู่ขึ้นต้นด้วย [ เหมือนกัน
         แต่ไม่ใช่ป้ายภายใน — โมเดลต้องเห็นตามเดิม */
      expect(hist('[image]', 'customer')).toContain('Customer: [image]');
      expect(hist('[sticker]', 'customer')).toContain('Customer: [sticker]');
    });

    it('⭐ จับเฉพาะป้ายที่อยู่หัวข้อความ ไม่ใช่ค้นทั้งก้อน', () => {
      /* ของจริง: มี [Flex] อยู่กลางข้อความ = 0 แถว · แต่ถ้าวันหน้ามีใครพิมพ์
         ต้องไม่ถูกตัดหัวทิ้งจนความหมายเพี้ยน */
      const out = hist('ลูกค้าถามเรื่อง [Flex] คืออะไร');
      expect(out).toContain('ลูกค้าถามเรื่อง');
      expect(out).toContain('คืออะไร');
    });

    it('⭐ ตัดที่ 250 ตัวอักษรยังทำงานเหมือนเดิม', () => {
      const out = hist(`[Flex] ${'ก'.repeat(300)}`);
      expect(out).toContain('...');
      expect(out).not.toContain('[Flex]');
    });
  });

  it('an empty history renders "none" inside the markers', () => {
    expect(formatHistory([])).toBe(
      '[start-of-history]\nnone\n[end-of-history]',
    );
  });

  it('injectHistory replaces EVERY marker (legacy [FIX-20260803-HISTALL])', () => {
    const out = injectHistory('a [[[history]]] b [[[history]]] c', 'H');
    expect(out).toBe('a H b H c');
  });

  it('substituteCtxVars fills known names and leaves unknown ones visible', () => {
    const out = substituteCtxVars(
      'เว็บ {{hook_domain}} ชื่อ {{hook_name}} ผิด {{nope}}',
      { domain_name: 'example.com', company_name: 'ร้านตัวอย่าง' },
      '',
    );
    expect(out).toBe('เว็บ example.com ชื่อ ร้านตัวอย่าง ผิด {{nope}}');
  });

  it('text with no {{ is returned byte-identical', () => {
    const text = 'สวัสดี  ครับ   ';
    expect(substituteCtxVars(text, { domain_name: 'x' }, '')).toBe(text);
  });
});
