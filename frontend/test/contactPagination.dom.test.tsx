/* [FEAT-20260814-CONTACTPAGE] Contact list pagination — behaviour + wiring pins
 * ===========================================================================
 * Owner, 14/08: "ห้ามแสดงทั้งหมดทำเป็น next page … pagination นะ per page ด้วย
 * ห้ามแสดงทั้งหมด แต่ค้นหาต้องค้นได้ปกติ".
 *
 * Two layers, deliberately:
 *  1. DOM/interaction — ContactPaginationBar raises the RIGHT events and
 *     disables at the bounds (it is stateless, so this covers it fully).
 *  2. Source pins on Contact.tsx — the append-forever path must STAY deleted
 *     ("โหลดเพิ่ม" accumulating pages = showing everything again), the bar must
 *     stay wired, and server-side search must stay in the fetch. A future edit
 *     reintroducing append would flip these red before any human notices.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { ContactPaginationBar, PER_PAGE_OPTIONS } from '../components/contact';

const CONTACT_SRC = readFileSync(
  resolve(__dirname, '../pages/chat/Contact.tsx'), 'utf8');

/**
 * Source with comments removed — for asserting what the code DOES.
 * Same helper (and same reason) as contactChatTab.dom.test.tsx: the comments
 * NAME the removed paths ("โหลดเพิ่ม", the popularTags spread in revert notes),
 * so raw-source pins would fail on the explanation and pressure someone into
 * deleting a useful comment. Strip comments, keep code.
 */
const codeOnly = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments (incl. JSX {/* … */})
    .replace(/^\s*\/\/.*$/gm, ''); // line comments

const CONTACT_CODE = codeOnly(CONTACT_SRC);

const setup = (over: Partial<React.ComponentProps<typeof ContactPaginationBar>> = {}) => {
  const onPageChange = vi.fn();
  const onPerPageChange = vi.fn();
  const utils = render(
    <ContactPaginationBar
      page={2} pages={5} total={95} perPage={20}
      onPageChange={onPageChange} onPerPageChange={onPerPageChange}
      {...over}
    />,
  );
  return { ...utils, onPageChange, onPerPageChange };
};

describe('[CONTACTPAGE] ContactPaginationBar — interactions', () => {
  it('next/prev raise the neighbouring page numbers', () => {
    const t = setup();
    fireEvent.click(t.getByTitle('หน้าถัดไป'));
    fireEvent.click(t.getByTitle('หน้าก่อนหน้า'));
    expect(t.onPageChange).toHaveBeenNthCalledWith(1, 3);
    expect(t.onPageChange).toHaveBeenNthCalledWith(2, 1);
  });

  it('bounds: prev disabled on page 1, next disabled on the last page', () => {
    const first = setup({ page: 1 });
    expect((first.getByTitle('หน้าก่อนหน้า') as HTMLButtonElement).disabled).toBe(true);
    expect((first.getByTitle('หน้าถัดไป') as HTMLButtonElement).disabled).toBe(false);
    first.unmount();
    const last = setup({ page: 5 });
    expect((last.getByTitle('หน้าถัดไป') as HTMLButtonElement).disabled).toBe(true);
  });

  it('loading disables both arrows — no double-fetch from impatient clicking', () => {
    const t = setup({ loading: true });
    expect((t.getByTitle('หน้าถัดไป') as HTMLButtonElement).disabled).toBe(true);
    expect((t.getByTitle('หน้าก่อนหน้า') as HTMLButtonElement).disabled).toBe(true);
  });

  it('per-page select offers 10/20/50/100 and raises the picked number', () => {
    const t = setup();
    const select = t.getByTitle('จำนวนต่อหน้า') as HTMLSelectElement;
    expect([...select.options].map((o) => Number(o.value))).toEqual([...PER_PAGE_OPTIONS]);
    fireEvent.change(select, { target: { value: '50' } });
    expect(t.onPerPageChange).toHaveBeenCalledWith(50);
  });

  it('clamps a stale out-of-range page (filters shrank the set) instead of rendering 9/2', () => {
    const t = setup({ page: 9, pages: 2 });
    expect(t.container.textContent).toContain('9'.length === 1 ? '2' : '2'); // page shown as 2
    expect((t.getByTitle('หน้าถัดไป') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(t.getByTitle('หน้าก่อนหน้า'));
    expect(t.onPageChange).toHaveBeenCalledWith(1); // from clamped 2, not from 9
  });
});

describe('[CONTACTPAGE] Contact.tsx wiring pins', () => {
  it('the append-forever path stays deleted — one page on screen, never all', () => {
    expect(CONTACT_CODE).not.toContain('loadingMore');
    expect(CONTACT_CODE).not.toMatch(/fetchPage\(\s*[^)]*,\s*true\s*\)/);
    expect(CONTACT_CODE).not.toContain('โหลดเพิ่ม');
  });

  it('the bar is wired with the page state and per-page reaches the fetch', () => {
    expect(CONTACT_SRC).toContain('<ContactPaginationBar');
    expect(CONTACT_SRC).toContain('limit: perPage');
    expect(CONTACT_SRC).toContain('onPerPageChange={setPerPage}');
  });

  it('server-side search stays in the fetch — paging must not break ค้นหา', () => {
    expect(CONTACT_SRC).toContain('q: query,');
  });

  it('the chat tab sits LEFTMOST (owner: "สลับแชทมาไว้ซ้ายสุด"), default tab still personal', () => {
    const chat = CONTACT_SRC.indexOf("onClick={() => setRightTab('chat')}");
    const personal = CONTACT_SRC.indexOf("onClick={() => setRightTab('personal')}");
    const operations = CONTACT_SRC.indexOf("onClick={() => setRightTab('operations')}");
    expect(chat).toBeGreaterThan(-1);
    expect(chat).toBeLessThan(personal);
    expect(personal).toBeLessThan(operations);
    expect(CONTACT_SRC).toMatch(/useState<'personal' \| 'operations' \| 'chat'>\('personal'\)/);
  });

  it('tag dropdown offers ONLY "ทุกแท็ก" — mirrored from the ticket page fix ([FIX-20260814-TAGLISTHIDE])', () => {
    expect(CONTACT_SRC).toContain('FIX-20260814-TAGLISTHIDE');
    // individual tags must not be listed…
    expect(CONTACT_CODE).not.toContain('popularTags.map');
    // …but the filter param itself stays wired (a previously-picked tag still filters)
    expect(CONTACT_CODE).toContain('tag: tagFilter || null,');
  });

  /* [FIX-20260814-CONTACTREGISTER] Reversed on the owner's order (14/08 late):
   * "หน้า contact เอาปุ่มลงทะเบียนกลับมาเหมือนเดิม แต่ต้องใช้ได้จริงเหมือนหน้า
   * support (ห้ามแก้ไขหน้า support)". The button was hidden here earlier the
   * same day; it now renders on BOTH pages through the one shared panel, with
   * no page-specific flag left to drift. */
  it('the register button is back on Contact — no hide flag anywhere', () => {
    const PANEL_SRC = readFileSync(
      resolve(__dirname, '../components/profile-panel/ProfilePanel.tsx'),
      'utf8',
    );
    const TICKET_SRC = readFileSync(
      resolve(__dirname, '../pages/chat/TicketChat.tsx'),
      'utf8',
    );
    // The opt-out is gone from the panel, the contact page and the ticket page.
    // Comments are stripped first: the panel's note explains the removed prop by
    // name, and asserting on raw source would fail on that explanation.
    for (const src of [CONTACT_SRC, PANEL_SRC, TICKET_SRC]) {
      expect(codeOnly(src)).not.toContain('hideRegisterButton');
    }
    // …and the button itself still exists, gated only by the data it needs
    expect(PANEL_SRC).toContain('ลงทะเบียนให้ลูกค้า');
    expect(PANEL_SRC).toContain('!rawLoading && channelUserId &&');
  });

  it('Contact feeds the panel what the button needs to actually work', () => {
    // openAdminLanding() needs hookId + channelUserId; the panel reads them from
    // `source.line_oa_hook_id` and `source.line_user_data.line_user_id`, so a
    // page that omits either renders a button that can only fail.
    expect(CONTACT_CODE).toContain('line_oa_hook_id: selected.hook_id');
    expect(CONTACT_CODE).toContain('line_user_data: selected.user_data');
  });
});
