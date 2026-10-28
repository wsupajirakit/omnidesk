import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * [FEAT-20260826-CLOSECLEARFU] ของใหม่ต้องไม่ขยับปิดเคสของเดิมสักไบต์
 * ===========================================================================
 * เจ้าของสั่งตรง ๆ ว่า "ถ้าไม่มีสองค่านี้ไม่ต้องมี checkbox ทำงานเหมือนเดิม
 * ทดสอบจริงด้วยว่าไม่กระทบ" — ไฟล์นี้คือคำตอบของประโยคนั้น
 *
 * เทสนี้อ่าน **ซอร์สจริง** ไม่ใช่ mount หน้า TicketChat ทั้งใบ (5,000+ บรรทัด
 * ที่ต้องมี provider/ws/route ครบถึงจะขึ้น) เพราะสิ่งที่ต้องพิสูจน์คือ *กติกา*
 * ไม่ใช่พิกเซล: คีย์ใหม่ถูกใส่ลง payload **เฉพาะ** ตอนเลือก "หยุดตาม" เท่านั้น
 * และปุ่มยืนยันถูกล็อกด้วยเงื่อนไขตัวเดียวกับที่ตัดสินว่าจะโชว์ตัวเลือกไหม
 *
 * รูปแบบเดียวกับ `noticeCardGate.value.test.ts` ที่อ่านไฟล์ BE ตรง ๆ กันสองฝั่งดริฟต์
 *
 * ── [FEAT-20260827-PATCHAFTERCLOSE] อัปเดต 27/08 ────────────────────────────
 * กล่องยืนยันถูกแบ่งเป็น **section** และเพิ่มหัวข้อฝาก/ถอน ⇒ ชื่อตัวแปรในกติกา
 * ข้างล่างเปลี่ยนตาม (`followUpAnswer` → `closeAnswers`, `needsFollowUpChoice`
 * → `closeTopics`) แต่ **กติกาทุกข้อยังเป็นข้อเดิมเป๊ะ** เพราะเจ้าของย้ำประโยคเดิม
 * อีกครั้ง 27/08: *"ถ้าไม่มีให้ติ๊ก = ปิดเคสปกติ"*
 * ⇒ เพิ่มข้อใหม่ต่อท้าย: หัวข้อที่ **ไม่ได้ขึ้น** ต้องไม่ถูกส่งและต้องไม่ล็อกปุ่ม
 */

const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');

const TICKET_CHAT = 'pages/chat/TicketChat.tsx';

describe('ปิดเคสปกติต้องไม่เปลี่ยน', () => {
  it('⭐ ส่ง patch_after_close เฉพาะตอนมีหัวข้อที่ถูกตอบจริง', () => {
    const src = read(TICKET_CHAT);
    // ต้องมีเงื่อนไขคุมอยู่ ไม่ใช่ใส่ลง payload ตรง ๆ
    expect(src).toMatch(
      /if\s*\(Object\.keys\(answered\)\.length > 0\)\s*payload\.patch_after_close = answered;/,
    );
    // และต้องไม่มีที่ไหนใส่คีย์นี้แบบไม่มีเงื่อนไข
    const unconditional = src
      .split('\n')
      .filter(
        (l) =>
          l.includes('payload.patch_after_close') &&
          !l.includes('Object.keys(answered).length > 0'),
      );
    expect(unconditional).toEqual([]);
  });

  it('🔴 หัวข้อที่ไม่ได้ขึ้นต้องไม่ถูกส่ง — วนจากรายการหัวข้อ ไม่ใช่จากคำตอบ', () => {
    /* Looping over the ANSWERS would leak a stale pick from a previous case
       into the payload of a case that never showed that topic. The loop must be
       driven by the topic LIST.

       [FIX-20260830-CLOSEANSWERSTALE] this used to pin the literal
       `for (const topic of closeTopics)`. That spelling was replaced: reading
       `closeTopics` directly inside `executeAction` was itself the bug — that
       callback is a `useCallback` whose deps exclude it, so it captured an
       empty list and the payload silently lost `patch_after_close`. The values
       now arrive through `closeCaseRef`. The CONTRACT is unchanged and is what
       is pinned here: iterate the topic list, index the answers by topic. */
    const src = read(TICKET_CHAT);
    const loop = src.match(/for \(const topic of (\w+)\)/);
    expect(loop, 'the payload must still be built by looping over topics').toBeTruthy();
    const iterated = loop?.[1] ?? '';
    // whatever it is called, it must be the TOPIC list, never the answers
    expect(iterated).toMatch(/[Tt]opics/);
    expect(iterated).not.toMatch(/[Aa]nswers/);
    // and the answers must be read BY that topic, not spread wholesale
    expect(src).toMatch(/(\w*[Aa]nswers)\[topic\]/);
  });

  it('⭐ (ของเดิม 26/08 ยังต้องจริง) ไม่มีที่ไหนส่ง clear_follow_up = false', () => {
    /* 🔴 ส่ง `false` กับ "ไม่ส่ง" ไม่เหมือนกันที่ฝั่ง BE ในแง่ payload ที่วิ่งบนสาย:
       BE ตัดสินด้วย `=== true` ทั้งคู่จึงได้ผลเดียวกัน แต่ถ้าส่ง false เคสที่
       "เลือกตามต่อ" จะยิง body ต่างจากเคสที่ "ไม่มีช่องให้เลือก" ⇒ พิสูจน์
       ไม่ได้อีกต่อไปว่าปิดเคสปกติเหมือนเดิม */
    const src = read(TICKET_CHAT);
    expect(src).not.toMatch(/clear_follow_up\s*=\s*false/);
    expect(src).not.toMatch(/clear_follow_up:\s*false/);
  });

  it('⭐ ปุ่มยืนยันถูกล็อกด้วยเงื่อนไขเดียวกับที่ตัดสินว่าจะโชว์ตัวเลือก', () => {
    /* ถ้าล็อกด้วยเงื่อนไขอื่น (เช่นเช็คแค่ followUpAnswer === null) เคสที่
       **ไม่มี** ช่องให้เลือกจะกดยืนยันไม่ได้ตลอดกาล = ปิดเคสไม่ได้ทั้งระบบ */
    const src = read(TICKET_CHAT);
    expect(src).toMatch(
      /if\s*\(missingTopics\(closeTopics, closeAnswers\)\.length > 0\)/,
    );
  });

  it('🔴 ไม่มีหัวข้อขึ้นเลย ⇒ ลิสต์ว่าง ⇒ กดยืนยันผ่านทันที (ปิดเคสปกติ)', () => {
    /* `missingTopics` กรองจาก `topics` ⇒ topics ว่าง = ผลลัพธ์ว่างเสมอ
       นี่คือกลไกที่ทำให้เคสที่ไม่มีช่องให้ติ๊ก กดยืนยันได้ตามปกติ */
    const comp = read('components/member/follow-up/CloseCaseSections.tsx');
    expect(comp).toMatch(
      /missingTopics = \(\s*topics: CloseCaseTopic\[\],\s*answers: CloseCaseAnswers,\s*\): CloseCaseTopic\[\] => topics\.filter/,
    );
  });

  it('⭐ ไม่มีหัวข้อ = ไม่เรนเดอร์อะไรเลย (DOM ของกล่องยืนยันเท่าเดิม)', () => {
    /* ตัวคอมโพเนนต์เป็นคนตัดสินเอง ไม่ใช่ผู้เรียก — `topics` ว่างแล้วคืน `null`
       ⇒ ผู้เรียกไม่ต้องมีเงื่อนไขซ้ำ และไม่มีทางลืมใส่ */
    const comp = read('components/member/follow-up/CloseCaseSections.tsx');
    expect(comp).toMatch(/if \(topics\.length === 0\) return null;/);
  });

  it('⭐ ค่าที่เลือกถูกล้างทุกครั้งที่ปิดกล่อง — ไม่ค้างข้ามเคส', () => {
    /* ค้างไว้ = เปิดเคสถัดไปแล้วเจอ "หยุดตาม" ติ๊กอยู่แล้ว กดยืนยันปุ๊บ
       ลบ stamp ของลูกค้าคนใหม่ทันทีโดยไม่มีใครตั้งใจ */
    const src = read(TICKET_CHAT);
    expect(src).toMatch(/onClose=\{\(\) => \{[^}]*setCloseAnswers\(\{\}\)/);
  });

  it('⭐ เงื่อนไขผูกกับ targetStatus ของกล่องที่เปิดอยู่จริง', () => {
    // กล่องใบนี้ใช้ร่วมกับ "รับเคส" — ผูกผิดตัวแปรแล้วช่องจะไปโผล่ตอนรับเคส
    const src = read(TICKET_CHAT);
    /* [FEAT-20260830-FOLLOWUPFRESH] this used to pin the literal `selectedRoom`
       as the first argument. The dialog now reads the stamps FRESH when it opens
       and passes `freshRoom ?? selectedRoom`, so that spelling is gone — but the
       thing this case actually guards is unchanged and is what is pinned here:
       the second argument is the OPEN dialog's `targetStatus`, and the room
       argument still falls back to `selectedRoom`. */
    const call = src.match(
      /closeCaseTopicsFor\(\s*([^,]+),\s*([^,]+),/,
    );
    expect(call, 'the topics must still come from closeCaseTopicsFor').toBeTruthy();
    const [, roomArg = '', statusArg = ''] = call ?? [];
    expect(roomArg).toContain('selectedRoom');
    expect(statusArg.replace(/\s+/g, '')).toBe('confirmAction?.targetStatus??0');
    // และตัวตัดสินต้องยังบังคับว่าเป็นการ "ปิดเคส" เท่านั้น
    const comp = read('components/member/follow-up/CloseCaseSections.tsx');
    expect(comp).toMatch(/if \(targetStatus !== 2\) return \[\];/);
  });
});

describe('สองฝั่งต้องเรียกคีย์เดียวกัน', () => {
  it('⭐ ชื่อคีย์ที่ FE ส่ง ตรงกับที่ BE ประกาศไว้ใน DTO', () => {
    /* ชื่อคีย์เป็นสตริงคนละ repo — พิมพ์ผิดฝั่งเดียวคือ 400 ทั้งระบบ
       (BE เปิด forbidNonWhitelisted) และไม่มี type ไหนจับให้ */
    /* [FEAT-20260827-PATCHAFTERCLOSE] อ่าน BE จาก **เลนเดียวกัน** ก่อน แล้วค่อย
       ถอยไป checkout หลัก — งาน cross-repo ทำใน worktree คู่ (`*-patchclose`)
       ⇒ ถ้าชี้ไป `omnidesk-api` อย่างเดียว เทสจะแดงตลอดจนกว่า BE จะ merge เข้า dev
       ซึ่งอ่านเหมือนของพัง ทั้งที่เป็นแค่คนละโฟลเดอร์ · เมื่อ merge แล้วทั้งสองทาง
       ให้คำตอบเดียวกัน ⇒ เทสยังจับดริฟต์ของจริงได้เหมือนเดิม */
    const DTO_REL = 'src/modules/tickets/dto/ticket.dto.ts';
    const beRoots = ['omnidesk-api-patchclose', 'backend'];
    let be = '';
    for (const root of beRoots) {
      try {
        be = readFileSync(join(process.cwd(), '..', root, DTO_REL), 'utf8');
        break;
      } catch {
        /* ลองที่ถัดไป */
      }
    }
    expect(be, 'ไม่พบ ticket.dto.ts ฝั่ง BE').not.toBe('');
    // ของเดิม 26/08 ยังต้องอยู่ครบทั้งสองฝั่ง (client เก่ายังยิงมาได้)
    expect(be).toMatch(/clear_follow_up\?:\s*boolean;/);
    expect(read('services/chat/ticketService.ts')).toContain('clear_follow_up');

    // ของใหม่ 27/08 — ชื่อคีย์และค่าที่ยอมรับต้องตรงกันทั้งสอง repo
    expect(be).toMatch(/patch_after_close\?:\s*PatchAfterCloseDto;/);
    expect(be).toMatch(/@IsIn\(\['stop', 'keep'\]\)/);
    expect(be).toMatch(/@IsIn\(\['follow', 'unfollow'\]\)/);
    expect(read(TICKET_CHAT)).toContain('patch_after_close');
    expect(read('services/chat/ticketService.ts')).toContain('patch_after_close');
  });
});
