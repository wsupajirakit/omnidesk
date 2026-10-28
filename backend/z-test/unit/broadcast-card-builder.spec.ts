/**
 * [FEAT-20260822-BCASTCARDBUILD] The last mile: saved card → what LINE gets.
 * ===========================================================================
 * The cases that matter are the ugly ones — a tag nothing knows, a broken
 * picture, and above all a personal card handed a batch.
 */
import {
  buildCardMessage,
  PersonalCardMessageBuilder,
  PlainCardMessageBuilder,
  BROADCAST_VAR_EMPTY,
  BROADCAST_FALLBACK_IMAGE_URL,
  findLeftoverTags,
  isCardClean,
  type RecipientVarSource,
} from '@/modules/content';

const VARS = { 'member.name': 'สมชาย', 'profile.balance': '1,250.00' };

describe('buildCardMessage — values go in, nothing empty comes out', () => {
  it('fills a text card', () => {
    const r = buildCardMessage(
      { type: 'text', text: 'สวัสดี {{member.name}}' },
      VARS,
    );
    expect(r.messages).toEqual([{ type: 'text', text: 'สวัสดี สมชาย' }]);
    expect(r.unknownTags).toEqual([]);
  });

  it('🔴 an unknown tag becomes N/A, never an empty string', () => {
    /* LINE refuses a flex `text` whose value is '', so one missing value would
       cost the whole card — not one line of it. ค่าว่างส่งไม่ได้. */
    const r = buildCardMessage(
      { type: 'text', text: 'ยอด {{profile.nothing_here}} บาท' },
      VARS,
    );
    expect(r.messages[0]).toEqual({
      type: 'text',
      text: `ยอด ${BROADCAST_VAR_EMPTY} บาท`,
    });
    expect(r.unknownTags).toEqual(['profile.nothing_here']);
  });

  it('swaps a broken picture for the fallback and says so', () => {
    const r = buildCardMessage({ type: 'image', image_url: 'not a url' }, VARS);
    expect(r.messages[0]).toMatchObject({
      type: 'image',
      originalContentUrl: BROADCAST_FALLBACK_IMAGE_URL,
    });
    expect(r.imagesReplaced).toBe(1);
  });

  it('leaves a good picture alone', () => {
    const url = 'https://example.com/a.jpg';
    const r = buildCardMessage({ type: 'image', image_url: url }, VARS);
    expect(r.messages[0]).toMatchObject({ originalContentUrl: url });
    expect(r.imagesReplaced).toBe(0);
  });

  it('fills a flex card and leaves no braces behind', () => {
    const r = buildCardMessage(
      {
        type: 'flex',
        flex_json: { type: 'bubble', body: { text: 'คุณ {{member.name}}' } },
      },
      VARS,
    );
    expect(JSON.stringify(r.messages)).not.toContain('{{');
    expect(JSON.stringify(r.messages)).toContain('สมชาย');
  });

  it('🔴 never stringifies an object into a text card', () => {
    /* `String({})` is '[object Object]', and it would be SENT — a card reading
       "[object Object]" to every recipient. An earlier version of this test
       passed `undefined`, which the `String()` version handled too, so the
       mutation survived. It takes a real object to prove the narrowing.
       เทสต้องส่ง object จริงถึงจะจับได้. */
    for (const bad of [{ a: 1 }, [1, 2], 42] as unknown[]) {
      const r = buildCardMessage({ type: 'text', text: bad as string }, VARS);
      expect(JSON.stringify(r.messages)).not.toContain('[object Object]');
      /* ⚠️ WAS `text: ''` — a payload LINE refuses outright, pinned by my own
         test. An unsendable message is not a safe fallback; `N/A` is.
         ข้อความว่างส่งไม่ได้ ⇒ ไม่ใช่ทางลงที่ปลอดภัย. */
      expect(r.messages[0]).toEqual({
        type: 'text',
        text: BROADCAST_VAR_EMPTY,
      });
    }
  });
});

describe('nothing LINE refuses may leave this builder', () => {
  /* Every case below was proven RED by an independent audit against the first
     version, which keyed on the field NAME (`text`/`altText`) instead of the
     component TYPE. That one inversion produced four escapes and three
     over-sweeps at once. The repair mirrors `flex-render.util.ts:311-350`,
     which has keyed on `type` since the day it was written. */

  const flex = (json: unknown) =>
    JSON.stringify(
      buildCardMessage({ type: 'flex', flex_json: json }, VARS).messages,
    );

  it('🔴 E1 — a text component with NO text key at all is filled', () => {
    // Keying on the key name added nothing here, and LINE 400s the message.
    expect(flex({ type: 'text', size: 'sm' })).toContain(
      `"text":"${BROADCAST_VAR_EMPTY}"`,
    );
  });

  it('🔴 E2 — a numeric text is spelled out, NOT swept to N/A', () => {
    /* `0` is a real value — a balance of zero is a balance. Sweeping it would
       be a worse bug than the empty string it was meant to fix. */
    expect(flex({ type: 'text', text: 0 })).toContain('"text":"0"');
    expect(flex({ type: 'text', text: false })).toContain('"text":"false"');
    expect(flex({ type: 'text', text: {} })).toContain(
      `"text":"${BROADCAST_VAR_EMPTY}"`,
    );
  });

  it('🔴 E3 — an empty button label is filled; `label` is not `text`', () => {
    const out = flex({
      type: 'button',
      action: { type: 'uri', label: '', uri: 'https://example.com' },
    });
    expect(out).toContain(`"label":"${BROADCAST_VAR_EMPTY}"`);
    expect(out).not.toMatch(/"label":""/);
  });

  it('🔴 E4 — a broken image INSIDE the flex json is repaired', () => {
    // safeImageUrl only ever reached the `image` CARD type, never a component.
    const out = flex({ type: 'image', url: 'not a url' });
    expect(out).toContain(BROADCAST_FALLBACK_IMAGE_URL);
  });

  it('🔴 E6 — a card with no flex_json is REFUSED, not shipped', () => {
    /* `contents: undefined` reaches LINE and the whole message dies. Zero
       messages makes the sink report a failed chunk — loud and attributable. */
    const r = buildCardMessage({ type: 'flex' }, VARS);
    expect(r.messages).toEqual([]);
  });

  it('🔴 E7 — an empty box removes itself rather than killing the card', () => {
    const out = flex({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'box', layout: 'vertical', contents: [] },
          { type: 'text', text: 'เหลืออยู่' },
        ],
      },
    });
    expect(out).toContain('เหลืออยู่');
    expect(out).not.toMatch(/"contents":\[\]/);
  });

  it('🔴 O2 — a dash the ADMIN typed is content and stays', () => {
    /* A dash that meant "no value" was already turned into N/A upstream in
       build-broadcast-vars, so any dash still here is a divider or a minus
       sign — and LINE takes it happily. ขีดที่พิมพ์เอง = เนื้อหา. */
    expect(flex({ type: 'text', text: '-' })).toContain('"text":"-"');
  });

  it('🔴 O3 — a quickReply’s text is what the USER sends, and is untouched', () => {
    /* ⚠️ FIXTURE GAINED A BODY [FIX-20260823-BCASTEMPTYBOX]. It used to be a
       bubble with nothing but a quickReply — a card LINE refuses outright, so
       the rule was being proven on a message that could never be sent. The
       builder now refuses such a bubble, which is the point of D2/D3; the
       claim under test (an action's `text` is NOT repaired) is unchanged.
       พิสูจน์กติกาบนการ์ดที่ส่งได้จริง ไม่ใช่การ์ดที่ LINE ไม่รับอยู่แล้ว. */
    const out = flex({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: 'ยืนยัน' }],
      },
      quickReply: {
        items: [
          {
            type: 'action',
            action: { type: 'message', label: 'ลบ', text: '-' },
          },
        ],
      },
    });
    expect(out).toContain('"text":"-"');
  });

  it('empty and whitespace-only text are filled, like the original does', () => {
    /* The original repairs `!text.trim()` too, so a whitespace spacer becomes
       a visible marker on both paths. Matching it beats inventing a second
       rule — customers already see this behaviour on the webhook path. */
    expect(flex({ type: 'text', text: '' })).toContain(
      `"text":"${BROADCAST_VAR_EMPTY}"`,
    );
    expect(flex({ type: 'text', text: '   ' })).toContain(
      `"text":"${BROADCAST_VAR_EMPTY}"`,
    );
  });

  it('leaves a blank uri alone — N/A is not a URL', () => {
    // Same fixture note as O3: a bubble needs a section, or LINE refuses it.
    expect(
      flex({
        type: 'bubble',
        action: { type: 'uri', uri: '' },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [{ type: 'text', text: 'กด' }],
        },
      }),
    ).toContain('"uri":""');
  });

  it('a text card with no text becomes N/A, never an empty string', () => {
    expect(buildCardMessage({ type: 'text' }, VARS).messages[0]).toEqual({
      type: 'text',
      text: BROADCAST_VAR_EMPTY,
    });
  });

  it('counts every picture it repaired, so a history row cannot claim zero', () => {
    const r = buildCardMessage(
      {
        type: 'flex',
        flex_json: {
          type: 'box',
          contents: [
            { type: 'image', url: 'broken one' },
            { type: 'icon', url: 'broken two' },
            { type: 'image', url: 'https://example.com/ok.jpg' },
          ],
        },
      },
      VARS,
    );
    expect(r.imagesReplaced).toBe(2);
  });
});

describe('the last gate — no brace reaches a customer', () => {
  /* `findLeftoverTags` called itself "the last gate before a card is handed to
     LINE" and nothing in production called it. Worse, it used the SAME regex as
     the substitution, so it could only find what had already been replaced —
     structurally incapable of reporting a leftover. Both proven and fixed. */

  it('🔴 a tag the pattern cannot read still becomes N/A, not raw braces', () => {
    /* `{{member-name}}` has a hyphen and `{{ชื่อไทย}}` is Thai; neither matches
       `[A-Za-z0-9_.]`, so both were substituted by nothing and shipped intact —
       while `isCardClean` answered `true` about them. */
    const r = buildCardMessage(
      { type: 'text', text: 'สวัสดี {{member-name}} และ {{ชื่อไทย}}' },
      VARS,
    );
    const text = JSON.stringify(r.messages);
    expect(text).not.toContain('{{');
    expect(text).not.toContain('}}');
    expect(text).toContain(BROADCAST_VAR_EMPTY);
  });

  it('reports the unreadable tag rather than swallowing it', () => {
    const r = buildCardMessage({ type: 'text', text: '{{member-name}}' }, VARS);
    expect(r.unknownTags).toContain('member-name');
  });

  it('🔴 the same holds inside a flex card, at any depth', () => {
    const r = buildCardMessage(
      {
        type: 'flex',
        flex_json: {
          type: 'bubble',
          body: {
            contents: [
              { type: 'text', text: 'ยอด {{bal-ance}} บาท' },
              { type: 'box', contents: [{ type: 'text', text: '{{ไทย}}' }] },
            ],
          },
        },
      },
      VARS,
    );
    expect(JSON.stringify(r.messages)).not.toContain('{{');
  });

  it('🔴 findLeftoverTags can actually SEE an unreadable tag now', () => {
    // It shared its blind spot with the thing it was guarding.
    expect(findLeftoverTags({ text: '{{member-name}}' })).toEqual([
      'member-name',
    ]);
    expect(isCardClean({ text: '{{member-name}}' })).toBe(false);
  });

  it('a well-formed tag that resolves leaves nothing to sweep', () => {
    const r = buildCardMessage(
      { type: 'text', text: 'คุณ {{member.name}}' },
      { 'member.name': 'สมชาย' },
    );
    expect(r.unknownTags).toEqual([]);
    expect(JSON.stringify(r.messages)).toContain('สมชาย');
  });

  it('does not mistake a single brace for a tag', () => {
    const r = buildCardMessage({ type: 'text', text: 'ราคา {100} บาท' }, VARS);
    expect(JSON.stringify(r.messages)).toContain('{100}');
    expect(r.unknownTags).toEqual([]);
  });
});

describe('PlainCardMessageBuilder — rendered once, reused', () => {
  it('returns the same messages for every chunk', () => {
    const b = new PlainCardMessageBuilder(
      { type: 'text', text: 'ประกาศ' },
      VARS,
    );
    expect(b.messagesFor()).toEqual(b.messagesFor());
    expect(b.messagesFor().imagesReplaced).toBe(0);
    expect(b.result.messages[0]).toEqual({ type: 'text', text: 'ประกาศ' });
  });
});

describe('PersonalCardMessageBuilder — one person, or nothing', () => {
  const source: RecipientVarSource = {
    varsFor: (id) =>
      id === 'U1'
        ? { 'member.name': 'สมชาย' }
        : id === 'U2'
          ? { 'member.name': 'สมหญิง' }
          : null,
  };
  const card = { type: 'text', text: 'คุณ {{member.name}}' };

  it('renders for the one recipient in the chunk', () => {
    const b = new PersonalCardMessageBuilder(card, source);
    expect(b.messagesFor({ index: 0, to: ['U2'] }).messages).toEqual([
      { type: 'text', text: 'คุณ สมหญิง' },
    ]);
  });

  it('🔴 REFUSES a batch — it will not address many people with one person’s data', () => {
    /* If this ever returns a message, everyone in the chunk reads a stranger's
       name. The empty array makes the sink report a failed chunk, which is
       loud; guessing would be silent. ยอมให้ chunk ล้ม ดีกว่าส่งผิดคน. */
    const b = new PersonalCardMessageBuilder(card, source);
    expect(b.messagesFor({ index: 0, to: ['U1', 'U2'] }).messages).toEqual([]);
  });

  it('refuses a recipient it has no values for, rather than sending a blank card', () => {
    const b = new PersonalCardMessageBuilder(card, source);
    expect(b.messagesFor({ index: 0, to: ['U404'] }).messages).toEqual([]);
  });

  it('refuses an empty chunk', () => {
    const b = new PersonalCardMessageBuilder(card, source);
    expect(b.messagesFor({ index: 0, to: [] }).messages).toEqual([]);
  });
});

describe('🔴 the six an audit reproduced — red first, then the fix', () => {
  /* Every case below was measured against the code as it stood on 23/08. The
     comment on each says what it DID, not what it might do — a defect nobody
     can reproduce is a rumour. สามในหกทำให้ LINE ปฏิเสธทั้งข้อความ = ไม่มีใครได้รับอะไรเลย. */

  const built = (json: unknown) =>
    buildCardMessage({ type: 'flex', flex_json: json }, VARS);
  const flex = (json: unknown) => JSON.stringify(built(json).messages);

  it('🔴 D1 — a card that repairs down to NOTHING is refused, no Symbol rides', () => {
    /* MEASURED: `repairCard` answered the DROP Symbol for the root and the
       caller never looked. The wire got {"type":"flex","altText":"Broadcast
       message"} — `contents` held a Symbol, so JSON.stringify silently DROPPED
       the key. LINE 400, every recipient got nothing. The original converts a
       root drop to null for exactly this reason (flex-render.util.ts:357-359).
       สัญลักษณ์ DROP ห้ามหลุดออกไปถึงสาย. */
    const r = built({ type: 'box', layout: 'vertical', contents: [] });
    expect(r.messages).toEqual([]);
    expect(JSON.stringify(r.messages)).not.toContain('flex');
  });

  it('🔴 D1 — whatever the card, a flex message always carries real contents', () => {
    for (const json of [
      { type: 'box', layout: 'vertical', contents: [] },
      { type: 'carousel', contents: [] },
      { type: 'bubble', body: { type: 'box', contents: [] } },
      { type: 'bubble', body: { type: 'box', layout: 'vertical' } },
    ]) {
      for (const m of built(json).messages) {
        // A Symbol here is invisible to JSON.stringify — assert the TYPE, not
        // the serialised text, or the bug hides inside its own symptom.
        expect([json, typeof m['contents']]).toEqual([json, 'object']);
        expect([json, m['contents']]).not.toEqual([json, null]);
      }
    }
  });

  it('🔴 D2 — a bubble whose only body drops is refused, not shipped hollow', () => {
    /* MEASURED: wire {"contents":{"type":"bubble"}} — a bubble with no section
       at all. LINE 400. The key vanished because the object walk drops any key
       whose value dropped; nothing then asked whether the bubble still held
       anything. บับเบิลที่ไม่เหลือส่วนไหนเลย = ส่งไม่ได้. */
    expect(
      built({
        type: 'bubble',
        body: { type: 'box', layout: 'vertical', contents: [] },
      }).messages,
    ).toEqual([]);
  });

  it('🔴 D2 — one dead bubble in a carousel goes; the live one stays', () => {
    const out = flex({
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          body: { type: 'box', layout: 'vertical', contents: [] },
        },
        {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'text', text: 'ยังอยู่' }],
          },
        },
      ],
    });
    expect(out).toContain('ยังอยู่');
    expect(out).not.toContain('{"type":"bubble"}');
  });

  it('🔴 D3 — a box with NO contents key at all is removed too', () => {
    /* MEASURED: shipped as-is → LINE 400. The drop test required
       `Array.isArray(contents)`, so a box that never had the key skipped it.
       LINE requires `contents` on a box: missing is exactly as unsendable as
       empty. กล่องที่ไม่มี contents เลย ก็ส่งไม่ได้เหมือนกล่องว่าง. */
    expect(
      built({ type: 'bubble', body: { type: 'box', layout: 'vertical' } })
        .messages,
    ).toEqual([]);
  });

  it('🔴 D3 — nested, it vanishes and the text beside it stays', () => {
    const out = flex({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'box', layout: 'vertical' },
          { type: 'text', text: 'เหลืออยู่' },
        ],
      },
    });
    expect(out).toContain('เหลืออยู่');
    expect(out).not.toContain('{"type":"box","layout":"vertical"}');
  });

  it('🔴 D1 — a dropped child leaves no `null` hole where it stood', () => {
    /* A survivor caught this: with the array filter gone, the DROP Symbol
       stayed in `contents` and JSON.stringify turned it into `null` — the box
       was no longer empty, so nothing else complained, and LINE 400'd a
       `contents:[null, …]`. A Symbol leaks as a MISSING key, an array Symbol as
       a null; both are invisible in the text unless you look for them.
       ตัวที่ถูกตัดต้องหายไปเลย ไม่ใช่กลายเป็น null. */
    const out = flex({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'box', layout: 'vertical', contents: [] },
          { type: 'text', text: 'เหลืออยู่' },
        ],
      },
    });
    expect(out).toContain('"contents":[{"type":"text"');
    expect(out).not.toContain('null');
  });

  it('🔴 D4 — a picture that never shipped is not counted as repaired', () => {
    /* MEASURED: imagesReplaced = 2 when ZERO pictures were replaced. The count
       compared the before/after url lists BY INDEX, so one dropped node
       shortened the "after" list and every later pair read as a mismatch.
       That number is written into a history row people trust.
       ⚠️ The picture rides a key that is not `contents` — the only way a real
       picture disappears together with its parent, and precisely what shifts
       the index. The counter walks EVERY value, so it saw it. */
    const r = built({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'image', url: 'https://cdn.example.com/1.jpg' },
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
            background: {
              type: 'image',
              url: 'https://cdn.example.com/bg.jpg',
            },
          },
          { type: 'image', url: 'https://cdn.example.com/2.jpg' },
        ],
      },
    });
    expect(r.imagesReplaced).toBe(0);
  });

  it('🔴 D4 — a broken picture that DOES ship is still counted, once', () => {
    const r = built({
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'image', url: 'not a url' },
        { type: 'image', url: 'https://cdn.example.com/1.jpg' },
      ],
    });
    expect(r.imagesReplaced).toBe(1);
    expect(JSON.stringify(r.messages)).toContain(BROADCAST_FALLBACK_IMAGE_URL);
  });

  it('🔴 D4 — a broken picture inside a box that drops counts zero', () => {
    // It was never sent, so no history row may claim it was repaired.
    const r = built({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [],
            background: { type: 'image', url: 'not a url' },
          },
          { type: 'text', text: 'ยังอยู่' },
        ],
      },
    });
    expect(r.imagesReplaced).toBe(0);
  });

  it('🔴 D5 — ONE dash rule for both card paths: the admin typed it, it stays', () => {
    /* MEASURED: the FLEX path kept `-` (its docblock promises exactly that)
       while the TEXT path ran asText → isEmptyForBroadcast('-') → `N/A`.
       Two paths in one file, opposite rules. The var map already turned every
       "no value" marker into N/A BEFORE substitution, so a dash still here is
       content the admin typed — a divider, a minus sign. ขีดที่พิมพ์เอง = เนื้อหา. */
    expect(
      buildCardMessage({ type: 'text', text: '-' }, VARS).messages[0],
    ).toEqual({
      type: 'text',
      text: '-',
    });
    expect(flex({ type: 'text', text: '-' })).toContain('"text":"-"');
  });

  it('D5 — and what LINE truly refuses still becomes N/A on both paths', () => {
    for (const empty of ['', '   ']) {
      expect(
        buildCardMessage({ type: 'text', text: empty }, VARS).messages[0],
      ).toEqual({ type: 'text', text: BROADCAST_VAR_EMPTY });
      expect(flex({ type: 'text', text: empty })).toContain(
        `"text":"${BROADCAST_VAR_EMPTY}"`,
      );
    }
  });

  const NESTED_BRACES = [
    '{{ a } b }}',
    'hello {{x} }}',
    '{{ {tag} }}',
    '{{a{{b}}',
  ];

  it('🔴 D6 — a brace pair holding a brace is still swept', () => {
    /* MEASURED: all four delivered VERBATIM, and `isCardClean` answered true
       about them — `\{\{[^{}]*\}\}` cannot match a pair containing { or }.
       `{{a{{b}}` was worse: the tag pass ate `{{b}}` and left `{{aN/A`.
       ปีกกาซ้อนปีกกา = ด่านมองไม่เห็น แล้วบอกว่าสะอาด. */
    for (const text of NESTED_BRACES) {
      const s = JSON.stringify(
        buildCardMessage({ type: 'text', text }, VARS).messages,
      );
      expect([text, s.includes('{{')]).toEqual([text, false]);
      expect([text, s.includes('}}')]).toEqual([text, false]);
    }
  });

  it('🔴 D6 — the gate reports them instead of calling the card clean', () => {
    for (const text of NESTED_BRACES) {
      expect([text, isCardClean({ text })]).toEqual([text, false]);
      expect([text, findLeftoverTags({ text }).length > 0]).toEqual([
        text,
        true,
      ]);
    }
  });

  it('🔴 D6 — an opener with no closer is a leftover too, and is swept', () => {
    // `hi {{name` shipped braces while the gate reported clean.
    expect(findLeftoverTags({ text: 'hi {{name' })).toEqual(['name']);
    expect(
      JSON.stringify(
        buildCardMessage({ type: 'text', text: 'hi {{name' }, VARS).messages,
      ),
    ).not.toContain('{{');
  });

  it('D6 — a single brace is still not a tag (the sweep must not widen)', () => {
    const r = buildCardMessage({ type: 'text', text: 'ราคา {100} บาท' }, VARS);
    expect(r.messages[0]).toEqual({ type: 'text', text: 'ราคา {100} บาท' });
    expect(r.unknownTags).toEqual([]);
  });
});
