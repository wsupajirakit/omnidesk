/**
 * [FEAT-20260905-CUSTPROV] The acceptance test for "easy to switch provider".
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §39 — *"a spec registers a fake provider whose `buildView`
 *          returns two sections … and asserts the panel renders those two
 *          sections and nothing else — WITHOUT a single FE file being added by
 *          that test. If the test needs an FE change, the design failed."*
 *
 * ## What is actually being proven
 * Not that a renderer works — `test/profilePanelView.dom.test.tsx` does that.
 * This proves the WIRING: that a section from a provider the dashboard has
 * never heard of travels from the profile payload, through the panel, onto the
 * screen. Every other test in this pair could pass while the panel silently
 * dropped everything it did not recognise, and nobody would find out until a
 * vendor was being onboarded.
 *
 * 🔴 NOT ONE FILE WAS ADDED TO MAKE THIS PASS. The fixture below invents card
 * ids, labels and values that appear nowhere in this repo. If a future change
 * makes a new provider require an FE edit, this test is where that shows up.
 * เจ้าใหม่ต้องขึ้นจอได้โดยไม่แตะ FE เลย — ถ้าต้องแตะ แปลว่าดีไซน์พัง
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

/* ── the envelope the REAL panel will be handed ───────────────────────────── */
const envelope: { value: unknown } = { value: null };

/* Stubs copied in shape from `personalPanelCards.dom.test.tsx` — everything the
   panel reaches for that is not the profile envelope. */
vi.mock('../services/chat', async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>('../services/chat');
  return {
    ...actual,
    ticketService: {
      getRawProfile: () => Promise.resolve(envelope.value),
      refreshRawProfile: () => Promise.resolve(envelope.value),
      clearRawProfile: () => Promise.resolve({ success: true }),
      getHookSiteRules: () => Promise.resolve(null),
      refreshHookSiteRules: () => Promise.resolve(null),
      getLinkCapabilities: () => Promise.resolve({}),
      getAdminLinkUrl: () => Promise.resolve({}),
      adminUnlinkCustomer: () => Promise.resolve({}),
      patchDetail: () => Promise.resolve({}),
    },
    dictLookup: (s: string) => s,
    loadTranslationDict: () => Promise.resolve(),
    subscribeDict: () => () => {},
  };
});
vi.mock('../services/finance', () => ({
  bankService: {
    getDirectory: () => Promise.resolve([]),
    logoUrl: () => '',
    lookup: () => null,
  },
}));
vi.mock('../services/authStorage', () => ({
  getStoredAuth: () => ({ user: { role: { name: 'admin' } }, token: 't' }),
}));
vi.mock('../pages/chat/chatOpenedRefresh', () => ({
  profileRefreshPlan: () => ({ shouldFetch: true }),
  useChatOpenedRefresh: () => {},
}));

import { I18nProvider } from '../i18n';
import { PersonalPanelNarrow } from '../components/profile-panel';
import { ProfilePanelView } from '../components/profile-panel/renderers';
import {
  PANEL_OWNED_SECTION_IDS,
  unownedSections,
} from '../components/profile-panel/renderers/panelOwned';
import type { Section } from '../components/profile-panel/renderers/types';

/** A provider that is not `shopapi_v1` and shares none of its vocabulary. */
const PROVIDER_B: Section[] = [
  {
    id: 'wallet',
    type: 'kv',
    label: 'กระเป๋าเงิน',
    rows: [
      { label: 'ยอดพร้อมใช้', value: 1234.5 },
      { label: 'ล็อกไว้', value: 0 },
    ],
  },
  {
    id: 'vip_desk',
    type: 'list',
    label: 'ผู้ดูแล VIP',
    items: [{ label: 'คุณเอ', secondary: 'กะเช้า', value: 3 }],
  },
];

const view = (sections: Section[]) => ({ sections });

describe('[CUSTPROV/§39] a provider the dashboard has never seen still draws', () => {
  it('⭐ both of provider B’s cards reach the screen', () => {
    render(<ProfilePanelView view={view(PROVIDER_B)} />);
    expect(screen.getByText('กระเป๋าเงิน')).toBeTruthy();
    expect(screen.getByText('ผู้ดูแล VIP')).toBeTruthy();
  });

  it('⭐ and their VALUES do, not just their titles', () => {
    // A card that renders its header and swallows its contents looks fine in a
    // screenshot and is useless to the person reading it.
    render(<ProfilePanelView view={view(PROVIDER_B)} />);
    expect(screen.getByText('ยอดพร้อมใช้')).toBeTruthy();
    expect(screen.getByText('คุณเอ')).toBeTruthy();
  });

  it('⭐ a zero is drawn, not swallowed as "empty"', () => {
    /* `ล็อกไว้: 0` is an answer. The `??`-not-`||` rule that protects it lives on
       the back end; this is the screen end of the same rule, because a truthy
       check anywhere in the chain blanks it. */
    render(<ProfilePanelView view={view(PROVIDER_B)} />);
    expect(screen.getByText('ล็อกไว้')).toBeTruthy();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('⭐ an unknown TYPE is visible and labelled, never a blank space', () => {
    // PART 7 §40: the dashboard degrades, it does not disappear. A provider may
    // ship a type before the dashboard has its renderer.
    render(
      <ProfilePanelView
        view={view([
          { id: 'timeline', type: 'gantt' as never, label: 'ไทม์ไลน์' },
        ])}
      />,
    );
    /* TWICE, and that is deliberate: once as the card's title and once inside
       the fallback body, which self-labels so it stays readable when it is
       rendered as a TAB and the card title belongs to the group instead. A
       fallback that relied on its host for a name would be an unlabelled amber
       box on exactly the screens where the name matters most. */
    expect(screen.getAllByText('ไทม์ไลน์').length).toBe(2);
    const box = screen.getByTestId('unknown-section-timeline');
    expect(box).toBeTruthy();
    // It says WHICH type it could not draw — otherwise the report is "a card is
    // missing", and someone spends an hour in the network tab.
    expect(box.textContent).toContain('gantt');
  });
});

describe('[CUSTPROV/§39] the split between hand-built cards and generic ones', () => {
  it('⭐ today’s eight sections are ALL panel-owned — the screen is unchanged', () => {
    /* The reason this mount adds nothing to the current screen, asserted rather
       than asserted-in-a-comment. If a future edit drops an id from the owned
       list, that section starts rendering TWICE — once from its hand-built card
       and once here — and this case is what catches it. */
    const todays: Section[] = PANEL_OWNED_SECTION_IDS.map((id) => ({
      id,
      type: 'kv',
      label: id,
    }));
    expect(unownedSections(todays)).toEqual([]);
  });

  it('⭐ provider B’s sections are NOT owned, so the generic path gets them', () => {
    expect(unownedSections(PROVIDER_B).map((s) => s.id)).toEqual([
      'wallet',
      'vip_desk',
    ]);
  });

  it('⭐ a new tab inside an OWNED group is left to that group’s card', () => {
    /* Rendering it would draw a SECOND "การเงิน" card holding one lonely tab
       beside the real one. A visible gap is better than a duplicate card that
       looks deliberate. */
    const mixed: Section[] = [
      { id: 'finance.deposits', type: 'amount_rows', label: 'ฝาก', group: 'finance' },
      { id: 'finance.savings', type: 'amount_rows', label: 'ออม', group: 'finance' },
    ];
    expect(unownedSections(mixed)).toEqual([]);
  });

  it('⭐ but a group with NO owned member is drawn whole', () => {
    const fresh: Section[] = [
      { id: 'loyalty.points', type: 'kv', label: 'แต้ม', group: 'loyalty' },
      { id: 'loyalty.tier', type: 'kv', label: 'ระดับ', group: 'loyalty' },
    ];
    expect(unownedSections(fresh).map((s) => s.id)).toEqual([
      'loyalty.points',
      'loyalty.tier',
    ]);
  });

  it('⭐ the mount really exists — the REAL panel draws provider B’s card', async () => {
    /* 🔴 ADDED AFTER A MUTATION SURVIVED. Replacing the `<ProfilePanelView>`
       mount in `ProfilePanel.tsx` with `{null}` left every test green, because
       every other case in this file renders the host DIRECTLY and the panel's
       own characterization runs on `shopapi_v1`, whose sections are all
       panel-owned. So nothing was proving that the panel is WIRED at all — the
       exact failure this whole design fears: discovering the fallback path was
       never connected while a vendor is being onboarded.
       This case mounts the real `PersonalPanelNarrow` and hands it an envelope
       from a provider it has never seen. ต่อสายไว้แล้วต้องพิสูจน์ว่าต่อจริง */
    envelope.value = {
      success: true,
      customer_provider: 'provider_b',
      data: { profile: {} },
      view: { sections: PROVIDER_B },
    };
    render(
      <I18nProvider>
        <PersonalPanelNarrow
          /* ⚠️ THE SHAPE THE PANEL ACTUALLY READS, taken from the working
             harness in `personalPanelCards.dom.test.tsx` rather than guessed.
             The first attempt passed `{ _id, line_user_id }`, which looks
             reasonable and gives the panel no member to fetch — it rendered
             nothing and the failure read like a broken mount. */
          source={
            {
              line_user_data: { _id: 'a0d00000000000000000002b' },
              line_oa_hook_id: 'h1',
            } as never
          }
          room={null}
        />
      </I18nProvider>,
    );
    // The cards ship collapsed, so wait for the TITLE, which is in the header.
    await waitFor(() => expect(screen.getAllByText('กระเป๋าเงิน').length).toBe(1));
    expect(screen.getByText('ผู้ดูแล VIP')).toBeTruthy();
    /* The CONTENT, not just the header — a card that draws its title and
       swallows its rows looks fine in a screenshot and tells an operator
       nothing.
       ⚠️ NO CLICK HERE, unlike `personalPanelCards.dom.test.tsx`. That harness
       clicks every `h3` because the eight hand-built cards ship
       `defaultOpen={false}`. A provider section carries `collapsed` only if it
       asks for it, and provider B does not, so its card arrives OPEN — clicking
       would CLOSE it, and the failure reads exactly like a card that never
       rendered. Half an hour of the wrong diagnosis lives in this comment. */
    expect(screen.getByText('ยอดพร้อมใช้')).toBeTruthy();
    expect(screen.getByText('คุณเอ')).toBeTruthy();
  });

  /**
   * ⭐⭐⭐ [FEAT-20260905-CUSTPROV] A PROVIDER MAY OMIT A ROW, AND THE CARD MUST
   * LOSE THAT ROW — NOT READ ITS NEIGHBOUR'S.
   *
   * 🔴 ADDED AFTER A MUTATION SURVIVED. Making the key lookup in
   * `renderers/sectionValues.ts` fall back to `rows[0]` when the key is absent
   * left `personalPanelCards.dom.test.tsx` fully green, because `shopapi_v1` fills
   * every key in every one of its fixtures — so nothing there could tell a
   * lookup BY KEY from a lookup BY POSITION. That is the exact defect
   * `view.types.ts`'s `Keyed` note warns about, and it would have surfaced on
   * the day a vendor omitted one row: the ยอดฝากรวม would have been printed in
   * the เครดิตคงเหลือ cell, with nothing erroring and nothing looking wrong.
   *
   * ⚠️ THIS FIXTURE IS DELIBERATELY NOT `shopapi_v1`'s. It cannot be — that builder
   * emits all three finance rows unconditionally, so its output can never
   * express "the key is missing". This is the same thing the rest of this file
   * does: invent a provider whose answer is legitimate and different, and check
   * the dashboard survives it. หาไม่เจอต้องได้ขีด ไม่ใช่ได้เลขของแถวข้าง ๆ
   */
  it('⭐⭐⭐ a partial owned section: the missing keys draw a dash, not row 0', async () => {
    envelope.value = {
      success: true,
      customer_provider: 'provider_b',
      /* `finance` is what makes the การเงิน card render at all — the panel still
         asks the blob WHETHER a card appears. `{}` is enough and is honest:
         this provider carries its VALUES in `view`, not in the blob. */
      data: { profile: {}, finance: {} },
      view: {
        sections: [
          {
            id: 'finance.deposits',
            type: 'amount_rows',
            group: 'finance',
            label: 'ประวัติฝาก',
            // ONE row, and it is not `finCredit`. The card asks for three.
            rows: [{ key: 'finDepTotal', label: 'ยอดฝากรวม', value: 8888 }],
          } as Section,
        ],
      },
    };
    render(
      <I18nProvider>
        <PersonalPanelNarrow
          source={
            {
              line_user_data: { _id: 'a0d00000000000000000002b' },
              line_oa_hook_id: 'h1',
            } as never
          }
          room={null}
        />
      </I18nProvider>,
    );
    // การเงิน ships collapsed, so open it before reading its body.
    await waitFor(() => expect(screen.getByText('การเงิน')).toBeTruthy());
    fireEvent.click(screen.getByText('การเงิน').parentElement!);
    /* EXACTLY ONE. The deposit total is drawn in its own green strip; a lookup
       that fell back to the first row would print the same figure in the
       เครดิตคงเหลือ and เงินค้างในกระเป๋า cells as well, and this count would be
       three. Counting is the assertion — `getByText` alone would pass on all
       three. */
    expect(screen.getAllByText('8,888.00').length).toBe(1);
    // and the two keys this provider did not send read as absent
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(2);
  });

  it('an absent or empty view is a normal state, not an error', () => {
    // The panel renders before the profile request lands, and `view` is ADDITIVE
    // — a back end that predates it answers without one.
    expect(unownedSections(undefined)).toEqual([]);
    expect(unownedSections(null)).toEqual([]);
    const { container } = render(<ProfilePanelView view={{ sections: [] }} />);
    expect(container.textContent).toBe('');
  });
});
