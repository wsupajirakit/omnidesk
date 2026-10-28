/**
 * [FIX-20260829-FLEXDEFAULT] OA ที่สร้างใหม่ต้องตอบเป็นการ์ด ไม่ใช่วงเล็บดิบ
 * ===========================================================================
 * เจ้าของ 29/08: OA ที่ตอบถูกอยู่ 3 ตัวถูกตั้ง `hook_text_reply_mode: 'flex'`
 * ทีละตัวด้วยมือ เพราะหน้าเว็บไม่มีสวิตช์ให้ตั้ง ⇒ OA ใหม่ได้ `'off'` แล้วส่ง
 * `[[[customer-helper]]]` เป็นวงเล็บดิบให้ลูกค้าเห็น
 *
 * 🔴 ไฟล์นี้ตอบสองคำถามที่แยกกันเด็ดขาด และข้อสองสำคัญกว่า:
 *      1. POSITIVE — เอกสารที่ถูกสร้างใหม่ได้ `'flex'` โดยไม่มีใครตั้ง
 *      2. NEGATIVE — **แถวที่มีอยู่แล้วต้องไม่ขยับ** ไม่ว่าจะเป็น `'off'`
 *         ที่ตั้งไว้จริง หรือแถวเก่าที่ไม่มี field เลย
 *
 * 🔴 กลไกที่ทำให้ข้อ 2 จริง: mongoose ใส่ default ตอน **insert** เท่านั้น
 *    ไม่ใช่ตอนอ่าน ⇒ แถวเก่าอ่านออกมาได้ `undefined` แล้วตัวอ่าน
 *    (`resolveHookTextReplyMode`) fallback เป็น `HOOK_TEXT_REPLY_DEFAULT_MODE`
 *    ซึ่งยังเป็น `'off'` · **ค่านั้นห้ามเปลี่ยนตาม** ไม่งั้น OA เก่าทุกตัวจะ
 *    เปลี่ยนพฤติกรรมย้อนหลังพร้อมกัน — มีเคสคุมข้อนี้ไว้ด้านล่าง
 *
 * ⚠️ ไม่ต่อ mongo จริง — อ่าน default ออกจาก schema ที่ประกาศไว้ตรง ๆ และ
 *    จำลองการอ่านแถวเก่าด้วยตัวอ่านตัวจริง ไม่ใช่สำเนา
 *
 * revert: เปลี่ยน default กลับเป็น `'off'` แล้วลบไฟล์นี้
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * [FIX-20260901-OFFMENUTAG] 01/09 — THE POSITIVE HALF IS INVERTED, ON PURPOSE
 * ═══════════════════════════════════════════════════════════════════════════
 * The schema default is now `'off'` again. Everything above is still the correct
 * account of WHY it was `'flex'`; it is history, not the current value.
 *
 * 29/08 chose `'flex'` for one reason: `'off'` did not resolve
 * `[[[customer-helper]]]` or `[[link]]`, so a new OA sent raw brackets. On 01/09
 * `'off'` was taught to resolve exactly those two, plus the menu marker, so that
 * reason is spent.
 *
 * And `'flex'` became actively harmful. Measured on the live OA, both ways:
 *   `off`   the menu marker went out RAW, to the admin row AND the customer,
 *           while `[[odk_s_*]]` resolved correctly
 *   `flex`  the menu card was sent, but `[[odk_s_*]]` was DELETED — a customer
 *           was told the deposit minimum was nothing at all
 * `'flex'` routes the reply through `resolveReplyTags`, whose catch-all deletes
 * every `[[…]]`. A hook created today would land in the mode that eats amounts.
 *
 * 🔴 THE NEGATIVE HALF BELOW IS UNCHANGED AND STILL THE MORE IMPORTANT ONE.
 *    Existing rows must not move, and the read-side constant must not follow the
 *    schema. Those cases are untouched.
 */
import { HookSchema } from '../../src/modules/hooks/schemas/hook.schema';
import {
  HOOK_TEXT_REPLY_DEFAULT_MODE,
  resolveHookTextReplyMode,
} from '../../src/modules/webhook/hook-reply/hook-text-reply';

const pathDef = () =>
  HookSchema.path('hook_text_reply_mode') as unknown as {
    options: Record<string, unknown>;
    enumValues?: string[];
  };

describe('[FLEXDEFAULT] POSITIVE — OA ที่สร้างใหม่', () => {
  it('⭐⭐ 🔴 default ของ schema เป็น "off"', () => {
    /* Was `'flex'` between 29/08 and 01/09. See the header for both moves — each
       was correct when made, and neither was guarded before this file existed. */
    expect(pathDef().options['default']).toBe('off');
  });

  it('⭐⭐ enum ไม่ถูกแตะ — ทุกค่าที่เคยเก็บได้ยังถูกกฎหมาย', () => {
    /* ถ้า enum แคบลง แถวเก่าที่ถือค่านั้นจะ validate ไม่ผ่านตอนเซฟครั้งถัดไป
       แล้วหายเงียบ ๆ — เคยเกิดมาแล้วกับ webhook_logs.status */
    expect(pathDef().enumValues?.slice().sort()).toEqual([
      'button',
      'flex',
      'off',
      'strip',
    ]);
  });

  it('⭐⭐ เอกสารใหม่ที่ไม่มีใครตั้งค่า อ่านได้ "off" ผ่านตัวอ่านตัวจริง', () => {
    /* จำลอง insert: mongoose เติม default ให้ แล้ว runtime อ่านผ่านตัวนี้ */
    const fresh = { hook_text_reply_mode: pathDef().options['default'] };
    expect(resolveHookTextReplyMode(fresh)).toBe('off');
  });

  /* [FIX-20260901-OFFMENUTAG] The two defaults now AGREE, and that agreement is
     a coincidence worth stating rather than relying on: they answer different
     questions. The schema's says what to WRITE on a new row; the constant says
     how to READ a row with no value. The header above warns in capitals against
     changing the second to follow the first, and that warning still stands. */
  it('⭐⭐ the write-side and read-side defaults agree today — but are asserted apart', () => {
    expect(pathDef().options['default']).toBe('off');
    expect(HOOK_TEXT_REPLY_DEFAULT_MODE).toBe('off');
  });
});

describe('[FLEXDEFAULT] 🔴 NEGATIVE — แถวที่มีอยู่แล้วห้ามขยับ', () => {
  it('⭐⭐ 🔴 แถวเก่าที่ไม่มี field เลย ยังอ่านได้ "off"', () => {
    /* 25 แถวบน local เป็นแบบนี้ · default ของ schema ไม่ถูกใช้ตอนอ่าน */
    expect(resolveHookTextReplyMode({})).toBe('off');
    expect(resolveHookTextReplyMode({ alias: 'legacy' })).toBe('off');
  });

  it('⭐⭐ 🔴 แถวที่ตั้ง "off" ไว้จริง ยังเป็น "off"', () => {
    expect(resolveHookTextReplyMode({ hook_text_reply_mode: 'off' })).toBe(
      'off',
    );
  });

  it('⭐⭐ 🔴 ค่า fallback ตอนอ่านต้องยังเป็น "off" — ห้ามเปลี่ยนตาม default', () => {
    /* ถ้าค่านี้กลายเป็น "flex" OA เก่าทั้ง 25 ตัวจะเปลี่ยนพฤติกรรมย้อนหลังทันที
       ซึ่งตรงข้ามกับเจตนาของงานนี้ · สองค่านี้ตอบคนละคำถาม */
    expect(HOOK_TEXT_REPLY_DEFAULT_MODE).toBe('off');
  });

  it('⭐⭐ 3 OA ที่ตั้ง "flex" ไว้แล้ว ยังได้ "flex" เท่าเดิม', () => {
    expect(resolveHookTextReplyMode({ hook_text_reply_mode: 'flex' })).toBe(
      'flex',
    );
  });

  it('⭐ ค่าที่ตั้งไว้เองแบบอื่นยังถูกเคารพ ไม่ถูก default ทับ', () => {
    expect(resolveHookTextReplyMode({ hook_text_reply_mode: 'strip' })).toBe(
      'strip',
    );
    expect(resolveHookTextReplyMode({ hook_text_reply_mode: 'button' })).toBe(
      'button',
    );
  });

  it('⭐ ค่าพิมพ์ผิดยังตกเป็น "off" — default ใหม่ต้องไม่ทำให้ typo กลายเป็น flex', () => {
    /* ถ้าตัวอ่านหันไปใช้ default ของ schema เมื่อเจอค่าแปลก ๆ typo จะเปิด
       ฟีเจอร์ที่ลูกค้าเห็นโดยไม่มีใครสั่ง */
    expect(resolveHookTextReplyMode({ hook_text_reply_mode: 'FLEX' })).toBe(
      'off',
    );
    expect(resolveHookTextReplyMode({ hook_text_reply_mode: 'fl3x' })).toBe(
      'off',
    );
    expect(resolveHookTextReplyMode({ hook_text_reply_mode: true })).toBe(
      'off',
    );
    expect(resolveHookTextReplyMode({ hook_text_reply_mode: null })).toBe(
      'off',
    );
  });
});
