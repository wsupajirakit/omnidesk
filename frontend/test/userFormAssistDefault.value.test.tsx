/* [FIX-20260823-ASSISTDEFAULT] ค่าตั้งต้นของ checkbox เมื่อเลือก role
 * ============================================================================
 * เจ้าของสั่ง 23/08/2026: "default checkbox สิทธิ์ของ assist admin เวลาสร้าง
 * ให้เหลือแค่ 3 อันนี้เท่านั้น" — จัดการงาน (แชท) · รายงานเชิงลึก · ประวัติจ่ายงาน
 *
 * เทสนี้เรียก `seedPermissionsForRole` ซึ่งเป็น **ตรรกะตัวเดียวกับที่ฟอร์มใช้จริง**
 * (handleChange เรียกฟังก์ชันนี้) ไม่ใช่ตรรกะที่เทสเลียนแบบไว้เอง
 *
 * ⚠️ ขอบเขตที่เทสนี้ตรึงไว้ด้วย: role อื่นต้อง **ไม่เปลี่ยนพฤติกรรม** แม้แต่ตัวเดียว
 */
import { describe, it, expect } from 'vitest';
import { seedPermissionsForRole } from '../components/admin/UserFormModal';

/** role assist_admin ของจริงตาม acl-seed.data.ts:331-343 — 9 สิทธิ์ */
const ASSIST_ADMIN = {
  name: 'assist_admin',
  permissions: [
    'role.manage',
    'menu.manage',
    'hook.manage',
    'broadcast.manage',
    'auto_reply.manage',
    'config.manage',
    'ticket.manage',
    'insight.manage',
    'assign_history.manage',
  ],
};

const THE_THREE = ['ticket.manage', 'insight.manage', 'assign_history.manage'];

describe('[ASSISTDEFAULT] assist_admin ติ๊กมาแค่ 3 ช่อง', () => {
  it('คนทั่วไปเปิดฟอร์ม → ได้ 3 ตัวนี้เท่านั้น', () => {
    expect(seedPermissionsForRole(ASSIST_ADMIN, false).sort()).toEqual(
      [...THE_THREE].sort(),
    );
  });

  it('⭐ dev เปิดฟอร์ม → ก็ยังได้ 3 ตัวเท่ากัน (เดิม dev จะได้ 5)', () => {
    // ก่อนแก้: DEV_TICKABLE ปลดล็อก auto_reply/broadcast ⇒ dev เห็นติ๊กมา 5 ตัว
    // ⇒ ค่าเริ่มต้นไม่เท่ากันแล้วแต่ว่าใครเปิดฟอร์ม ซึ่งคือสิ่งที่งานนี้แก้
    expect(seedPermissionsForRole(ASSIST_ADMIN, true).sort()).toEqual(
      [...THE_THREE].sort(),
    );
    expect(seedPermissionsForRole(ASSIST_ADMIN, true)).not.toContain(
      'auto_reply.manage',
    );
    expect(seedPermissionsForRole(ASSIST_ADMIN, true)).not.toContain(
      'broadcast.manage',
    );
  });

  it('ไม่ดันสิทธิ์ที่ฟอร์มมองไม่เห็นเข้ามา (role.manage / menu.manage)', () => {
    const seeded = seedPermissionsForRole(ASSIST_ADMIN, true);
    expect(seeded).not.toContain('role.manage');
    expect(seeded).not.toContain('menu.manage');
  });
});

describe('[ASSISTDEFAULT] ⭐ role อื่นต้องไม่เปลี่ยนพฤติกรรมเลย', () => {
  /** role สมมติที่ไม่มีในแมพ — ต้อง seed จากสิทธิ์ของตัวเองเหมือนเดิม */
  const OPERATOR = {
    name: 'operator',
    permissions: ['hook.manage', 'ticket.manage', 'role.manage'],
  };

  it('role ที่ไม่มีในแมพ → seed จากสิทธิ์ของ role นั้นเหมือนเดิม', () => {
    // role.manage ถูกกรองออกเพราะฟอร์มไม่แสดง — พฤติกรรมเดิมทุกประการ
    expect(seedPermissionsForRole(OPERATOR, false).sort()).toEqual(
      ['hook.manage', 'ticket.manage'].sort(),
    );
  });

  it('role ที่ไม่มีในแมพ + dev → ยังได้ DEV_TICKABLE เหมือนเดิม', () => {
    /* [REL-20260827-BROADCASTMENU] `broadcast.manage` ออกจาก DEV_TICKABLE แล้ว
       (เป็นสิทธิ์ปกติ) ⇒ ทุกคนได้ติ๊ก ไม่ใช่แค่ dev · `auto_reply.manage`
       ยังอยู่ในชุด dev-only เหมือนเดิม — เจ้าของย้ำ "auto reply ไม่เกี่ยว" */
    const DEVROLE = {
      name: 'operator',
      permissions: ['hook.manage', 'auto_reply.manage', 'broadcast.manage'],
    };
    expect(seedPermissionsForRole(DEVROLE, true).sort()).toEqual(
      ['auto_reply.manage', 'broadcast.manage', 'hook.manage'].sort(),
    );
    // คนที่ไม่ใช่ dev ยังไม่ได้ auto_reply แต่ได้ broadcast แล้ว
    expect(seedPermissionsForRole(DEVROLE, false).sort()).toEqual(
      ['broadcast.manage', 'hook.manage'].sort(),
    );
  });

  it('ไม่เจอ role (undefined) → ไม่ติ๊กอะไรเลย ไม่พัง', () => {
    expect(seedPermissionsForRole(undefined, false)).toEqual([]);
    expect(seedPermissionsForRole({ name: 'x' }, false)).toEqual([]);
  });
});

/* [FIX-20260824-ADMINCONFIGDEFAULT] role `admin` must not arrive with
 * "ตั้งค่าระบบ" already ticked.
 * ============================================================================
 * Owner, 24/08/2026, pointing at the create-user modal: the System Config box is
 * checked the moment `admin` is selected, and it should not be.
 *
 * ⚠️ THE PERMISSION IS `config.manage`, NOT `system.manage`. The two are easy to
 * confuse — the owner's words were "system manage" and an earlier reading took
 * them literally — but `system.manage` is already in UNEDITABLE_PERMISSIONS and
 * never renders a checkbox at all. The box in the screenshot is the menu
 * "System Config", whose `required_permissions` is `['config.manage']`
 * (verified against the live `menus` collection, and against
 * `acl-seed.data.ts:135`). Its Thai label is "ตั้งค่าระบบ".
 *
 * WHY IT WAS TICKED: `admin` has no entry in ROLE_DEFAULT_PERMISSIONS, so
 * seeding falls back to the role's own permission list, and `config.manage` is
 * on it (`acl-seed.data.ts:267`).
 *
 * ⚠️ SCOPE: this changes what arrives TICKED. It does not remove the capability
 * — the checkbox is still there and an operator can still tick it deliberately.
 * Whether the role should keep the permission at all is a separate question,
 * and a seed change, and is not decided here.
 */

/** role admin ของจริงตาม acl-seed.data.ts:254-278 — 19 สิทธิ์ */
const ADMIN = {
  name: 'admin',
  permissions: [
    'system.manage', 'user.manage', 'role.manage', 'menu.manage',
    'hook.manage', 'webhook_log.manage', 'broadcast.manage',
    'auto_reply.manage', 'group.manage', 'audit.manage', 'config.manage',
    'ticket.manage', 'insight.manage', 'assign_history.manage', 'slip.manage',
    'flex.manage', 'dynamic_tags.manage', 'custom_tools.manage',
    'object.manage',
  ],
};

describe('[ADMINCONFIGDEFAULT] admin ไม่ติ๊ก "ตั้งค่าระบบ" มาให้', () => {
  it('⭐ (T1 TARGET) config.manage ต้องไม่อยู่ในชุดที่ติ๊กมา', () => {
    expect(seedPermissionsForRole(ADMIN, false)).not.toContain('config.manage');
  });

  it('⭐ (T2 TARGET) dev เปิดฟอร์มก็ต้องไม่ติ๊กเหมือนกัน', () => {
    // DEV_TICKABLE unlocks other permissions for dev; it must not smuggle this
    // one back in through that door.
    expect(seedPermissionsForRole(ADMIN, true)).not.toContain('config.manage');
  });

  it('⭐ (P1 PIN) ทุกสิทธิ์อื่นของ admin ยังติ๊กมาเหมือนเดิม', () => {
    // The change must remove exactly one box, not quietly narrow the role.
    const seeded = seedPermissionsForRole(ADMIN, false);
    for (const p of [
      'user.manage', 'hook.manage', 'group.manage', 'audit.manage',
      'ticket.manage', 'insight.manage', 'assign_history.manage',
      'slip.manage', 'flex.manage', 'dynamic_tags.manage',
      'custom_tools.manage', 'object.manage', 'webhook_log.manage',
    ]) {
      expect({ p, ticked: seeded.includes(p) }).toEqual({ p, ticked: true });
    }
  });

  it('(P2 PIN) สิทธิ์ที่ซ่อนอยู่แล้วยังซ่อนเหมือนเดิม', () => {
    const seeded = seedPermissionsForRole(ADMIN, false);
    // these have never been checkboxes; the new rule must not resurrect them
    expect(seeded).not.toContain('system.manage');
    expect(seeded).not.toContain('menu.manage');
    expect(seeded).not.toContain('role.manage');
  });

  it('⭐ (P3 PIN) role อื่นไม่ถูกแตะ — assist_admin ยังได้ 3 ตัวเท่าเดิม', () => {
    expect(seedPermissionsForRole(ASSIST_ADMIN, false).sort()).toEqual(
      [...THE_THREE].sort(),
    );
  });

  it('(P4 PIN) role ที่ไม่รู้จักยัง seed จากสิทธิ์ของตัวเองตามเดิม', () => {
    const other = { name: 'operator', permissions: ['ticket.manage', 'config.manage'] };
    // `operator` is not in the exclusion map, so its own list still decides —
    // including config.manage. The new rule is per-role, not global.
    expect(seedPermissionsForRole(other, false)).toContain('config.manage');
  });
});
