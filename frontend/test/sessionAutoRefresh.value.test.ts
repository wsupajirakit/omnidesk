import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ==== [FIX-20260810-AUTOREFRESH] ====
 *
 * อาการที่เจ้าของแจ้ง: "login หลุดต้องล็อคอินใหม่ (มี modal ปุ่มเด้ง จำข้อความไม่ได้)"
 *
 * ต้นเหตุ: `JWT_EXPIRES_IN=1h` และ cookie ตายพร้อม token · BE มี
 * `/api/auth/refresh` และ FE มี `authService.refresh()` อยู่แล้ว แต่ถูกเรียกที่
 * เดียวคือ `pages/admin/Groups.tsx` ⇒ ไม่มี auto-refresh ทั้งแอป ⇒ ครบ 1 ชม.
 * modal เด้งเสมอ
 *
 * เทสนี้อ่าน source เพราะ timer + session อยู่ใน App.tsx (component ~2,700 บรรทัด
 * ที่ mount ไม่ได้ถ้าไม่มี router/i18n/network ครบ) สิ่งที่ assert คือสิ่งที่ fix
 * เปลี่ยนจริง ๆ
 * ⚠️ ตัดคอมเมนต์ออกก่อน assert เสมอ — บทเรียนรอบก่อน: เทสอ่าน source เคยไป
 *    แมตช์ประโยคในคอมเมนต์ที่อธิบายของเดิม แล้วเขียว/แดงผิดตัว
 */

const APP = join(__dirname, '..', 'App.tsx');

/** source ที่ตัดคอมเมนต์ออกแล้ว — assert จับได้เฉพาะโค้ดจริง */
function codeOnly(): string {
  return readFileSync(APP, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('[FIX-20260810-AUTOREFRESH] session ต่ออายุเองก่อนหมดอายุ', () => {
  const code = codeOnly();

  it('เรียก authService.refresh() ใน session timer', () => {
    // ของเดิม timer ทำอย่างเดียวคือเด้ง modal — ตอนนี้ต้องลองต่ออายุก่อน
    expect(code).toContain('authService\n        .refresh()');
  });

  it('ตื่นก่อนหมดอายุ ไม่ใช่รอจนหมดอายุแล้วค่อยทำ', () => {
    expect(code).toContain('remaining - SESSION_REFRESH_LEAD_MS');
    // ของเดิมตั้ง timer ยาวเท่า remaining แล้วเด้ง modal ทันที
    expect(code).not.toContain(
      'setTimeout(handleSessionTimeout, remaining)',
    );
  });

  it('lead time เป็นบวกและสมเหตุสมผล (ไม่ยาวกว่าอายุ token 1 ชม.)', () => {
    const m = code.match(/SESSION_REFRESH_LEAD_MS = ([^;]+);/);
    expect(m).toBeTruthy();
    // eslint-disable-next-line no-eval
    const ms = eval(m![1]!) as number;
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(60 * 60 * 1000);
  });

  it('กันติดลบเมื่ออายุที่เหลือสั้นกว่า lead time', () => {
    // token อายุสั้นกว่า 5 นาที ⇒ ต้องต่ออายุทันที ไม่ใช่ตั้ง timer ค่าติดลบ
    expect(code).toContain('Math.max(0, remaining - SESSION_REFRESH_LEAD_MS)');
  });

  it('refresh สำเร็จ ⇒ เขียน authState ใหม่ (timer รอบถัดไปตั้งเอง)', () => {
    expect(code).toContain('setAuthState(next)');
  });

  it('refresh ล้มเหลว ⇒ เด้ง modal เหมือนเดิม ไม่ retry เงียบ ๆ', () => {
    // 401 จาก token_version bump ตั้งใจให้ session ตาย การ retry = พยายามอยู่ต่อ
    // ทั้งที่ถูกตัดสิทธิ์แล้ว
    expect(code).toContain('.catch(() => {');
    expect(code).toContain('handleSessionTimeout();');
  });

  it('ทิ้งผลลัพธ์ถ้า effect ถูก cleanup ระหว่างรอ refresh', () => {
    // กัน setState หลัง unmount และกันเขียนทับ session ใหม่ที่เพิ่ง login
    expect(code).toContain('let cancelled = false;');
    expect(code).toContain('cancelled = true;');
    // ต้อง guard **ทั้งสองทาง** — สำเร็จก็เขียนทับได้ ล้มเหลวก็เด้ง modal ทับได้
    // (เช็กเป็นคู่ ไม่ใช่นับรวม ไม่งั้นเอา guard ฝั่ง success ออกแล้วยังเขียว)
    expect(code).toContain('if (cancelled) return;\n          setAuthState(next);');
    expect(code).toContain(
      'if (cancelled) return;\n          handleSessionTimeout();',
    );
  });

  it('ยังเคลียร์ timer ตอน cleanup (กัน timer ค้างซ้อนกัน)', () => {
    expect(code).toContain('window.clearTimeout(timeout)');
  });

  it('ไม่แตะเส้น 401 เดิม — auth:invalid ยังทำงานคู่กัน', () => {
    // สองเส้นนี้กันคนละเคส: timer = หมดอายุตามเวลา · auth:invalid = 401 จาก API
    expect(code).toContain("window.addEventListener('auth:invalid'");
  });
});
