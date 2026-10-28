/* [FEAT-20260811-DEVONLYMENU] · [REL-20260827-BROADCASTMENU]
 *
 * TWO MENUS, TWO RULES NOW — that split is the whole point of this file:
 *   auto-replies : still DEV-ONLY (username dev/dev2 AND `auto_reply.manage`)
 *   broadcasts   : RELEASED 27/08/2026 — permission-only, like every other menu
 *
 * เจ้าของสั่ง 27/08: "ปลดเมนู boardcast ให้เห็นกับคนอื่นด้วย" และย้ำแยกไว้ว่า
 * "auto reply ไม่เกี่ยว" ⇒ ปลดตัวเดียว อีกตัวคงเดิม
 *
 * 🔴 ทำไมเทสสองชุดนี้ต้องแยกกันชัด ๆ ไม่ใช่ยุบเป็นชุดเดียว: ทั้งคู่เคยถูกล็อกด้วย
 * บรรทัดเดียวกัน (`isDevUser &&`) — ถ้าเขียนรวมกันต่อไป วันหนึ่งมีคนลบ `isDevUser`
 * ของ auto-reply ทิ้งโดยไม่ตั้งใจแล้วไม่มีอะไรแดง เพราะเทสพูดถึง "ทั้งสองตัว"
 * เหมือนกันหมด ⇒ แยกให้เมนูละชุด แต่ละชุดพังได้เองโดยไม่ลากอีกตัวไปด้วย */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('../services/authStorage', () => ({
  getStoredAuth: () => ({ role: { name: 'superadmin' } }),
}));

import { Sidebar } from '../components/common/Sidebar';
import { I18nProvider } from '../i18n';

const mount = (username: string, permissions: string[]) =>
  render(
    <I18nProvider>
      <MemoryRouter>
        <Sidebar
          isDesktopOpen toggleDesktop={() => {}} isMobileOpen={false}
          closeMobile={() => {}} onLogout={() => {}} siteName="X"
          permissions={permissions} username={username}
        />
      </MemoryRouter>
    </I18nProvider>,
  );

const links = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('a')).map((a) => a.getAttribute('to') || a.getAttribute('href') || '');

describe('[DEVONLYMENU] auto-reply + broadcast visibility', () => {
  it('dev WITH the grants sees both', () => {
    const { container } = mount('dev', ['auto_reply.manage', 'broadcast.manage']);
    // assert by route target, not label (labels are i18n — th by default here)
    expect(links(container).some((l) => l.includes('/auto-replies'))).toBe(true);
    expect(links(container).some((l) => l.includes('/broadcasts'))).toBe(true);
  });

  it('🔴 a permissioned NON-dev admin still sees NO auto-replies (username gate holds)', () => {
    const { container } = mount('admin', ['auto_reply.manage', 'broadcast.manage']);
    expect(links(container).some((l) => l.includes('/auto-replies'))).toBe(false);
  });

  it('⭐ [REL] a permissioned NON-dev admin DOES see broadcasts now', () => {
    const { container } = mount('admin', ['broadcast.manage']);
    expect(links(container).some((l) => l.includes('/broadcasts'))).toBe(true);
  });

  it('⭐ [REL] broadcasts is permission-only — no permission, no menu', () => {
    /* ปลด username gate ไม่ได้แปลว่าเปิดให้ทุกคน — ชั้น permission ยังคุมอยู่
       ถ้าข้อนี้แดง แปลว่ามีคนลบ `hasPermission` ทิ้งไปด้วย = เมนูโผล่กับทุกคน */
    const { container } = mount('admin', []);
    expect(links(container).some((l) => l.includes('/broadcasts'))).toBe(false);
  });

  it('dev WITHOUT the grant sees NEITHER (permission half still applies)', () => {
    const { container } = mount('dev', []);
    expect(links(container).some((l) => l.includes('/auto-replies'))).toBe(false);
    expect(links(container).some((l) => l.includes('/broadcasts'))).toBe(false);
  });

  it('dev2 is treated like dev (auto-replies)', () => {
    const { container } = mount('dev2', ['auto_reply.manage']);
    expect(links(container).some((l) => l.includes('/auto-replies'))).toBe(true);
  });
});
