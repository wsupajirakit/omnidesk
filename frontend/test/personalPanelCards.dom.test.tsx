/**
 * [REFACTOR-20260905-CUSTPROV] CHARACTERIZATION — what the ข้อมูลส่วนตัว panel
 * puts ON SCREEN today, pinned before a single line of it moves.
 *
 * 🔗 CROSS-REPO: the back-end half is `omnidesk-api/src/modules/customer-provider/`
 *    and `omnidesk-api/todo/be_todo104_05092026.md`. That side owns the mapping;
 *    THIS side owns the proof that the mapping's output is what a person sees.
 *
 * ## 🔴 WHY IT EXISTS — the gate, not a nicety
 * `dev-local §6.3` forbids moving or rewriting UI without a characterization test
 * that is green on the UNCHANGED code first. `PersonalPanel.tsx` is 2,780 lines,
 * it draws six cards from a vendor blob, and until this file there was NO test
 * that rendered it at all. Its blob mapping had no coverage for five weeks while
 * being the only place that knew how to read a real Shop-API payload.
 *
 * So the panel could not be touched, and that is why the port stopped here.
 * เทสตรึงจอต้องมาก่อน ถึงจะขยับไฟล์ได้
 *
 * ## What it asserts, and what it deliberately does not
 * It asserts the VALUES that reach the screen — the numbers, the labels, the
 * badge text — for both upstream shapes. It does not snapshot class strings: the
 * next step moves markup between files, and a class-level snapshot would go red
 * for a move that changed nothing a person can see, which trains people to
 * regenerate snapshots. Values are what a customer's card being wrong looks like.
 *
 * 🔴 THESE DESCRIBE, THEY DO NOT JUDGE. Where today's screen looks odd it is
 * pinned AS IS. A characterization test that "fixes" what it finds is not a
 * baseline.
 *
 * ## [FEAT-20260905-CUSTPROV] EVERY PAYLOAD NOW CARRIES A `view` TOO
 * The panel's eight cards stopped computing their values from the raw blob and
 * started reading `view.sections` by key. The blobs below are UNCHANGED — they
 * are still the two upstream shapes and the three edges — and each has gained
 * the `view` the real back end ships beside it. Not one assertion moved: the
 * numbers, labels and badge texts pinned here are the same characters as before
 * the change, which is the whole claim being made. See the block above `MOCK`
 * for how those views were produced and why they were not written by hand.
 *
 * revert: delete this file (and the panel becomes untouchable again, correctly).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

/* ── the blob the panel will be handed ────────────────────────────────────── */
const blob: { value: unknown } = { value: null };

/* ── stubs: everything the panel reaches for that is not the blob ─────────── */
vi.mock('../services/chat', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/chat');
  return {
    ...actual,
    ticketService: {
      getRawProfile: () => Promise.resolve(blob.value),
      refreshRawProfile: () => Promise.resolve(blob.value),
      clearRawProfile: () => Promise.resolve({ success: true }),
      // The ข้อมูลเว็บ card has its OWN route and its own cache. Answering `null`
      // keeps it out of this test, which is about the profile cards.
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
import type { CustomerView } from '../components/profile-panel/renderers/types';

/* ── the `view` half of the same answers, TRANSCRIBED FROM THE REAL BUILDER ──
 * [FEAT-20260905-CUSTPROV] The panel's eight cards no longer read the blob
 * above; they read `view.sections` BY KEY (`renderers/sectionValues.ts`). So a
 * fixture that carried only `data` would render eight empty cards and this file
 * would go red for the right reason and the wrong one — the payload would be
 * lying about what the back end sends, not the panel about what it draws.
 *
 * 🔴 THESE WERE NOT HAND-WRITTEN. Each block below is the VERBATIM output of
 * the real producer run over the payload above it:
 *
 *     validateView(buildShopapiV1View(composeFields(shopapiV1Provider, <payload>)))
 *
 * — i.e. `omnidesk-api/src/modules/customer-provider/providers/shopapi-v1/` driven
 * through the same three calls `CustomerProviderService.viewOf` makes, then
 * printed as a TS literal and pasted in. Writing a `view` by hand here is the
 * one thing that would make this file worthless: it would prove the fixture
 * agrees with the panel, not that the PRODUCT does. เขียน view เองเมื่อไหร่ = เทสวัดตัวเอง
 *
 * ⚠️ ONE SECTION PER LINE, machine-formatted. Do not tidy it by hand — if the
 * producer changes, re-run it and replace the block; a hand edit is exactly the
 * hand-written view this note forbids, arriving one field at a time.
 *
 * ⚠️ `{ data: {} }` and `{ data: { profile: { promotion: { recent_products: [] } } } }`
 * produce a BYTE-IDENTICAL view (compared with `JSON.stringify` on the two
 * generated blobs, 05/09), so they share `VIEW_NO_DATA` rather than carrying two
 * copies that could drift apart. Note what it shows: the producer emits all
 * eight sections even for a payload with no customer in it — which is why the
 * panel still asks the raw blob WHETHER to draw a card.
 */

const VIEW_MOCK: CustomerView = { sections: [
  { id: 'promotion', type: 'kv', label: 'โปรโมชั่น', collapsed: true,
    badge: [{ key: 'promoName', label: '🎟 PROMO A', tone: 'info' }],
    rows: [{ key: 'promoName', label: 'โปรที่ใช้อยู่', value: 'PROMO A' }, { key: 'promoActivityVolume', label: 'Activity volume (activity volume)', value: 10, target: 20 }, { key: 'promoOutstanding', label: 'Outstanding', value: 3 }],
  },
  { id: 'products', type: 'list', label: 'สินค้าที่ซื้อล่าสุด', collapsed: true, items: [{ label: 'Mock Target', secondary: 'MOCKCO', value: 9, at: 9, tags: ['MockCo'] }, { label: 'Mock Fashion', secondary: 'MOCKCO', value: 2, at: 2, tags: ['MockCo'] }] },
  { id: 'finance.deposits', type: 'amount_rows', group: 'finance', label: 'ประวัติฝาก', collapsed: true,
    badge: [{ key: 'finAutoDep', label: 'ฝาก: เปิด', tone: 'ok' }, { key: 'finAutoWd', label: 'ถอน: ปิด', tone: 'off' }],
    rows: [{ key: 'finCredit', label: 'เครดิตคงเหลือ', value: 100 }, { key: 'finWallet', label: 'เงินค้างในกระเป๋า', value: 20 }, { key: 'finDepTotal', label: 'ยอดฝากรวม', value: 900 }],
    amountRows: [{ at: '2026-08-01T00:00:00Z', amount: 50, sign: '+', status: 'success' }],
  },
  { id: 'finance.withdrawals', type: 'amount_rows', group: 'finance', label: 'ประวัติถอน', collapsed: true, rows: [{ key: 'finWdTotal', label: 'ยอดถอนรวม', value: 400 }], amountRows: [{ at: '2026-08-02T00:00:00Z', amount: 10, sign: '-', status: 'success' }] },
  { id: 'bonus.cashback', type: 'amount_rows', group: 'bonus', label: 'เงินคืน', collapsed: true,
    rows: [{ key: 'cbPending', label: 'ยอดรอให้กดรับ', value: 5 }, { key: 'cbClaimed', label: 'รับไปแล้วทั้งหมด', value: 50 }],
    amountRows: [{ amount: 5, sign: '+' }],
  },
  { id: 'bonus.referral', type: 'amount_rows', group: 'bonus', label: 'แนะนำเพื่อน', collapsed: true,
    rows: [{ key: 'rfPending', label: 'ยอดรอให้กดรับ', value: 1 }, { key: 'rfClaimed', label: 'รับไปแล้วทั้งหมด', value: 10 }, { key: 'rfFriends', label: 'แนะนำเพื่อนแล้ว', value: 7 }],
    amountRows: [{ amount: 1, sign: '+' }],
  },
  { id: 'activity.coins', type: 'list', group: 'activity', label: 'เหรียญ', collapsed: true, rows: [{ key: 'acCoinBal', label: 'เหรียญล่าสุดที่มี', value: 30 }], items: [{ label: 'ได้รับ', secondary: '', value: 3, sign: '+' }] },
  { id: 'activity.point_round', type: 'list', group: 'activity', label: 'รอบสะสมแต้ม', collapsed: true, items: [] },
] };

const VIEW_REAL: CustomerView = { sections: [
  { id: 'promotion', type: 'kv', label: 'โปรโมชั่น', collapsed: true,
    badge: [{ key: 'promoName', label: '🎟 PROMO REAL', tone: 'info' }],
    rows: [{ key: 'promoName', label: 'โปรที่ใช้อยู่', value: 'PROMO REAL' }, { key: 'promoActivityVolume', label: 'Activity volume (activity volume)' }, { key: 'outstanding:fashion', label: 'fashion', value: 20 }, { key: 'outstanding:home_living', label: 'home_living', value: 13 }],
  },
  { id: 'products', type: 'list', label: 'สินค้าที่ซื้อล่าสุด', collapsed: true,
    items: [{ label: 'Real Fashion', secondary: 'REALCO · FASHION', value: 50, at: 50, tags: ['RealCo', 'FASHION'] }, { label: 'Real Target', secondary: 'REALCO · ELECTRONICS', value: 5, at: 5, tags: ['RealCo', 'ELECTRONICS'] }],
  },
  { id: 'finance.deposits', type: 'amount_rows', group: 'finance', label: 'ประวัติฝาก', collapsed: true,
    badge: [{ key: 'finAutoDep', label: 'ฝาก: เปิด', tone: 'ok' }, { key: 'finAutoWd', label: 'ถอน: ปิด', tone: 'off' }],
    rows: [{ key: 'finCredit', label: 'เครดิตคงเหลือ', value: 50085.46 }, { key: 'finWallet', label: 'เงินค้างในกระเป๋า', value: 12 }, { key: 'finDepTotal', label: 'ยอดฝากรวม', value: 8000 }],
    amountRows: [],
  },
  { id: 'finance.withdrawals', type: 'amount_rows', group: 'finance', label: 'ประวัติถอน', collapsed: true, rows: [{ key: 'finWdTotal', label: 'ยอดถอนรวม', value: 3000 }], amountRows: [] },
  { id: 'bonus.cashback', type: 'amount_rows', group: 'bonus', label: 'เงินคืน', collapsed: true,
    rows: [{ key: 'cbPending', label: 'ยอดรอให้กดรับ', value: 9 }, { key: 'cbClaimed', label: 'รับไปแล้วทั้งหมด', value: 90 }],
    amountRows: [{ amount: 9, sign: '+' }, { amount: 8, sign: '+' }],
  },
  { id: 'bonus.referral', type: 'amount_rows', group: 'bonus', label: 'แนะนำเพื่อน', collapsed: true,
    rows: [{ key: 'rfPending', label: 'ยอดรอให้กดรับ' }, { key: 'rfClaimed', label: 'รับไปแล้วทั้งหมด' }, { key: 'rfFriends', label: 'แนะนำเพื่อนแล้ว', value: 3 }],
    amountRows: [{ amount: 2, sign: '+' }, { amount: 3, sign: '+' }, { amount: 4, sign: '+' }],
  },
  { id: 'activity.coins', type: 'list', group: 'activity', label: 'เหรียญ', collapsed: true, rows: [{ key: 'acCoinBal', label: 'เหรียญล่าสุดที่มี', value: 77 }], items: [{ label: 'ได้รับ', secondary: '100', at: 100, value: 5, sign: '+' }] },
  { id: 'activity.point_round', type: 'list', group: 'activity', label: 'รอบสะสมแต้ม', collapsed: true, items: [] },
] };

const VIEW_NO_DATA: CustomerView = { sections: [
  { id: 'promotion', type: 'kv', label: 'โปรโมชั่น', collapsed: true,
    badge: [{ key: 'promoName', label: 'ไม่มีโปรโมชั่น', tone: 'muted' }],
    rows: [{ key: 'promoName', label: 'โปรที่ใช้อยู่' }, { key: 'promoActivityVolume', label: 'Activity volume (activity volume)' }, { key: 'promoOutstanding', label: 'Outstanding' }],
  },
  { id: 'products', type: 'empty', label: 'สินค้าที่ซื้อล่าสุด', collapsed: true, text: 'ยังไม่มีสินค้าที่ซื้อล่าสุด' },
  { id: 'finance.deposits', type: 'amount_rows', group: 'finance', label: 'ประวัติฝาก', collapsed: true,
    badge: [{ key: 'finAutoDep', label: 'ฝาก: ปิด', tone: 'off' }, { key: 'finAutoWd', label: 'ถอน: ปิด', tone: 'off' }],
    rows: [{ key: 'finCredit', label: 'เครดิตคงเหลือ' }, { key: 'finWallet', label: 'เงินค้างในกระเป๋า' }, { key: 'finDepTotal', label: 'ยอดฝากรวม' }],
    amountRows: [],
  },
  { id: 'finance.withdrawals', type: 'amount_rows', group: 'finance', label: 'ประวัติถอน', collapsed: true, rows: [{ key: 'finWdTotal', label: 'ยอดถอนรวม' }], amountRows: [] },
  { id: 'bonus.cashback', type: 'amount_rows', group: 'bonus', label: 'เงินคืน', collapsed: true, rows: [{ key: 'cbPending', label: 'ยอดรอให้กดรับ' }, { key: 'cbClaimed', label: 'รับไปแล้วทั้งหมด' }], amountRows: [] },
  { id: 'bonus.referral', type: 'amount_rows', group: 'bonus', label: 'แนะนำเพื่อน', collapsed: true,
    rows: [{ key: 'rfPending', label: 'ยอดรอให้กดรับ' }, { key: 'rfClaimed', label: 'รับไปแล้วทั้งหมด' }, { key: 'rfFriends', label: 'แนะนำเพื่อนแล้ว', value: 0 }],
    amountRows: [],
  },
  { id: 'activity.coins', type: 'list', group: 'activity', label: 'เหรียญ', collapsed: true, rows: [{ key: 'acCoinBal', label: 'เหรียญล่าสุดที่มี', value: 0 }], items: [] },
  { id: 'activity.point_round', type: 'list', group: 'activity', label: 'รอบสะสมแต้ม', collapsed: true, items: [] },
] };

const VIEW_ZERO_CREDIT: CustomerView = { sections: [
  { id: 'promotion', type: 'kv', label: 'โปรโมชั่น', collapsed: true,
    badge: [{ key: 'promoName', label: 'ไม่มีโปรโมชั่น', tone: 'muted' }],
    rows: [{ key: 'promoName', label: 'โปรที่ใช้อยู่' }, { key: 'promoActivityVolume', label: 'Activity volume (activity volume)' }, { key: 'promoOutstanding', label: 'Outstanding' }],
  },
  { id: 'products', type: 'empty', label: 'สินค้าที่ซื้อล่าสุด', collapsed: true, text: 'ยังไม่มีสินค้าที่ซื้อล่าสุด' },
  { id: 'finance.deposits', type: 'amount_rows', group: 'finance', label: 'ประวัติฝาก', collapsed: true,
    badge: [{ key: 'finAutoDep', label: 'ฝาก: ปิด', tone: 'off' }, { key: 'finAutoWd', label: 'ถอน: ปิด', tone: 'off' }],
    rows: [{ key: 'finCredit', label: 'เครดิตคงเหลือ', value: 0 }, { key: 'finWallet', label: 'เงินค้างในกระเป๋า' }, { key: 'finDepTotal', label: 'ยอดฝากรวม' }],
    amountRows: [],
  },
  { id: 'finance.withdrawals', type: 'amount_rows', group: 'finance', label: 'ประวัติถอน', collapsed: true, rows: [{ key: 'finWdTotal', label: 'ยอดถอนรวม' }], amountRows: [] },
  { id: 'bonus.cashback', type: 'amount_rows', group: 'bonus', label: 'เงินคืน', collapsed: true, rows: [{ key: 'cbPending', label: 'ยอดรอให้กดรับ' }, { key: 'cbClaimed', label: 'รับไปแล้วทั้งหมด' }], amountRows: [] },
  { id: 'bonus.referral', type: 'amount_rows', group: 'bonus', label: 'แนะนำเพื่อน', collapsed: true,
    rows: [{ key: 'rfPending', label: 'ยอดรอให้กดรับ' }, { key: 'rfClaimed', label: 'รับไปแล้วทั้งหมด' }, { key: 'rfFriends', label: 'แนะนำเพื่อนแล้ว', value: 0 }],
    amountRows: [],
  },
  { id: 'activity.coins', type: 'list', group: 'activity', label: 'เหรียญ', collapsed: true, rows: [{ key: 'acCoinBal', label: 'เหรียญล่าสุดที่มี', value: 0 }], items: [] },
  { id: 'activity.point_round', type: 'list', group: 'activity', label: 'รอบสะสมแต้ม', collapsed: true, items: [] },
] };


const VIEW_ACTIVITY_UNIT: CustomerView = { sections: [
  { id: 'promotion', type: 'kv', label: 'โปรโมชั่น', collapsed: true,
    badge: [{ key: 'promoName', label: '🎟 PROMO U', tone: 'info' }],
    rows: [{ key: 'promoName', label: 'โปรที่ใช้อยู่', value: 'PROMO U' }, { key: 'promoActivityVolume', label: 'Activity volume (fashion)', value: 12, target: 100, suffix: '(87%)' }, { key: 'promoOutstanding', label: 'Outstanding', value: 0 }],
  },
  { id: 'products', type: 'empty', label: 'สินค้าที่ซื้อล่าสุด', collapsed: true, text: 'ยังไม่มีสินค้าที่ซื้อล่าสุด' },
  { id: 'finance.deposits', type: 'amount_rows', group: 'finance', label: 'ประวัติฝาก', collapsed: true,
    badge: [{ key: 'finAutoDep', label: 'ฝาก: ปิด', tone: 'off' }, { key: 'finAutoWd', label: 'ถอน: ปิด', tone: 'off' }],
    rows: [{ key: 'finCredit', label: 'เครดิตคงเหลือ' }, { key: 'finWallet', label: 'เงินค้างในกระเป๋า' }, { key: 'finDepTotal', label: 'ยอดฝากรวม' }],
    amountRows: [],
  },
  { id: 'finance.withdrawals', type: 'amount_rows', group: 'finance', label: 'ประวัติถอน', collapsed: true, rows: [{ key: 'finWdTotal', label: 'ยอดถอนรวม' }], amountRows: [] },
  { id: 'bonus.cashback', type: 'amount_rows', group: 'bonus', label: 'เงินคืน', collapsed: true, rows: [{ key: 'cbPending', label: 'ยอดรอให้กดรับ' }, { key: 'cbClaimed', label: 'รับไปแล้วทั้งหมด' }], amountRows: [] },
  { id: 'bonus.referral', type: 'amount_rows', group: 'bonus', label: 'แนะนำเพื่อน', collapsed: true,
    rows: [{ key: 'rfPending', label: 'ยอดรอให้กดรับ' }, { key: 'rfClaimed', label: 'รับไปแล้วทั้งหมด' }, { key: 'rfFriends', label: 'แนะนำเพื่อนแล้ว', value: 0 }],
    amountRows: [],
  },
  { id: 'activity.coins', type: 'list', group: 'activity', label: 'เหรียญ', collapsed: true, rows: [{ key: 'acCoinBal', label: 'เหรียญล่าสุดที่มี', value: 0 }], items: [] },
  { id: 'activity.point_round', type: 'list', group: 'activity', label: 'รอบสะสมแต้ม', collapsed: true, items: [] },
] };

/** The demo/mock upstream: sections BESIDE `profile`, old field names. */
const MOCK = {
  data: {
    profile: { name: 'mock user', tier: { name: 'Gold', level: 2 } },
    finance: {
      credit_balance: 100,
      wallet_pending: 20,
      deposit_total: 900,
      withdraw_total: 400,
      auto_deposit: 'enabled',
      auto_withdraw: 'disabled',
      recent_deposits: [{ amount: 50, at: '2026-08-01T00:00:00Z', status: 'success' }],
      recent_withdrawals: [{ amount: 10, at: '2026-08-02T00:00:00Z', status: 'success' }],
    },
    bonus: {
      cashback: { pending: 5, claimed_total: 50, history: [{ amount: 5 }] },
      referral: { pending: 1, claimed_total: 10, history: [{ amount: 1 }], friends_count: 7 },
    },
    activity: { coins: { balance: 30, history: [{ amount: 3, type: 'earn' }] } },
    promotion: {
      current: 'PROMO A',
      activity_volume: { done: 10, required: 20 },
      outstanding: 3,
      // Mock names: `product` / `provider`. Two rows so the sort is observable.
      top_products: [
        { product: 'Mock Fashion', provider: 'MockCo', at: 2 },
        { product: 'Mock Target', provider: 'MockCo', at: 9 },
      ],
    },
  },
  view: VIEW_MOCK,
};

/** The real Shop-API: sections NESTED inside `profile`, new field names. */
const REAL = {
  data: {
    profile: {
      name: 'real user',
      finance: {
        balances: [
          { asset_code: 'credit', amount: 50085.46 },
          { asset_code: 'cash', amount: 12 },
          { asset_code: 'coin', amount: 77 },
        ],
        total_deposit: 8000,
        total_withdraw: 3000,
        is_auto_deposit: true,
        is_auto_withdraw: false,
        transactions: { deposit: [], withdraw: [] },
      },
      bonus: {
        pending_cashback: 9,
        claimed_cashback: 90,
        cashback_history: [{ amount: 9 }, { amount: 8 }],
        referral_history: [{ amount: 2 }, { amount: 3 }, { amount: 4 }],
      },
      activity: { coin_received: [{ amount: 5, date: 100 }] },
      promotion: {
        current_promotion_info: { name: 'PROMO REAL' },
        outstanding: { total: 33, fashion: 20, home_living: 13 },
        // Real names: `catalog_name` / `product_name` / `product_type`. Older row
        // first, so "newest first" is a claim the assertion can fail on.
        recent_products: [
          { catalog_name: 'Real Target', product_name: 'RealCo', product_type: 'ELECTRONICS', played_at: 5 },
          { catalog_name: 'Real Fashion', product_name: 'RealCo', product_type: 'FASHION', played_at: 50 },
        ],
      },
    },
  },
  view: VIEW_REAL,
};

const source = { line_user_data: { _id: 'a0d00000000000000000002b' }, line_oa_hook_id: 'h1' };

/**
 * Render, then OPEN EVERY CARD.
 *
 * ⚠️ `PanelCard` ships `defaultOpen={false}` for the five data cards, and a
 * collapsed card renders `{open && …}` — its contents are not in the DOM at all.
 * The first version of this file asserted against a closed panel and 7 of 11
 * cases failed while the component was working perfectly. A test that reads a
 * collapsed accordion is measuring nothing. เทสต้องกางการ์ดก่อน ไม่งั้นวัดความว่าง
 */
const draw = async (payload: unknown) => {
  blob.value = payload;
  const r = render(
    <I18nProvider>
      <PersonalPanelNarrow source={source as never} room={null} />
    </I18nProvider>,
  );
  /* The profile arrives on a promise, so wait for the panel to have settled into
     SOME card before clicking. `>= 1`, not `> 1`: the no-profile case draws only
     the ข้อมูล LINE card, and an over-strict wait here failed that case for a
     reason that had nothing to do with the panel. */
  await waitFor(() =>
    expect(document.querySelectorAll('h3').length).toBeGreaterThanOrEqual(1),
  );
  for (const h of Array.from(document.querySelectorAll('h3'))) {
    const header = h.parentElement;
    if (header) fireEvent.click(header);
  }
  return r;
};

/** Switch a card's inner tab — `PanelTabs` renders only the active one. */
const openTab = (label: string) => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').trim().startsWith(label),
  );
  expect(btn, `tab "${label}" not found`).toBeTruthy();
  fireEvent.click(btn!);
};

beforeEach(() => {
  blob.value = null;
  vi.clearAllMocks();
});

describe('[PANELCARDS] the MOCK upstream — every value that reaches the screen', () => {
  it('⭐ finance: credit, wallet, totals and both auto badges', async () => {
    await draw(MOCK);
    // 100 / 20 arrive formatted by `xpAmt`; the assertion is on what a person
    // reads, so it goes through the same formatter the card uses.
    await waitFor(() => expect(screen.getByText('100.00')).toBeInTheDocument());
    expect(screen.getByText('20.00')).toBeInTheDocument();
    expect(screen.getByText('900.00')).toBeInTheDocument(); // ประวัติฝาก is tab 1
    /* [FEAT-20260905-CUSTPROV] the history ROWS, not just the totals. Added
       after a mutation that emptied every history list stayed green: the two
       tables were on screen and nothing read them, so "the card draws its
       history" was never actually a claim this file made. */
    expect(screen.getByText('+50.00')).toBeInTheDocument();
    openTab('ประวัติถอน');
    expect(screen.getByText('400.00')).toBeInTheDocument();
    expect(screen.getByText('-10.00')).toBeInTheDocument();
    // 'enabled' / 'disabled' are STRINGS on this shape — the badges must disagree.
    expect(screen.getByText('ฝาก: เปิด')).toBeInTheDocument();
    expect(screen.getByText('ถอน: ปิด')).toBeInTheDocument();
  });

  it('⭐ bonus and activity: pending, claimed, friend count, coins', async () => {
    await draw(MOCK);
    await waitFor(() => expect(screen.getByText('5.00')).toBeInTheDocument());
    expect(screen.getByText('50.00')).toBeInTheDocument();
    // the cashback history row — same reason as the finance tables above
    expect(screen.getByText('+5.00')).toBeInTheDocument();
    openTab('แนะนำเพื่อน');
    expect(screen.getByText('แนะนำเพื่อนแล้ว 7 คน')).toBeInTheDocument();
    expect(screen.getByText('🪙 30')).toBeInTheDocument();
  });

  /**
   * ⭐⭐ [FEAT-20260905-CUSTPROV] ADDED 05/09 — the two กิจกรรม tabs read TWO
   * sections, and this is what says so.
   *
   * 🔴 ADDED AFTER A MUTATION SURVIVED. Pointing the รอบสะสมแต้ม tab at
   * `activity.coins` instead of `activity.point_round` left every case green: the coin
   * BALANCE was asserted, the coin ROWS and the point round rows were not, so the two
   * tabs were interchangeable as far as the suite could tell. This mock sends a
   * coin history and no point round history, which makes the two sections tell each
   * other apart — swap them and the เหรียญ row disappears while the รอบสะสมแต้ม empty
   * state is replaced by a coin row. สองแท็บต้องอ่านคนละ section จริง ๆ
   */
  it('⭐⭐ activity: the coin row is in เหรียญ, and รอบสะสมแต้ม keeps its empty state', async () => {
    await draw(MOCK);
    // เหรียญ is the first tab, so it is already active: the coin row's text.
    await waitFor(() => expect(screen.getByText('ได้รับ')).toBeInTheDocument());
    openTab('รอบสะสมแต้ม');
    expect(screen.getByText('ยังไม่มีประวัติรอบสะสมแต้ม')).toBeInTheDocument();
  });

  it('⭐ promotion: the name badge, and a SCALAR outstanding keeps one summary row', async () => {
    await draw(MOCK);
    await waitFor(() => expect(screen.getByText('🎟 PROMO A')).toBeInTheDocument());
    // `promoOsBreakdown` is empty for a scalar, so the per-product table must NOT
    // appear — this is the switch the missing field would have broken.
    expect(screen.queryByText('ค้างอยู่')).not.toBeInTheDocument();
    expect(screen.getByText('3.00')).toBeInTheDocument();
  });

  it('the tier badge reads name + level from the blob', async () => {
    await draw(MOCK);
    await waitFor(() => expect(screen.getByText(/Gold Tier 2/)).toBeInTheDocument());
  });

  /**
   * ⭐⭐ [FEAT-20260905-CUSTPROV] ADDED 05/09 — the activity volume summary row's own
   * LABEL and its trailing PERCENTAGE.
   *
   * Neither upstream fixture above sends `activity_volume.unit` or `activity_volume.percent`,
   * so both branches were uncovered: every existing case renders the default
   * label `Activity volume (activity volume)` and no percentage at all. That was already true
   * before this change (the card read `promotion.activity_volume?.unit` and
   * `?.percent` inline and nothing exercised them), but it matters more now —
   * both values TRAVEL ON THE WIRE, so blanking either would be a silent screen
   * change that no other case could see.
   *
   * The payload is a real upstream shape (the mock's `activity_volume` object with the
   * two optional keys filled in) and the view beside it is the producer's own
   * answer to it, not a hand-written one. เคสนี้ปิดช่องที่ไม่เคยมีใครยิง
   */
  it('⭐⭐ the activity volume unit names the row, and a percentage is drawn beside it', async () => {
    await draw({
      data: {
        profile: {},
        promotion: { current: 'PROMO U', activity_volume: { done: 12, required: 100, unit: 'fashion', percent: 87 }, outstanding: 0 },
      },
      view: VIEW_ACTIVITY_UNIT,
    });
    // `Activity volume (fashion)` — the unit, not the literal fallback `activity_volume`.
    await waitFor(() => expect(screen.getByText('Activity volume (fashion)')).toBeInTheDocument());
    expect(screen.getByText('(87%)')).toBeInTheDocument();
    // and the pair the colour rule compares still reaches the screen
    expect(screen.getByText('12.00')).toBeInTheDocument();
    expect(screen.getByText('/100.00')).toBeInTheDocument();
  });
});

describe('[PANELCARDS] the REAL upstream — the shape the mock does not cover', () => {
  it('⭐ credit comes out of balances[] — the defect the mapping was written for', async () => {
    // 50,085.46 in the payload while the screen showed "-", hook `demo-oa-three`,
    // 2026-08-01. This assertion IS that bug.
    await draw(REAL);
    await waitFor(() => expect(screen.getByText('50,085.46')).toBeInTheDocument());
    expect(screen.getByText('12.00')).toBeInTheDocument();
    expect(screen.getByText('🪙 77')).toBeInTheDocument();
  });

  it('⭐ is_auto_deposit is a BOOLEAN here, and the badges still disagree', async () => {
    await draw(REAL);
    await waitFor(() => expect(screen.getByText('ฝาก: เปิด')).toBeInTheDocument());
    expect(screen.getByText('ถอน: ปิด')).toBeInTheDocument();
  });

  it('⭐ friends_count is absent ⇒ the ROW COUNT is shown, not 0', async () => {
    await draw(REAL);
    openTab('แนะนำเพื่อน');
    expect(screen.getByText('แนะนำเพื่อนแล้ว 3 คน')).toBeInTheDocument();
  });

  it('⭐ an OBJECT outstanding draws the per-product rows — the value the port missed', async () => {
    await draw(REAL);
    // `promoOsBreakdown` non-empty ⇒ the table replaces the one-line summary.
    await waitFor(() => expect(screen.getByText('ค้างอยู่')).toBeInTheDocument());
    expect(screen.getByText('20.00')).toBeInTheDocument();
    expect(screen.getByText('13.00')).toBeInTheDocument();
  });

  it('the promotion badge reads .name off an OBJECT, not a bare string', async () => {
    await draw(REAL);
    await waitFor(() => expect(screen.getByText('🎟 PROMO REAL')).toBeInTheDocument());
  });
});

describe('[PANELCARDS] the edges that must not regress', () => {
  it('no profile at all ⇒ the cards stay away, and nothing throws', async () => {
    await draw({ data: {}, view: VIEW_NO_DATA });
    // The four section cards render under `{finance && …}` etc. Their titles are
    // the honest check that "no customer" is not drawn as "a customer with zeroes".
    await waitFor(() => expect(screen.queryByText('การเงิน')).not.toBeInTheDocument());
    expect(screen.queryByText('โบนัส')).not.toBeInTheDocument();
    expect(screen.queryByText('กิจกรรม')).not.toBeInTheDocument();
  });

  it('⭐ a credit balance of 0 shows 0.00 — not the other key, not a dash', async () => {
    // The `??` rule at card level. A mutation of the back-end reader that turned
    // this into truthiness left 61 unit tests green; on screen it is the
    // difference between 0.00 and 999.00.
    await draw({
      data: {
        profile: {},
        finance: { credit_balance: 0, balances: [{ asset_code: 'credit', amount: 999 }] },
      },
      view: VIEW_ZERO_CREDIT,
    });
    await waitFor(() => expect(screen.getByText('0.00')).toBeInTheDocument());
    expect(screen.queryByText('999.00')).not.toBeInTheDocument();
  });
});

/**
 * ⭐⭐ THE PRODUCTS CARD — added 05/09 after the split found it had NO coverage.
 *
 * The fixtures never populated `top_products`/`recent_products`, so `promoProducts` was
 * always `[]` and every per-row expression in that card — five vendor field
 * names and a sort — was untested. Moving the card to its own file made that
 * visible: a mutation to its empty-state text stayed green.
 *
 * Verified as a PRE-EXISTING gap, not one the move introduced: the same
 * mutation was green before the card was touched.
 */
describe('[PANELCARDS] the products card, on both vendor shapes', () => {
  it('⭐ mock names — `product` and `provider`', async () => {
    await draw(MOCK);
    await waitFor(() => expect(screen.getByText('Mock Fashion')).toBeInTheDocument());
    expect(screen.getByText('Mock Target')).toBeInTheDocument();
    /* The card UPPERCASES the provider and joins it to the type with ` · `
       (`RecentProductsCard.tsx:107`). The mock sends no `product_type`, so the row
       reads just the provider. Asserting 'MockCo' failed here first — pinned as
       it renders, not as it is stored. */
    expect(screen.getAllByText('MOCKCO').length).toBe(2);
  });

  it('⭐ real names — `catalog_name`, `product_name`, `product_type`', async () => {
    // The rename that made every field on this card render "-" against the real
    // upstream: `[FIX-20260802-GAMEFIELDS]`.
    await draw(REAL);
    await waitFor(() => expect(screen.getByText('Real Fashion')).toBeInTheDocument());
    expect(screen.getByText('Real Target')).toBeInTheDocument();
    // Provider AND type, uppercased and joined — the real upstream sends both.
    expect(screen.getByText('REALCO · FASHION')).toBeInTheDocument();
    expect(screen.getByText('REALCO · ELECTRONICS')).toBeInTheDocument();
  });

  it('⭐ newest first — the upstream does not sort, the card does', async () => {
    await draw(REAL);
    await waitFor(() => expect(screen.getByText('Real Fashion')).toBeInTheDocument());
    const names = Array.from(document.querySelectorAll('*'))
      .filter((el) => el.children.length === 0)
      .map((el) => el.textContent?.trim())
      .filter((t) => t === 'Real Fashion' || t === 'Real Target');
    // played_at 50 before played_at 5.
    expect(names[0]).toBe('Real Fashion');
  });

  it('an empty list keeps the card on screen with its empty state', async () => {
    // `[FIX-20260801-GAMESEMPTY]` — the card used to VANISH on `recent_products: []`,
    // which moved every card below it depending on the customer.
    await draw({ data: { profile: { promotion: { recent_products: [] } } }, view: VIEW_NO_DATA });
    await waitFor(() =>
      expect(screen.getByText('ยังไม่มีสินค้าที่ซื้อล่าสุด')).toBeInTheDocument(),
    );
  });
});
