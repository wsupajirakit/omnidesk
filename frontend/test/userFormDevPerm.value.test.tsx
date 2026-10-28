/* [FEAT-20260811-DEVONLYPERM] · [REL-20260827-BROADCASTMENU]
 *
 * The grant side of the menu gate, and it now splits the same way the menus do:
 *   `auto_reply.manage`  — still uneditable for everyone except dev/dev2
 *   `broadcast.manage`   — RELEASED 27/08/2026: a normal, tickable permission
 *
 * 🔴 WHY THE RELEASE HAD TO TOUCH THIS FILE AT ALL, not just the sidebar:
 * un-hiding the menu without this would have shipped a menu nobody could be
 * granted — `broadcast.manage` was in UNEDITABLE_PERMISSIONS, so no admin could
 * tick it for anyone, and the sidebar's permission half would keep hiding it.
 * ปลดเมนูอย่างเดียวไม่พอ ต้องปลดสิทธิ์ให้ติ๊กได้ด้วย ไม่งั้นไม่มีใครได้สิทธิ์ไปเปิด */
import { describe, it, expect } from 'vitest';
import { isUneditablePermission } from '../components/admin/UserFormModal';

describe('[DEVONLYPERM] auto_reply stays dev-only, broadcast is released', () => {
  it('🔴 auto_reply: non-dev operator still cannot tick it', () => {
    expect(isUneditablePermission('auto_reply.manage', false)).toBe(true);
  });
  it('auto_reply: dev operator can tick it', () => {
    expect(isUneditablePermission('auto_reply.manage', true)).toBe(false);
  });
  it('⭐ [REL] broadcast: ANY operator can tick it now, dev or not', () => {
    expect(isUneditablePermission('broadcast.manage', false)).toBe(false);
    expect(isUneditablePermission('broadcast.manage', true)).toBe(false);
  });
  it('⭐ [REL] the legacy label form is released too', () => {
    /* ชุด uneditable เก็บชื่อไว้สองแบบ (`broadcast.manage` กับ `Broadcast`)
       — ถอดออกแค่แบบเดียวจะกลายเป็นปลดครึ่งเดียว แล้วแต่ว่า role ส่งชื่อไหนมา */
    expect(isUneditablePermission('Broadcast', false)).toBe(false);
  });
  it('dev override does NOT leak to other uneditable perms', () => {
    // system.manage / role.manage stay uneditable even for dev
    expect(isUneditablePermission('system.manage', true)).toBe(true);
    expect(isUneditablePermission('role.manage', true)).toBe(true);
  });
  it('a normal permission is always editable', () => {
    expect(isUneditablePermission('hook.manage', false)).toBe(false);
    expect(isUneditablePermission('hook.manage', true)).toBe(false);
  });
});
