/**
 * [FEAT-20260908-AITRANSLATE] the two-layer bubble, the chip, and the picker.
 * ===========================================================================
 * Owner's rules, in the order they were given:
 *   • one bubble holds BOTH texts — never two bubbles
 *   • `content` on top (what the customer saw), the translation below (what the
 *     admin reads) — in BOTH directions, with no branch on `sender_type`
 *   • the pair reads `from → to`, straight off the row
 *   • translating changes a bubble's CONTENTS, never its side
 *   • picking a language IS the confirm — no second "apply" press
 *   • nothing translates by itself
 *
 * ⚠️ The chip's reveal is the case most likely to rot. `ChatRoomView` has exactly
 * two `.show()`/`.toggle()` call sites, and they used to be gated on `onReplyTo`
 * alone. A translate chip with its own `useTimedReveal` and nothing driving it
 * renders never — and a source-reading test would not notice, because the chip
 * and the hook would both be there. So it is proven by POINTING at a bubble.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* [TEMP-20260910-TRANSLATEDEVONLY] The chip is behind a temporary account lock,
   so a suite with nobody signed in would render no chip and every case below
   would fail for a reason that has nothing to do with what it asserts. Sign the
   allowed account in, exactly as the hook-form suites already do.
   When the lock is removed this mock can go with it — the cases do not need it
   for any other reason. See components/chat/translateDevLock.ts. */
vi.mock('../services/authStorage', async () => {
  const actual = await vi.importActual<any>('../services/authStorage');
  return { ...actual, getAuthUser: () => ({ username: 'dev' }) };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});

/** The seven the BE registry will serve; only the shape matters here. */
const REGISTRY = {
  key: 'translate_target_lang',
  choice_count: 2,
  options: [
    /* ⚠️ `fallback_label` is deliberately NOT the real wording. `fieldOptionLabel`
       must prefer the i18n entry this repo ships, and if the two strings were
       equal the test could not tell which one won — it would pass even with the
       i18n block deleted. ตั้งใจให้ต่างกัน เพื่อพิสูจน์ว่าใช้ตัวไหน. */
    { value: 'th', label_key: 'field_options.translate_target_lang.th', fallback_label: 'raw-th' },
    { value: 'en', label_key: 'field_options.translate_target_lang.en', fallback_label: 'raw-en' },
  ],
};

interface MountOpts {
  onTranslate?: (t: unknown) => void;
  onReplyTo?: (t: unknown) => void;
  /** what `GET /api/field-options/translate_target_lang` answers */
  registry?: () => Promise<unknown>;
}

const mountWith = async (messages: unknown[], opts: MountOpts = {}) => {
  const getSpy = vi.fn(opts.registry ?? (() => Promise.resolve(REGISTRY)));
  vi.doMock('../services/hook/fieldOptionsService', () => ({
    fieldOptionsService: { get: getSpy },
  }));
  vi.doMock('../services/chat', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../services/chat');
    return {
      ...actual,
      chatService: {
        ...(actual.chatService as Record<string, unknown>),
        listMessages: vi.fn().mockResolvedValue({
          data: [...messages].reverse(),
          pagination: { page: 1, pages: 1, total: messages.length },
        }),
      },
      useTicketWS: () => undefined,
    };
  });
  const { render, waitFor } = await import('@testing-library/react');
  const { ChatRoomView } = await import('../components/chat/ChatRoomView');
  /* 🔴 THE REAL PROVIDER, not the bare component. `I18nContext`'s DEFAULT value
     is `t: (key) => key`, so a component rendered without a provider makes
     `fieldOptionLabel` fall through to the server's `fallback_label` every
     single time — the i18n path would look fine and never once be executed.
     That is the "a fallback means the real route is never tested" trap. With
     the provider, the locale resolves to `th` and `th.json` must supply the
     wording. ต้องหุ้ม provider จริง ไม่งั้นเส้นทาง i18n ไม่เคยถูกเดินเลย. */
  const { I18nProvider } = await import('../i18n');
  const room = {
    _id: 'room1',
    line_user_id: 'U1',
    hook_id: 'hook1',
    user_data: { _id: 'm1', display_name: 'bbbb' },
    show_original_text: true,
    /* [FEAT-20260919-SHOWORIGSRC] `show_original_text: true` alone no longer
       shows anything — the boolean is only consulted when the room claims the
       decision. This suite is about the BUBBLE's two-layer layout, so the room
       is pinned to its own value to keep the original text on screen; the
       room-vs-account rule itself is covered in
       `showOriginalText.value.test.ts`. บูลีนอย่างเดียวไม่พอแล้ว ต้องบอกด้วยว่าห้องขอตัดสินเอง */
    show_original_text_source: 'room',
  } as never;
  const view = render(
    <I18nProvider>
      <ChatRoomView
        room={room}
        hookId="hook1"
        showDetailBox={false}
        memberId="m1"
        memberData={{ _id: 'm1' }}
        onTranslate={opts.onTranslate as never}
        onReplyTo={opts.onReplyTo as never}
      />
    </I18nProvider>,
  );
  await waitFor(() =>
    expect(view.container.querySelector('.tc-msg-in, .tc-msg-out, [data-testid]')).toBeTruthy(),
  );
  return { ...view, getSpy };
};

/** a customer message an admin translated INTO Thai after the fact */
const inboundTranslated = {
  _id: 'm-in',
  message_type: 'text',
  sender_type: 'customer',
  content: 'I want to withdraw money',
  internal_content_id: null,
  created_at: '2026-09-08T04:05:06.000Z',
  translations: [{ lang: 'th', text: 'ฉันต้องการถอนเงิน', from: 'en', to: 'th' }],
};

/** an admin message: `content` is what the customer received (English), the
 *  entry is the Thai the admin typed.
 *  🔴 [FIX-20260910-OUTBOUNDORDER] `to: null` — CORRECTED, and it was not a
 *     typo worth shrugging at: the BE's outbound builder says of itself
 *     *"`to` is null ALWAYS"* (`translation-store.ts`), because the send request
 *     carries the original and never the language `content` ended up in. This
 *     fixture used to say `to: 'en'`, i.e. a row shaped like one the server
 *     cannot produce — so the case passed on data that does not exist, and the
 *     null is now exactly what marks the direction. */
const outboundTranslated = {
  _id: 'm-out',
  message_type: 'text',
  sender_type: 'bot',
  content: 'Please wait a moment',
  internal_content_id: null,
  created_at: '2026-09-08T04:06:07.000Z',
  translations: [{ lang: 'th', text: 'รอสักครู่นะคะ', from: 'th', to: null }],
};

const plain = {
  _id: 'm-plain',
  message_type: 'text',
  sender_type: 'customer',
  content: 'ผมอยากถอนเงิน',
  internal_content_id: null,
  created_at: '2026-09-08T04:05:06.000Z',
};

describe('[AITRANSLATE] the two-layer bubble', () => {
  it('⭐⭐⭐ ONE bubble holds both texts — not two bubbles', async () => {
    const { container } = await mountWith([inboundTranslated], { onTranslate: vi.fn() });
    /* the load-bearing assertion: exactly one bubble element exists, and both
       strings are inside it. Rendering a second bubble would still put both
       texts on screen — only the count catches that. */
    const bubbles = container.querySelectorAll('.tc-msg-in, .tc-msg-out');
    expect(bubbles.length).toBe(1);
    const bubble = bubbles[0] as HTMLElement;
    expect(bubble.textContent).toContain('I want to withdraw money');
    expect(bubble.textContent).toContain('ฉันต้องการถอนเงิน');
    // the divider is INSIDE the bubble, never a gap between two cards
    expect(bubble.querySelector('.border-t')).toBeTruthy();
  });

  it('⭐⭐⭐ `content` is the TOP line and the translation the BOTTOM — inbound', async () => {
    const { container } = await mountWith([inboundTranslated], { onTranslate: vi.fn() });
    const bubble = container.querySelector('.tc-msg-in') as HTMLElement;
    const top = bubble.textContent!.indexOf('I want to withdraw money');
    const bottom = bubble.textContent!.indexOf('ฉันต้องการถอนเงิน');
    expect(top).toBeGreaterThan(-1);
    expect(bottom).toBeGreaterThan(top);
  });

  it('⭐⭐⭐ …and OUTBOUND puts the admin\'s own words on top — still no sender_type branch', async () => {
    /* [FIX-20260910-OUTBOUNDORDER] owner, 10/09: *"ฝั่งแอดมินให้สลับตำแหน่งกัน
       บนลงมาล่าง"*. The bottom line is the large, full-contrast one, so it must
       carry what the reader needs: on a customer's message that is the
       translation the admin can read; on the admin's own it is what the CUSTOMER
       actually received. Leading with a language the admin cannot read and
       burying the sentence they typed was the wrong way up.
       ⚠️ Still derived from the entry (`to === null`), never from `sender_type` —
          one answer to the direction question, not two. */
    const { container } = await mountWith([outboundTranslated], { onTranslate: vi.fn() });
    const bubble = container.querySelector('.tc-msg-out') as HTMLElement;
    const typed = bubble.textContent!.indexOf('รอสักครู่นะคะ');      // what the admin wrote
    const sent = bubble.textContent!.indexOf('Please wait a moment'); // what the customer got
    expect(typed).toBeGreaterThan(-1);
    expect(sent).toBeGreaterThan(typed);
  });

  it('⭐⭐⭐ [OUTBOUNDTARGET] a NEW outbound row names both ends, and keeps the admin\'s words on top', async () => {
    /* From today an admin send carries the language it was translated into, so
       the entry is `{lang: from, to: target}` — a shape that did not exist
       before. The direction must still come out right: `lang !== to`. */
    const row = {
      ...outboundTranslated,
      _id: 'm-out2',
      content: '早安',
      translations: [{ lang: 'en', text: 'good morning', from: 'en', to: 'zh-Hant' }],
    };
    const { container } = await mountWith([row], { onTranslate: vi.fn() });
    const bubble = container.querySelector('.tc-msg-out') as HTMLElement;
    const typed = bubble.textContent!.indexOf('good morning');
    const sent = bubble.textContent!.indexOf('早安');
    expect(typed).toBeGreaterThan(-1);
    expect(sent).toBeGreaterThan(typed);
    expect(bubble.textContent).toContain('อังกฤษ → จีนตัวเต็ม');
  });

  it('⭐⭐⭐ [OUTBOUNDTARGET] a LEGACY row with neither end renders no label row at all', async () => {
    /* 🔴 No backfill (owner, 10/09), so rows with `{lang: null, to: null}` are
       permanent. An empty label div left a gap under the translation on exactly
       those bubbles and nowhere else — the kind of difference nobody can explain
       later. Nothing known ⇒ nothing rendered. */
    const row = {
      ...outboundTranslated,
      _id: 'm-out3',
      translations: [{ lang: null, text: 'รอสักครู่นะคะ', from: null, to: null }],
    };
    const { container } = await mountWith([row], { onTranslate: vi.fn() });
    const bubble = container.querySelector('.tc-msg-out') as HTMLElement;
    /* both texts still there, admin's own on top */
    expect(bubble.textContent).toContain('รอสักครู่นะคะ');
    expect(bubble.textContent).toContain('Please wait a moment');
    /* …and no orphan label element */
    expect(bubble.querySelector('.text-right')).toBeNull();
  });

  /* [FIX-20260910-WIREICON] Owner, 10/09: ✉ in front of the customer's message,
     ➤ after the admin's — and *"เฉพาะ bubble ที่มีการแปลภาษา"*. Both marks point
     at the same field, `content`: the top line inbound, the bottom line
     outbound. Three cases, one per mount — RTL keeps one container per render
     and a second render inside the same case cannot be read from the first. */
  it('⭐⭐⭐ [WIREICON] a customer bubble is marked ✉, never ➤', async () => {
    const { container } = await mountWith([inboundTranslated], { onTranslate: vi.fn() });
    const bubble = container.querySelector('.tc-msg-in') as HTMLElement;
    expect(bubble.querySelector('svg.lucide-mail')).toBeTruthy();
    expect(bubble.querySelector('svg.lucide-send')).toBeNull();
  });

  it('⭐⭐⭐ [WIREICON] an admin bubble is marked ➤, never ✉', async () => {
    const { container } = await mountWith([outboundTranslated], { onTranslate: vi.fn() });
    const bubble = container.querySelector('.tc-msg-out') as HTMLElement;
    expect(bubble.querySelector('svg.lucide-send')).toBeTruthy();
    expect(bubble.querySelector('svg.lucide-mail')).toBeNull();
  });

  it('⭐⭐⭐ [WIREICON] an UNtranslated bubble carries neither', async () => {
    /* It never reaches this component at all — `chatBubbleCharacterization` pins
       its markup byte-for-byte. Asserted here too because "only translated
       bubbles" is the owner's rule, not a side-effect to be discovered later. */
    const { container } = await mountWith([plain], { onTranslate: vi.fn() });
    const bubble = container.querySelector('.tc-msg-in') as HTMLElement;
    expect(bubble.querySelector('svg.lucide-mail')).toBeNull();
    expect(bubble.querySelector('svg.lucide-send')).toBeNull();
  });

  it('⭐⭐ the pair renders as `from → to`, in that order', async () => {
    const { container } = await mountWith([inboundTranslated], { onTranslate: vi.fn() });
    const bubble = container.querySelector('.tc-msg-in') as HTMLElement;
    /* [FIX-20260909-LANGNAME] NAMES, not codes. The corner used to print `en →
       th`; an admin seeing `my` had to know that is Burmese. Resolved from i18n
       with no request — see `TranslatedBubble`'s note on why not the hook. */
    expect(bubble.textContent).toContain('อังกฤษ → ไทย');
    expect(bubble.textContent).not.toContain('th → en'); // reversed = wrong
  });

  it('⭐⭐ the bubble SIDE is unchanged when a translation exists', async () => {
    /* translating changes a bubble's contents, never its alignment. A customer
       bubble stays left (`tc-msg-in`, no `items-end` on its row). */
    const { container } = await mountWith([inboundTranslated], { onTranslate: vi.fn() });
    expect(container.querySelector('.tc-msg-in')).toBeTruthy();
    expect(container.querySelector('.tc-msg-out')).toBeNull();
    const row = container.querySelector('#msg-m-in') as HTMLElement;
    expect(row.className).not.toContain('justify-end');
  });

  it('⭐⭐ a message with no translations renders only its own text', async () => {
    const { container } = await mountWith([plain], { onTranslate: vi.fn() });
    const bubble = container.querySelector('.tc-msg-in') as HTMLElement;
    expect(bubble.textContent).toBe('ผมอยากถอนเงิน');
    expect(bubble.querySelector('.border-t')).toBeNull();
  });
});

describe('[AITRANSLATE] the chip — and the reveal that has to drive it', () => {
  it('⭐⭐⭐ pointing at a bubble reveals the chip directly when ONLY `onTranslate` is passed', async () => {
    const { container } = await mountWith([plain], { onTranslate: vi.fn() });
    const { fireEvent } = await import('@testing-library/react');
    const bubble = container.querySelector('.tc-msg-in') as HTMLElement;
    expect(container.querySelector('[aria-label="แปลข้อความนี้"]')).toBeNull(); // nothing before
    fireEvent.mouseEnter(bubble.parentElement!);
    /* [FIX-20260918-NODOTS] one gesture, not two. The `··` button that stood
       between the hover and the chip is gone (owner, 18/09) — pointing at a
       bubble now shows แปล straight away. ชี้แล้วเห็นเลย ไม่ต้องกด .. ก่อน */
    expect(container.querySelector('[aria-label="แปลข้อความนี้"]')).toBeTruthy();
  });

  it('⭐⭐ no chip at all when the page passes no `onTranslate`', async () => {
    const { container } = await mountWith([plain]);
    const { fireEvent } = await import('@testing-library/react');
    const bubble = container.querySelector('.tc-msg-in') as HTMLElement;
    fireEvent.mouseEnter(bubble.parentElement!);
    expect(container.querySelector('[aria-label="แปลข้อความนี้"]')).toBeNull();
    expect(container.querySelector('[aria-label="แปลข้อความนี้"]')).toBeNull();
  });

  it('⭐⭐ the reply chip still works on its own, untouched', async () => {
    /* the gate widened to "either prop"; a page that passes only `onReplyTo`
       must behave exactly as it did before this feature existed. */
    const { container } = await mountWith([plain], { onReplyTo: vi.fn() });
    const { fireEvent } = await import('@testing-library/react');
    const bubble = container.querySelector('.tc-msg-in') as HTMLElement;
    fireEvent.mouseEnter(bubble.parentElement!);
    expect(container.querySelector('[aria-label="ตอบกลับข้อความนี้"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="แปลข้อความนี้"]')).toBeNull();
  });

  it('⭐⭐ the chip is for TEXT only — the same restriction the BE enforces', async () => {
    const { container } = await mountWith(
      [{ ...plain, _id: 'm-img', message_type: 'image', content: 'https://x.test/a.png' }],
      { onTranslate: vi.fn() },
    );
    const { fireEvent } = await import('@testing-library/react');
    const row = container.querySelector('#msg-m-img') as HTMLElement;
    fireEvent.mouseEnter(row.querySelector('.max-w-\\[75\\%\\]') as HTMLElement);
    expect(container.querySelector('[aria-label="แปลข้อความนี้"]')).toBeNull();
    expect(container.querySelector('[aria-label="แปลข้อความนี้"]')).toBeNull();
  });
});

describe('[AITRANSLATE] the picker — the BE owns the list, this side owns the words', () => {
  it('⭐⭐⭐ picking a language IS the confirm — it calls onTranslate immediately', async () => {
    const onTranslate = vi.fn();
    const { container, findByText } = await mountWith([plain], { onTranslate });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.mouseEnter((container.querySelector('.tc-msg-in') as HTMLElement).parentElement!);
    fireEvent.click(container.querySelector('[aria-label="แปลข้อความนี้"]')!);
    /* the label comes from this repo's i18n via `fieldOptionLabel` — NOT from the
       server's `fallback_label`, and not from the raw code. The test locale is
       the default (`en`), so `en.json` is what must supply it. */
    /* [FIX-20260909-BUBBLETHAIONLY] Thai is the only choice on this side now —
       owner, 09/09. Reading a customer's message means reading it in the
       admin's own language; the other six were a menu of answers to a question
       nobody asked, and each one is a billed call. */
    await findByText('ไทย');
    expect(onTranslate).not.toHaveBeenCalled();
    fireEvent.click(await findByText('ไทย'));
    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(onTranslate).toHaveBeenCalledWith({ id: 'm-plain', text: 'ผมอยากถอนเงิน', lang: 'th' });
  });

  it('⭐⭐⭐ a 404 from the registry renders NOTHING — no hardcoded fallback list', async () => {
    const { container } = await mountWith([plain], {
      onTranslate: vi.fn(),
      registry: () => Promise.reject(new Error('404 no options for translate_target_lang')),
    });
    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.mouseEnter((container.querySelector('.tc-msg-in') as HTMLElement).parentElement!);
    fireEvent.click(container.querySelector('[aria-label="แปลข้อความนี้"]')!);
    await waitFor(() => expect(container.querySelector('[role="listbox"]')).toBeNull());
    /* still nothing on screen before the press — the assertion this case is
       really about. `ไทย` is the entry the list would show if it were open. */
    expect(container.textContent).not.toContain('ไทย');
    expect(container.textContent).not.toContain('raw-en');
  });

  it('⭐⭐ the picker lists exactly what the registry returned, nothing more', async () => {
    const { container, findByText } = await mountWith([plain], { onTranslate: vi.fn() });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.mouseEnter((container.querySelector('.tc-msg-in') as HTMLElement).parentElement!);
    fireEvent.click(container.querySelector('[aria-label="แปลข้อความนี้"]')!);
    await findByText('ไทย');
    /* [FIX-20260909-PICKERPORTAL] `document`, not `container`. The picker
       renders through a PORTAL now — it had to, because mounted inside the
       message row a click on its backdrop bubbled up to that row's handler and
       closed it, which looked exactly like an outside-click dismissal that had
       already been removed. A portal puts it outside the row's subtree, and
       outside this render's container with it. */
    const list = document.querySelector('[role="listbox"]') as HTMLElement;
    /* ⭐ ONE, not two: the registry still returns both and the BE still accepts
       both — `only={['th']}` narrows what THIS caller offers. The filter is a
       menu decision, not a registry one, which is why the fixture below is left
       carrying two entries. */
    expect(list.querySelectorAll('[role="option"]').length).toBe(1);
    // the five other languages the registry did NOT send must not appear, even
    // though this repo ships a label for every one of them
    expect(list.textContent).not.toContain('พม่า');
  });
});

describe('[AITRANSLATE] ⭐⭐⭐ nothing translates by itself', () => {
  it('⭐⭐⭐ opening a room fires ZERO translate work and ZERO registry requests', async () => {
    /* Every press is a billed vendor call against a LIFETIME budget that never
       resets. Anything automatic turns a per-press cost into a per-message cost,
       which is the owner's stated reason the feature is opt-in at all.
       เปิดห้องเฉย ๆ ต้องไม่ยิงอะไรเลย. */
    const onTranslate = vi.fn();
    const { getSpy } = await mountWith([plain, inboundTranslated], { onTranslate });
    expect(onTranslate).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('⭐⭐ merely revealing the chip still fires nothing', async () => {
    const onTranslate = vi.fn();
    const { container, getSpy } = await mountWith([plain], { onTranslate });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.mouseEnter((container.querySelector('.tc-msg-in') as HTMLElement).parentElement!);
    expect(container.querySelector('[aria-label="แปลข้อความนี้"]')).toBeTruthy();
    expect(onTranslate).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled(); // the list is fetched on OPEN, not on hover
  });
});
