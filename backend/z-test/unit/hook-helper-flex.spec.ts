import { buildHookHelperFlex } from '@/modules/webhook/hook-reply/hook-helper-flex';
import type { HookHelperFlexDeps } from '@/modules/webhook/hook-reply/hook-helper-flex';

/**
 * [FEAT-20260812-HOOKHELPERFLEX] hook-field replies send the customer-helper CARD.
 *
 * Owner, 2026-08-12: *"ทำให้มันโหลด flex_customerhelper_id และ mint ปุ่มเหมือน ai"* —
 * a field like `missing_api_data_text` set to `[[[customer-helper]]]` must answer with
 * the same card the AI path sends, bound card and minted button included.
 *
 * ⚠️ THE PROPERTY THAT MATTERS MOST is that `null` is the safe answer. `null` means
 * "the caller sends its plain text", i.e. exactly today's behaviour. Every failure —
 * mint throwing, the card missing, the DB read rejecting — must land on `null` rather
 * than propagate, because this sits on the reply path of a customer who is already
 * waiting after something upstream failed. Several cases below exist only to keep that
 * direction from being flipped.
 */

const HOOK = {
  _id: 'hook1',
  group: 'g1',
  customer_link_landing_url: 'https://liff.line.me/abc',
  flex_customerhelper_id: 'card1',
};

/** A bound card that passes all three permission layers. */
const VALID_CARD = {
  flex_type: 'customerhelper',
  group_ids: ['g1'],
  content_json: {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text: 'bound card' }],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          action: { type: 'uri', label: 'connect', uri: '{{cus_land_url}}' },
        },
      ],
    },
  },
};

const deps = (over: Partial<HookHelperFlexDeps> = {}): HookHelperFlexDeps => ({
  mintLinkToken: () => 'tok123',
  findFlexById: () => Promise.resolve(VALID_CARD),
  ...over,
});

const call = (
  over: Partial<Parameters<typeof buildHookHelperFlex>[0]> = {},
  d: HookHelperFlexDeps = deps(),
) =>
  buildHookHelperFlex(
    {
      rawText: '[[[customer-helper]]]',
      hook: HOOK,
      channelUserId: 'U1',
      mode: 'flex',
      ...over,
    },
    d,
  );

describe('[FEAT-20260812-HOOKHELPERFLEX] when a card is built', () => {
  it("mode 'flex' + the marker ⇒ builds the bound card", async () => {
    const card = await call();

    expect(card).not.toBeNull();
    // The BOUND card was used, not the hard-coded fallback.
    expect(JSON.stringify(card)).toContain('bound card');
  });

  it('the minted token reaches the button — this is the "เหมือน ai" part', async () => {
    const card = await call();

    /* The mint must actually land in the button's uri. Asserting the token itself
       rather than "some url" is what catches a mint that was built and then dropped —
       a bug this repo already had once ([FIX-20260810-HELPERURIFILL]). */
    expect(JSON.stringify(card)).toContain('tok123');
    expect(JSON.stringify(card)).not.toContain('{{cus_land_url}}');
  });

  it('is given the hook id and LINE user id to mint with', async () => {
    const seen: unknown[] = [];
    await call(
      {},
      deps({
        mintLinkToken: (i) => {
          seen.push(i);
          return 'tok123';
        },
      }),
    );

    expect(seen[0]).toMatchObject({
      hookId: 'hook1',
      channelUserId: 'U1',
      channelType: 'line',
    });
  });
});

describe('[FEAT-20260812-HOOKHELPERFLEX] when it must NOT build a card', () => {
  /* [FIX-20260901-OFFMENUTAG] `'off'` was REMOVED from this list on 01/09.
   *
   * It used to sit here because `off` meant "the untouched path". It no longer
   * does: `off` is now the only mode anyone runs — the dashboard has no control
   * for the column (four i18n labels, zero rendered inputs), so `off` can only
   * mean "never configured" — and a customer who meets `[[[customer-helper]]]`
   * must see the CARD. Its new behaviour is pinned in the describe below.
   *
   * `strip` and `button` stay here ON PURPOSE, and that is the point of naming
   * modes rather than inverting the check: both are settings an operator had to
   * reach an API to write, and they mean "text only" and "text plus the quick
   * reply". Sending a card would overrule a deliberate decision.
   *
   * `'FLEX'`, `'on'` and `''` are junk values guarding this function's own
   * boundary. In production `resolveHookTextReplyMode` folds anything
   * unrecognised to `'off'` before it gets here, so they cannot arrive — but a
   * second caller must not be able to switch a card on with a typo. */
  it.each(['strip', 'button', 'FLEX', 'on', ''])(
    "mode '%s' ⇒ null (text path unchanged)",
    async (mode) => {
      await expect(call({ mode })).resolves.toBeNull();
    },
  );

  it('no marker in the field ⇒ null, the operator wrote ordinary copy', async () => {
    await expect(call({ rawText: 'ยังไม่พบข้อมูลค่ะ' })).resolves.toBeNull();
    await expect(call({ rawText: '' })).resolves.toBeNull();
    await expect(call({ rawText: null })).resolves.toBeNull();
  });

  /* Replaces "never calls the DB or the mint when the mode is off". That case
     asserted the OLD contract and had to be inverted, not deleted — the property
     it protected is still worth holding, just for the modes that still have it. */
  it('⭐⭐ strip and button still never reach the DB or the mint', async () => {
    const boom = () => {
      throw new Error('must not be called');
    };

    for (const mode of ['strip', 'button']) {
      await expect(
        call({ mode }, deps({ mintLinkToken: boom, findFlexById: boom })),
      ).resolves.toBeNull();
    }
  });

  /* 🔴 The inversion itself, stated as its own case so the change is visible in
     the test names and not only in a diff. A marker is an instruction to this
     system that only this system can carry out; passing it through verbatim was
     never "untouched", it was a failure to act on it. */
  it('🔴 mode off DOES build the card now — the marker is the opt-in', async () => {
    await expect(call({ mode: 'off' })).resolves.not.toBeNull();
  });

  it('⭐⭐ off with NO marker is still null — the guard that matters most', async () => {
    await expect(
      call({ mode: 'off', rawText: 'ยังไม่พบข้อมูลค่ะ' }),
    ).resolves.toBeNull();
  });
});

describe('[FEAT-20260812-HOOKHELPERFLEX] fail-safe — a failure must never throw', () => {
  it('mint throws ⇒ still returns a card (button falls back), never rejects', async () => {
    const card = await call(
      {},
      deps({
        mintLinkToken: () => {
          throw new Error('mint down');
        },
      }),
    );

    /* A dead mint must not cost the customer the card — the fallback URI is
       deliberately visible so a misconfiguration is noticed. */
    expect(card).not.toBeNull();
    expect(JSON.stringify(card)).not.toContain('tok123');
  });

  it('mint returns null ⇒ still a card', async () => {
    await expect(
      call({}, deps({ mintLinkToken: () => null })),
    ).resolves.not.toBeNull();
  });

  it('the flex lookup rejects ⇒ falls back to the hard-coded card, never rejects', async () => {
    const card = await call(
      {},
      deps({ findFlexById: () => Promise.reject(new Error('db down')) }),
    );

    expect(card).not.toBeNull();
    expect(JSON.stringify(card)).not.toContain('bound card');
  });

  it('the bound card is missing ⇒ hard-coded card', async () => {
    const card = await call(
      {},
      deps({ findFlexById: () => Promise.resolve(null) }),
    );

    expect(card).not.toBeNull();
    expect(JSON.stringify(card)).not.toContain('bound card');
  });

  /**
   * ⭐ The permission gate. A card bound from another group must never be sent —
   * that would leak one OA's card to another OA's customer.
   */
  it("a card from ANOTHER GROUP is refused ⇒ hard-coded card, not the other OA's", async () => {
    const card = await call(
      {},
      deps({
        findFlexById: () =>
          Promise.resolve({ ...VALID_CARD, group_ids: ['SOMEONE-ELSE'] }),
      }),
    );

    expect(JSON.stringify(card)).not.toContain('bound card');
  });

  it('a card of the WRONG TYPE is refused', async () => {
    const card = await call(
      {},
      deps({
        findFlexById: () =>
          Promise.resolve({ ...VALID_CARD, flex_type: 'slip' }),
      }),
    );

    expect(JSON.stringify(card)).not.toContain('bound card');
  });

  it('a DELETED card is refused', async () => {
    const card = await call(
      {},
      deps({
        findFlexById: () =>
          Promise.resolve({ ...VALID_CARD, deleted_at: new Date() }),
      }),
    );

    expect(JSON.stringify(card)).not.toContain('bound card');
  });

  it('no hook at all ⇒ does not throw', async () => {
    await expect(call({ hook: null })).resolves.not.toThrow;
  });
});
