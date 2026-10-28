/* [FIX-20260830-CLAIMRACEGUARD] กล่อง "งานนี้ถูกรับไปแล้ว" ต้องเปิดได้จริง
 * ============================================================================
 * 🔴 บั๊กที่ไฟล์นี้เกิดมาเพื่อกัน — กล่องมีอยู่ แต่ **เปิดไม่ได้เลยสักครั้ง**
 *
 *   `TicketSupport.tsx` มีกล่อง `ticketTakenModal` พร้อมปุ่มเดียวคือ "รีเฟรชทันที"
 *   (i18n ครบทั้ง th/en) มาตั้งแต่ต้น แต่จุดเดียวที่สั่งเปิดคือสาขา
 *       `if (updateRes.success === false && errMsg === 'Ticket already accepted')`
 *   ซึ่ง **ไปไม่ถึงตลอดกาล** เพราะ `handleApiResponse` (services/apiClient.ts:55-57)
 *   `throw` ทันทีเมื่อ `!response.ok` ⇒ 409 ไม่เคยกลายเป็นค่า `updateRes`
 *   ⇒ ของจริงตกไปที่ `catch` แล้วขึ้นข้อความรวม "ไม่สามารถบันทึกได้ กรุณาลองใหม่"
 *     ซึ่งชวนให้กดซ้ำ ทั้งที่เคสถูกคนอื่นรับไปแล้ว กดกี่ครั้งก็ไม่มีวันผ่าน
 *
 * ⚠️ เทสที่จำลองเฉพาะ "ตรรกะ" จับบั๊กนี้ไม่ได้ เพราะตรรกะถูกอยู่แล้ว — ที่พังคือ
 *    **สายไฟ** (มันถูกต่อไว้กับสาขาที่ตายแล้ว) ⇒ ข้อ 2 ของไฟล์นี้จึงอ่าน
 *    ซอร์สจริงมาตรวจ ไม่ใช่ทดสอบสำเนาของตรรกะ (dev-local §14: ลิสต์จริงเท่านั้น)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPPORT = resolve(HERE, '../pages/chat/TicketSupport.tsx');
const src = readFileSync(SUPPORT, 'utf8');

/* ── 1. ตรรกะแยกเหตุผล — ต้องคัดให้ตรงกับที่อยู่ในไฟล์จริง (ข้อ 2 เฝ้าให้) */
const isTaken = (e: { message?: string }) =>
  /ถูกรับไปแล้วโดยแอดมินท่านอื่น/.test(e?.message || '');

describe('[CLAIMRACEGUARD] แยก "ถูกแย่ง" ออกจากความผิดพลาดอื่น', () => {
  it('⭐ ข้อความจาก BE ตอนถูกแย่ง → ต้องเข้าเส้นกล่อง "ถูกรับไปแล้ว"', () => {
    // ข้อความนี้ถูกตรึงด้วย golden suite ฝั่ง BE ห้ามเปลี่ยนคำ
    expect(
      isTaken({
        message: 'เคสนี้ถูกรับไปแล้วโดยแอดมินท่านอื่น กรุณากดรับเคสต่ออีกครั้ง',
      }),
    ).toBe(true);
  });

  it('⭐ "เคสถูกปิดไปแล้ว" → ต้อง **ไม่** เข้าเส้นนี้ (คนละการกระทำบนหน้าจอ)', () => {
    expect(isTaken({ message: 'เคสนี้ถูกปิดไปแล้ว เคลม/รับไม่ได้' })).toBe(
      false,
    );
  });

  it('network error ธรรมดา → ไม่เข้าเส้นนี้ ต้องได้ข้อความ error ปกติ', () => {
    expect(isTaken({ message: 'Failed to fetch' })).toBe(false);
  });

  it("⭐⭐ 'Ticket already accepted' (409 คนละเรื่อง) → ต้อง **ไม่** ขึ้นกล่องถูกแย่ง", () => {
    /* 🔴 เคยพลาดมาแล้วในงานนี้เอง: regex เดิมมี `|already accepted` ⇒ จับ 409 ตัวนี้ด้วย
       ซึ่ง BE เด้งตอน **เจ้าของคนเดิม** ถูก assign ซ้ำบนตั๋วที่รับไปแล้ว
       (tickets.service.ts:1573-1581) ⇒ ผู้ใช้จะเห็น "มีแอดมินท่านอื่นรับไปแล้ว"
       ทั้งที่ไม่มีใครแย่ง · reviewer จับได้ก่อน merge */
    expect(isTaken({ message: 'Ticket already accepted' })).toBe(false);
  });

  it('ข้อความว่าง / undefined → ไม่พังและไม่เข้าเส้นนี้', () => {
    expect(isTaken({})).toBe(false);
  });
});

/* ── 2. 🔴 DRIFT GUARD — สายไฟต้องต่ออยู่จริงในไฟล์จริง
   ข้อนี้คือข้อที่จับบั๊กเดิมได้ · ข้อ 1 เขียวได้แม้สายไฟขาด */
describe('[CLAIMRACEGUARD] สายไฟในไฟล์จริง — ไม่ใช่แค่ตรรกะ', () => {
  /* 🔴 ตัดตัวฟังก์ชันแล้วดูว่า setter อยู่ **หลัง** `} catch` ของฟังก์ชันนั้น
     ═══════════════════════════════════════════════════════════════════════
     เดิมข้อนี้ใช้ regex `/catch...\n {4}\}/` ตัดก้อน catch ซึ่ง **ผิด**:
     มันจบก้อนที่ `\n    }` ตัวแรก ⇒ บางก้อนที่นับได้จริง ๆ คือ *หางของ try body*
     ไม่ใช่ catch ⇒ ถ้าใครย้าย setter จาก catch ของ handleOperatorChange ไปไว้ใน
     try body เทสยัง **เขียว** ทั้งที่บั๊กเดิมกลับมาแล้ว (reviewer วัดให้ดูก่อน merge)
     วิธีนี้ไม่ต้องพึ่ง indent: setter ต้องปรากฏหลังคำว่า `} catch` ของฟังก์ชันนั้น */
  const wiredInCatchOf = (fnName: string): boolean => {
    const start = src.indexOf(`const ${fnName}`);
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  };', start));
    const c = body.lastIndexOf('} catch');
    return c >= 0 && body.slice(c).includes('setTicketTakenModal(true)');
  };

  it('⭐⭐ executeJobAction — setter ต้องอยู่ใน catch (เส้นที่ 409 วิ่งผ่านจริง)', () => {
    expect(wiredInCatchOf('executeJobAction')).toBe(true);
  });

  it('⭐⭐ handleOperatorChange — setter ต้องอยู่ใน catch เช่นกัน', () => {
    /* เส้นนี้คือเส้นที่ guard เดิมจับไม่ได้ ถ้า setter ถูกย้ายไป try body */
    expect(wiredInCatchOf('handleOperatorChange')).toBe(true);
  });

  /* 🔴 POLARITY — ข้อที่ขาดไปตอนแรก และ reviewer พิสูจน์ให้เห็นว่าขาดจริง
     ═══════════════════════════════════════════════════════════════════════
     ข้อ 1 ข้างบนทดสอบ **สำเนา** ของ regex ที่ประกาศในไฟล์เทสเอง และ drift guard
     ตรวจแค่ว่า setter "มีอยู่ในก้อน catch" ⇒ ถ้าใครกลับขั้ว `if` เป็น `if (!/…/)`
     เทสทั้งหมดยัง **เขียว** ทั้งที่พฤติกรรมกลับด้านสนิท: คนที่ถูกแย่งจะได้ข้อความ
     "ไม่สามารถบันทึกได้" (ข้อความที่งานนี้เกิดมาเพื่อกำจัด) ส่วน error ทั่วไป
     กลับไปเปิดกล่อง "ถูกรับไปแล้ว" · reviewer รันจริงในแซนด์บ็อกซ์แล้วได้ 8/8 เขียว
     ⇒ ข้อนี้ผูก setter ไว้กับ **สาขาบวก** ของเงื่อนไข ไม่ใช่แค่ "อยู่ใน catch" */
  const positiveBranchWired = (fnName: string): boolean => {
    const start = src.indexOf(`const ${fnName}`);
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  };', start));
    const i = body.indexOf(
      'if (/ถูกรับไปแล้วโดยแอดมินท่านอื่น/.test(msg)) {',
    );
    if (i < 0) return false; // กลับขั้วเป็น `if (!/…` ⇒ หาไม่เจอ ⇒ แดง
    const elseIdx = body.indexOf('} else {', i);
    const branch = elseIdx > i ? body.slice(i, elseIdx) : body.slice(i, i + 300);
    return branch.includes('setTicketTakenModal(true)');
  };

  it('⭐⭐ executeJobAction — setter ต้องอยู่ใน **สาขาบวก** ของเงื่อนไข', () => {
    expect(positiveBranchWired('executeJobAction')).toBe(true);
  });

  it('⭐⭐ handleOperatorChange — setter ต้องอยู่ใน **สาขาบวก** เช่นกัน', () => {
    expect(positiveBranchWired('handleOperatorChange')).toBe(true);
  });

  it('⭐⭐ ห้ามมีเงื่อนไขกลับขั้ว `if (!/ถูกรับไปแล้ว…` ที่ไหนเลย', () => {
    expect(src).not.toContain('if (!/ถูกรับไปแล้วโดยแอดมินท่านอื่น');
  });

  it('⭐⭐ ทั้งสองเส้นต้องตรวจข้อความ "ถูกรับไปแล้วโดยแอดมินท่านอื่น"', () => {
    const hits = src.match(/ถูกรับไปแล้วโดยแอดมินท่านอื่น/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("⭐⭐ ห้ามมี `already accepted` ใน regex ของไฟล์จริง (จะจับ 409 ผิดตัว)", () => {
    /* ตรึงบทเรียนไว้ที่ซอร์สจริง ไม่ใช่แค่ในสำเนาตรรกะข้างบน
       ⚠️ ห้าม assert ว่าทั้งไฟล์ไม่มีคำนี้ — สาขา dead code เดิมที่ :1026
          (`errMsg === 'Ticket already accepted'`) มีคำนี้อยู่โดยชอบธรรม
          สิ่งที่ห้ามคือ **regex ของการถูกแย่ง** ต้องไม่รวมคำนี้เข้าไป */
    expect(src).not.toContain('ถูกรับไปแล้วโดยแอดมินท่านอื่น|already accepted');
  });

  it("⭐⭐ ทั้งสามปุ่มรับเคสต้องส่ง expected_admin_user_id ตอนตั๋วยังว่าง", () => {
    /* BE เดาได้แค่ 'ตอนนี้ DB ว่างไหม' ไม่ใช่ 'จอเห็นอะไร' ⇒ ถ้าจอค้าง คำขอจะกลาย
       เป็นโอนเคสแล้วแย่งจากเจ้าของใหม่ · ต้องส่งเงื่อนไขไปด้วยถึงจะปิดช่องได้จริง */
    const hits = src.match(/expected_admin_user_id/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2); // executeJobAction + handleOperatorChange
    expect(src).toContain("if (!ticket.admin_user_id) payload.expected_admin_user_id = '';");
  });

  it('⭐ handleOperatorChange ต้องไม่กลืน error เงียบ ๆ อีก', () => {
    /* เดิม catch ของมันมีแค่ console.error ⇒ modal ค้างเปิด ไม่มีอะไรบอกผู้ใช้ */
    const block = src.slice(src.indexOf('const handleOperatorChange'));
    const body = block.slice(0, block.indexOf('\n  };'));
    expect(body).toContain('setTicketTakenModal(true)');
    expect(body).toContain('setAlertState');
  });

  it('⭐ กล่องยังต้องมีปุ่มรีเฟรชทันทีเป็นทางออกเดียว', () => {
    const modal = src.slice(src.indexOf('{ticketTakenModal && ('));
    const body = modal.slice(0, 1400);
    expect(body).toContain("t('ticket.refresh_now')");
    expect(body).toContain('fetchTickets(true)');
  });
});
