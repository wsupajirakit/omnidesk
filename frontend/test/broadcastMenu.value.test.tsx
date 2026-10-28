/* [FEAT-20260821-BROADCASTMENU] Broadcasts reaches the Support section
 * ===========================================================================
 * WHY THIS WAS INVISIBLE FOR SO LONG, written down so nobody repeats the hunt:
 * everything a menu normally needs was already true —
 *   · the page exists (`pages/messaging/Broadcasts.tsx` + its service + modal)
 *   · the route exists (`App.tsx`, guarded on `broadcast.manage`)
 *   · the DB row exists, `visible: true`, `required_permissions:['broadcast.manage']`
 *   · `dev` is superadmin and superadmin holds `broadcast.manage`
 *   · `GET /api/menus` really returns it — 24 menus, this one among them
 * and it still never appeared, because **MegaMenu and Sidebar do not read the
 * API's menu list at all**. Both hard-code their links and filter by permission.
 * No line in those files = nowhere to render, however complete the data is.
 * สิทธิ์ครบ · API คืนมาแล้ว · แต่เมนูเขียนตายตัว ไม่มีบรรทัด = ไม่มีที่แสดง.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const mega = read('components/common/MegaMenu.tsx');

/** The Support section block, bounded so a match cannot leak from a neighbour. */
const supportBlock = (): string => {
  const from = mega.indexOf("titleKey: 'sidebar.support'");
  expect(from).toBeGreaterThan(-1);
  const next = mega.indexOf('titleKey:', from + 20);
  return mega.slice(from, next > -1 ? next : mega.length);
};

describe('⭐ Broadcasts sits in the Support section', () => {
  it('⭐ it is inside the support block, not merely somewhere in the file', () => {
    /* owner: "เอาไว้ในหมวด support" */
    expect(supportBlock()).toContain("to: '/broadcasts'");
  });

  it('the route it points at is the one the app registers', () => {
    expect(read('App.tsx')).toContain('path="/broadcasts"');
  });
});

describe('⭐ it is shown to dev, and only with the permission too', () => {
  it('⭐ [REL-20260827-BROADCASTMENU] permission-only — the username gate is gone', () => {
    /* 27/08 เจ้าของสั่งปลดเมนูให้คนอื่นเห็น ⇒ เหลือชั้น permission ชั้นเดียว
       ⚠️ ชั้น permission ยังต้องอยู่: เช็คแค่ username แล้วไม่มีสิทธิ์ จะกดแล้วโดน
          route guard เด้งกลับ — เคส Contacts ที่เคยกัดมาแล้ว (บันทึกไว้ในบล็อก
          Legacy เหนือรายการนี้) ⇒ ถอด username ได้ แต่ห้ามถอด `has` */
    const line = supportBlock()
      .split('\n')
      .find((l) => l.includes("to: '/broadcasts'"));
    expect(line).toBeTruthy();
    expect(line).toContain("c.has('broadcast.manage')");
    expect(line).not.toContain("c.username === 'dev'");
  });

  it('it copies the Legacy entry`s shape, which solved the same problem', () => {
    const legacy = supportBlock()
      .split('\n')
      .find((l) => l.includes("to: '/legacy-ticket'"));
    expect(legacy).toContain("c.username === 'dev'");
  });
});

describe('⭐ both languages can label it', () => {
  it('⭐ every key the entry asks for exists in th and en', () => {
    const th = JSON.parse(read('i18n/translations/th.json')) as Record<string, string>;
    const en = JSON.parse(read('i18n/translations/en.json')) as Record<string, string>;
    for (const k of ['nav.broadcasts', 'megamenu.broadcast_desc']) {
      expect((th[k] ?? '').length).toBeGreaterThan(0);
      expect((en[k] ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('⭐ the icon is imported, or the file will not build', () => {
  it('Megaphone comes from lucide-react', () => {
    const head = mega.slice(0, mega.indexOf("} from 'lucide-react'"));
    expect(head).toContain('Megaphone');
  });
});
