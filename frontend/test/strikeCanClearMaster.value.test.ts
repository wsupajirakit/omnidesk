/**
 * [FIX-2708-STRIKESUPERADMIN] superadmin เห็น/ใช้ปุ่ม strike ได้ทันที ไม่ต้องติ๊ก
 * ===========================================================================
 * เจ้าของ 27/08: *"ถ้าเป็น role superadmin จะได้สิทธิ์ทันที ไม่ว่ามี perm หรือไม่"*
 *
 * ความจริงฝั่ง BE (dive แล้ว): ประตูนี้เปิดอยู่แล้ว —
 *   · role superadmin ถือ `system.manage` (DB จริง)
 *   · token ของ superadmin ใช้ permissions ของ ROLE (`resolvePermissions`)
 *   · `PermissionsGuard.OVERRIDE_PERMISSIONS = ['system.manage','*']` ผ่านทุกด่าน
 * ⇒ ที่พังคือ FE อย่างเดียว: จุดคำนวณ canClear เช็ค `includes('strike.manage')`
 * ตรง ๆ ไม่รู้จัก master key — ปุ่มเลยหายทั้งที่ BE อนุญาต
 *
 * ทางแก้ no-debt: ใช้ `permAllows` (MegaMenu) — helper ที่ mirror กติกา guard
 * อยู่แล้ว และประวัติของมันบันทึกไว้เองว่า role-name bypass ถูกถอดโดยตั้งใจ
 * (คีย์ที่ permission ไม่ใช่ชื่อ role) ⇒ superadmin ผ่านเพราะ role ถือ
 * system.manage — ตรงเจตนา "ได้สิทธิ์ทันที" โดยไม่สร้างกติกาที่สอง
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { permAllows } from '../components/common/MegaMenu';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');
const ticketChat = ticketChatSource();

describe('[STRIKESUPERADMIN] master key เปิดปุ่ม strike', () => {
  it('⭐ system.manage / * ผ่าน strike.manage — กติกาเดียวกับ guard ฝั่ง BE', () => {
    expect(permAllows(['system.manage'], 'strike.manage')).toBe(true);
    expect(permAllows(['*'], 'strike.manage')).toBe(true);
    expect(permAllows(['strike.manage'], 'strike.manage')).toBe(true);
    expect(permAllows(['ticket.manage'], 'strike.manage')).toBe(false);
    expect(permAllows([], 'strike.manage')).toBe(false);
  });

  it('⭐⭐ ทั้งสองจุดที่คำนวณ canClear ต้องถามผ่าน permAllows — ห้าม includes เปลือย', () => {
    /* [FEAT-2708-TRAYNOCLEAR] จุดของ App (ถาด) ถูกถอดทั้งจุด — ถาดไม่มีปุ่ม
       เคลียร์แล้ว สิทธิ์จึงไม่ไหลไปที่มันอีก · จุดเดียวที่เหลือ = TicketChat
       (modal จาก avatar) และต้องถามผ่าน permAllows เท่านั้น */
    expect(ticketChat).toMatch(/permAllows\(\s*getStoredAuth\(\)\?\.permissions[\s\S]{0,40}'strike\.manage',?\s*\)/);
    expect(app).not.toContain("'strike.manage'");
    expect(ticketChat).not.toMatch(/permissions\?\.includes\(\s*'strike\.manage',?\s*\)/);
  });
});
