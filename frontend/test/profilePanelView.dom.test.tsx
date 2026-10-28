/**
 * [FEAT-20260905-CUSTPROV PART 7] The provider-described panel — renderers,
 * the host, and the unknown-type safety net.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §37 (closed set) · §39 (switch A→B→C→D with no FE file) ·
 *          §40 (unknown type = a visible, labelled fallback) · §41 (mutations)
 *
 * 🔴 THE CASE THIS FILE EXISTS FOR is `§39 · a provider this dashboard has
 * never heard of`. Every other case protects one rule; that one proves the
 * DESIGN — a hand-written view with ids and labels nothing like today's cards
 * renders completely, and adding it required no new front-end file. If that case
 * ever needs an FE change to pass, §39 says the part is re-cut, not patched.
 *
 * 🔴 `toBeVisible()`, NEVER `toBeInTheDocument()` — `broadcastFormVisible.dom.
 * test.tsx` records 1,240 tests staying green while four controls sat deleted or
 * behind `display:none`. "Absent" cases use `.toBeNull()` on a direct DOM query,
 * which is the stronger claim: the conditional never rendered it at all.
 *
 * Every case below was proven by mutation — see the task report for the table.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, fireEvent, within } from '@testing-library/react';

import { I18nProvider } from '../i18n';
import { ProfilePanelView, renderSection, KNOWN_SECTION_TYPES } from '../components/profile-panel/renderers';
import type { CustomerView, Section } from '../components/profile-panel/renderers';

const view = (...sections: Section[]): CustomerView => ({ sections });

const mount = (v: CustomerView) => render(<I18nProvider><ProfilePanelView view={v} /></I18nProvider>);

/** One card = one blue header strip (`PanelCard.tsx:52`). */
const cards = (c: HTMLElement) => c.querySelectorAll('.bg-primary-light');
/** The clickable header of the Nth card — collapsing is a click on that strip. */
const header = (c: HTMLElement, i = 0) => cards(c)[i] as HTMLElement;

describe('[CUSTPROV §37] one case per section type', () => {
  it('kv · draws label/value rows through PanelRow', () => {
    const { container, getByText } = mount(view({
      id: 'promotion', type: 'kv', label: 'โปรโมชั่น',
      rows: [
        { label: 'โปรที่ใช้อยู่', value: 'Welcome 100%' },
        { label: 'เพื่อนที่แนะนำ', value: 3 },
        { label: 'ยอดฝากรวม', value: 1234.5 },
      ],
    }));
    expect(getByText('โปรโมชั่น')).toBeVisible();
    expect(getByText('Welcome 100%')).toBeVisible();
    /* A COUNT keeps its shape and money gains separators — the one rule that
       forbids running every number through `xpAmt` (`values.tsx`). */
    expect(getByText('3')).toBeVisible();
    expect(getByText('1,234.5')).toBeVisible();
  });

  it('kv · `target` draws `value / target` and colours it with xpActivityTone', () => {
    const { container } = mount(view({
      id: 'promotion', type: 'kv', label: 'โปรโมชั่น',
      rows: [
        { label: 'ครบแล้ว', value: 100, target: 100 },
        { label: 'ยังไม่ครบ', value: 12, target: 100, suffix: '(12%)' },
        { label: 'ยังไม่เริ่ม', value: 0, target: 100 },
      ],
    }));
    const progress = Array.from(container.querySelectorAll('[data-testid="kv-progress"]'));
    expect(progress.length).toBe(3);
    /* 🔴 The tones are `xpActivityTone`'s, imported — not a second comparison rule.
       met ⇒ green · started ⇒ warning · ZERO ⇒ no colour even against a target
       of 100, which is the edge a re-implementation gets wrong. */
    expect(progress[0].className).toContain('text-green-700');
    expect(progress[1].className).toContain('text-warning');
    expect(progress[2].className).toContain('text-gray-800');
    expect(progress[0].textContent).toBe('100.00/100.00');
    expect(progress[1].textContent).toContain('12.00/100.00');
    /* the suffix rides beside the value, not instead of it */
    expect(within(container).getByText('(12%)')).toBeVisible();
  });

  it('list · image, bold label, secondary line, trailing value + amount', () => {
    const { container, getByText, getByAltText } = mount(view({
      id: 'products', type: 'list', label: 'สินค้าที่ซื้อล่าสุด',
      items: [{
        label: 'Fortune Tiger', secondary: 'PG · SLOT',
        value: 1784629980, amount: 50, image: 'https://cdn.example.test/tiger.png',
      }],
    }));
    expect(getByText('Fortune Tiger')).toBeVisible();
    expect(getByText('PG · SLOT')).toBeVisible();
    expect(getByAltText('Fortune Tiger')).toBeVisible();
    /* `value` is an epoch here and the panel's own `xpDT` prints it as a date —
       a products row must not show `1,784,629,980` where a timestamp belongs. */
    expect(container.textContent).toContain('น.');
    expect(container.textContent).not.toContain('1,784,629,980');
    expect(container.textContent).toContain('50.00'); // the amount, beside the value
    /* an object where a leaf belongs is dropped, never printed */
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('list · a schemeless image gains https, and a dead one falls back to initials', () => {
    const { getByAltText, getByTestId } = mount(view({
      id: 'products', type: 'list', label: 'สินค้าที่ซื้อล่าสุด',
      items: [{ label: 'Mahjong Ways', image: 'cdn.example.test/mj.png' }],
    }));
    const img = getByAltText('Mahjong Ways') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://cdn.example.test/mj.png');
    const fallback = getByTestId('list-item-initials');
    expect(fallback.style.display).toBe('none');
    fireEvent.error(img); // the URL is dead
    expect(img.style.display).toBe('none');
    expect(fallback.style.display).toBe('flex');
    expect(fallback.textContent).toBe('MA');
  });

  it('amount_rows · dated rows, sign from the section, status translated', () => {
    const { container, getByText } = mount(view({
      id: 'finance.withdrawals', type: 'amount_rows', label: 'ประวัติถอน',
      amountRows: [
        { at: '2026-09-01T10:00:00Z', amount: 500, sign: '-', status: 'pending' },
        { at: '2026-09-02T10:00:00Z', amount: 250, sign: '-' },
      ],
    }));
    /* 🔴 the upstream sends a withdrawal as a POSITIVE number in a withdrawals
       list, so the sign is the section's. Inferring it from the value would
       print money leaving as money arriving. */
    expect(getByText('-500.00')).toBeVisible();
    expect(getByText('-250.00')).toBeVisible();
    expect(container.innerHTML).toContain('text-red-500');
    expect(container.innerHTML).not.toContain('text-green-600');
    expect(getByText('รอดำเนินการ')).toBeVisible();
    expect(getByText('สำเร็จ')).toBeVisible(); // no status ⇒ finished normally
  });

  it('amount_rows · a row with no `sign` falls back to `+`, not to a bare number', () => {
    /* 🔴 ADDED AFTER A SURVIVING MUTATION. Deleting the `?? '+'` in
       `AmountRowsSection.tsx` left all 18 cases green: every row in every other
       case carries a sign, so nothing exercised the fallback. React renders
       `undefined` as nothing, so the bug is SILENT — the row loses its sign and
       keeps its (green) colour, and an unsigned figure in a signed table reads
       as money arriving. เทสเขียวไม่ได้แปลว่ากฎถูกทดสอบ */
    const { getByText } = mount(view({
      id: 'bonus.cashback', type: 'amount_rows', label: 'เงินคืน',
      amountRows: [{ at: '2026-09-01T10:00:00Z', amount: 90 }],
    }));
    expect(getByText('+90.00')).toBeVisible();
  });

  it('empty · the provider\'s own message, in the panel\'s italic empty state', () => {
    const { getByTestId } = mount(view({
      id: 'products', type: 'empty', label: 'สินค้าที่ซื้อล่าสุด', text: 'ยังไม่มีสินค้าที่ซื้อล่าสุด',
    }));
    const box = getByTestId('empty-section-products');
    expect(box).toBeVisible();
    expect(box.textContent).toBe('ยังไม่มีสินค้าที่ซื้อล่าสุด');
    expect(box.className).toContain('italic');
    expect(box.className).toContain('text-center');
  });
});

describe('[CUSTPROV §40] an unknown type is visible and labelled, never blank', () => {
  it('renders a labelled fallback naming the type, and says the data arrived', () => {
    const { container, getByTestId } = mount(view({
      id: 'crypto_wallet', type: 'sparkline', label: 'กระเป๋าคริปโต',
      rows: [{ label: 'BTC', value: 0.5 }, { label: 'ETH', value: 2 }],
    }));
    const box = getByTestId('unknown-section-crypto_wallet');
    /* §40's requirement, split into the three claims that matter.
       The label appears twice on purpose — once as the card title, once inside
       the box, because the box must be self-labelling when it is rendered as a
       TAB, where the card title is the group's name and not this section's. */
    expect(box).toBeVisible();                                   // not a blank space
    expect(box.textContent!.trim().length).toBeGreaterThan(0);   // not an empty container
    expect(within(box).getByText('กระเป๋าคริปโต')).toBeVisible(); // LABELLED
    expect(box.textContent).toContain('sparkline');              // and it names the type
    expect(box.textContent).toContain('2 รายการ');                // honest: data is here
    expect(container.querySelector('[data-section-type="sparkline"]')).not.toBeNull();
  });

  it('renderSection never returns null — the registry falls through', () => {
    expect(KNOWN_SECTION_TYPES).toEqual(['amount_rows', 'empty', 'kv', 'list']);
    for (const type of ['sparkline', 'chips', 'raw', 'constructor', 'toString', '']) {
      const el = renderSection({ id: 'x', type, label: 'ป้ายที่ต้องเห็น' });
      expect(el).not.toBeNull();
      const { container } = render(<I18nProvider>{el}</I18nProvider>);
      expect(container.textContent).toContain('ป้ายที่ต้องเห็น');
    }
  });

  it('an unknown CARD ID still renders — the icon default, not the icon map', () => {
    /* §39: a new provider invents a card id and ships with no FE release. The
       map has no `vip_desk`; the default must carry it. */
    const { container, getByText } = mount(view({
      id: 'vip_desk', type: 'kv', label: 'โต๊ะวีไอพี', rows: [{ label: 'ระดับ', value: 'Gold' }],
    }));
    expect(getByText('โต๊ะวีไอพี')).toBeVisible();
    expect(getByText('Gold')).toBeVisible();
    expect(header(container).querySelector('svg')).not.toBeNull();
  });
});

describe('[CUSTPROV §37] `group` — sections sharing one become tabs of ONE card', () => {
  const grouped = view(
    {
      id: 'finance.deposits', type: 'amount_rows', group: 'finance', label: 'ประวัติฝาก',
      badge: [{ label: 'ฝาก: เปิด', tone: 'ok' }],
      rows: [{ label: 'ยอดฝากรวม', value: 9000 }],
      amountRows: [{ at: '2026-09-01T10:00:00Z', amount: 300, sign: '+' }],
    },
    {
      id: 'finance.withdrawals', type: 'amount_rows', group: 'finance', label: 'ประวัติถอน',
      rows: [{ label: 'ยอดถอนรวม', value: 4000 }],
      amountRows: [{ at: '2026-09-02T10:00:00Z', amount: 700, sign: '-' }],
    },
  );

  it('one card, two tabs, in array order — and switching swaps the content', () => {
    const { container, getByText, queryByText } = mount(grouped);
    expect(cards(container).length).toBe(1); // ONE card, not two
    const tabs = container.querySelectorAll('button');
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toBe('ประวัติฝาก');
    expect(tabs[1].textContent).toBe('ประวัติถอน');

    /* tab 1 is active on mount: its rows are on screen, tab 2's are not */
    expect(getByText('9,000')).toBeVisible();
    expect(queryByText('4,000')).toBeNull();
    expect(getByText('+300.00')).toBeVisible();

    fireEvent.click(tabs[1]);
    expect(getByText('4,000')).toBeVisible();
    expect(queryByText('9,000')).toBeNull();
    expect(getByText('-700.00')).toBeVisible();
  });

  it('the card is titled from the group and badged from its first badged member', () => {
    const { container, getByText } = mount(grouped);
    /* no group title on the wire ⇒ derived, never a vendor map on the FE */
    expect(getByText('Finance')).toBeVisible();
    const badge = within(header(container)).getByText('ฝาก: เปิด');
    expect(badge).toBeVisible();
    expect(badge.className).toContain('text-green-700'); // tone ok ⇒ green
  });

  it('a summary `rows` on a non-kv section is drawn, not dropped', () => {
    /* `activity.coins` is type `list` AND carries เหรียญล่าสุดที่มี. A renderer
       that draws only its own collection loses it silently. */
    const { getByText } = mount(view({
      id: 'activity.coins', type: 'list', label: 'เหรียญ',
      rows: [{ label: 'เหรียญล่าสุดที่มี', value: 42 }],
      items: [{ label: 'ฝากเงิน', secondary: '1 ก.ย. 10:00น.', value: 5 }],
    }));
    expect(getByText('เหรียญล่าสุดที่มี')).toBeVisible();
    expect(getByText('42')).toBeVisible();
    expect(getByText('ฝากเงิน')).toBeVisible();
  });
});

describe('[CUSTPROV] collapsed, and the label rule', () => {
  it('`collapsed: true` ships the card shut; its body is not in the DOM', () => {
    const { container, getByText, queryByText } = mount(view({
      id: 'promotion', type: 'kv', label: 'โปรโมชั่น', collapsed: true,
      rows: [{ label: 'โปรที่ใช้อยู่', value: 'Welcome 100%' }],
    }));
    expect(getByText('โปรโมชั่น')).toBeVisible();       // the header still shows
    expect(queryByText('Welcome 100%')).toBeNull();     // the body does not exist
    fireEvent.click(header(container));
    expect(getByText('Welcome 100%')).toBeVisible();    // and it opens on click
  });

  it('a section with neither label nor labelKey is not drawn at all', () => {
    const { container, getByText } = mount(view(
      { id: 'ghost', type: 'kv', rows: [{ label: 'ไม่ควรเห็น', value: 'hidden' }] },
      { id: 'promotion', type: 'kv', label: 'โปรโมชั่น', rows: [{ label: 'โปรที่ใช้อยู่', value: 'W100' }] },
    ));
    expect(cards(container).length).toBe(1);            // the ghost made no card
    expect(container.querySelector('[data-testid="unknown-section-ghost"]')).toBeNull();
    expect(container.textContent).not.toContain('ไม่ควรเห็น');
    expect(getByText('โปรโมชั่น')).toBeVisible();        // and it did not take the panel with it
  });

  it('a ROW with neither label nor labelKey is not drawn either', () => {
    const { container, getByText } = mount(view({
      id: 'promotion', type: 'kv', label: 'โปรโมชั่น',
      rows: [{ value: 'ค่าที่ไม่มีป้าย' }, { label: 'โปรที่ใช้อยู่', value: 'W100' }],
    }));
    expect(container.textContent).not.toContain('ค่าที่ไม่มีป้าย');
    expect(getByText('W100')).toBeVisible();
  });

  it('labelKey wins when it resolves; an unknown key falls back to `label`', () => {
    const { getByText, container } = mount(view(
      { id: 'a', type: 'kv', labelKey: 'ticket.line_info', label: 'ไม่ควรใช้ค่านี้', rows: [{ label: 'x', value: 1 }] },
      { id: 'b', type: 'kv', labelKey: 'vendor.b.wallet', label: 'กระเป๋าเงิน', rows: [{ label: 'y', value: 2 }] },
    ));
    /* resolved ⇒ the dictionary's word (th default) */
    expect(getByText('ข้อมูล LINE')).toBeVisible();
    expect(container.textContent).not.toContain('ไม่ควรใช้ค่านี้');
    /* 🔴 unresolved ⇒ the literal, NEVER the dotted key. `t` returns the key
       itself when it gives up, so without the identity check this card would be
       titled `vendor.b.wallet` on a customer's screen. */
    expect(getByText('กระเป๋าเงิน')).toBeVisible();
    expect(container.textContent).not.toContain('vendor.b.wallet');
  });
});

describe('[CUSTPROV §39] a provider this dashboard has never heard of', () => {
  /* 🔴 THE ACCEPTANCE SHAPE. Two sections whose ids, labels and vocabulary look
     nothing like today's cards, hand-written as provider "B" would emit them.
     Both must render completely — and note what this file did NOT need: no new
     renderer, no new icon entry, no i18n key, no provider name anywhere. That
     is §39's claim, executed rather than asserted. */
  const providerB = view(
    {
      id: 'kyc_status', type: 'kv', label: 'สถานะยืนยันตัวตน', collapsed: false,
      badge: [{ label: 'ยังไม่ยืนยัน', tone: 'off' }],
      rows: [
        { label: 'เอกสาร', value: 'บัตรประชาชน' },
        { label: 'ความคืบหน้า', value: 2, target: 3, suffix: '(67%)' },
      ],
    },
    {
      id: 'esports_bets', type: 'amount_rows', label: 'แต้มที่ใช้เล่นกิจกรรมออนไลน์',
      rows: [{ label: 'ยอดแต้มที่ใช้รวม', value: 8800 }],
      amountRows: [{ at: '2026-09-03T09:00:00Z', amount: 120, sign: '-', status: 'rejected' }],
    },
  );

  it('both sections render, in payload order, with no front-end file added', () => {
    const { container, getByText } = mount(providerB);
    expect(cards(container).length).toBe(2);
    /* order is the payload's — §40 makes that the deliberate trade */
    expect(cards(container)[0].textContent).toContain('สถานะยืนยันตัวตน');
    expect(cards(container)[1].textContent).toContain('แต้มที่ใช้เล่นกิจกรรมออนไลน์');

    expect(getByText('บัตรประชาชน')).toBeVisible();
    expect(container.textContent).toContain('2.00/3.00');
    expect(getByText('(67%)')).toBeVisible();
    expect(getByText('ยังไม่ยืนยัน')).toBeVisible();

    expect(getByText('8,800')).toBeVisible();
    expect(getByText('-120.00')).toBeVisible();
    expect(getByText('ไม่สำเร็จ')).toBeVisible();

    /* both cards got an icon from the DEFAULT — neither id is in the map */
    expect(header(container, 0).querySelector('svg')).not.toBeNull();
    expect(header(container, 1).querySelector('svg')).not.toBeNull();
  });

  it('no view, an empty view, or a view of nothing renders an empty host, not a crash', () => {
    for (const v of [undefined, null, {} as CustomerView, view()]) {
      const { container } = render(<I18nProvider><ProfilePanelView view={v} /></I18nProvider>);
      const host = within(container).getByTestId('profile-panel-view');
      expect(host).toBeTruthy();
      expect(host.children.length).toBe(0); // no cards, and no crash either
    }
  });
});
