/**
 * [FEAT-20260831-ADMINDIRECT] ปุ่มติดต่อแอดมิน = เปิดเคสทุกครั้ง
 * ===========================================================================
 * `{{paylink.contact_admin}}` เป็น MESSAGE button ⇒ กดแล้วเข้ามาเป็นข้อความ
 * ธรรมดา และเดิมทางเดียวที่จะได้เคสคือ AI บังเอิญตอบพร้อม marker `[[[assist]]]`
 *
 * 🔴 หลักฐานว่าของเดิมไม่แน่นอนจริง (แถวจริง 31/08 ห้อง 6a8d5f1c…):
 *     14:28:22 customer ติดต่อแอดมิน
 *     14:28:26 bot      สวัสดีค่ะ…            tag_status=found     → ไม่มีเคส
 *     14:28:45 customer ติดต่อแอดมิน
 *     14:28:52 bot      ขออภัย… [[[assist]]]  tag_status=not_found → ได้เคส
 *   ข้อความเดียวกัน กดสองครั้ง ได้เคสครั้งเดียว
 *
 * ไฟล์นี้ปักสิ่งที่ **ตัดสินใจแล้ว** และพังง่ายที่สุดสามข้อ: ตัวข้อความที่ประตูจับ,
 * ลำดับตอบ–เปิดเคส, และค่าที่ใช้ยื่นเข้าคิว — ส่วนการต่อสายจริงพิสูจน์ด้วย
 * `z-test/manual/prove-admin-direct.js` บน dist + ฐานจริง
 */
import {
  CONTACT_ADMIN_ACK_TEXT,
  CONTACT_ADMIN_MESSAGE,
  CONTACT_ADMIN_TICKET_CATEGORY,
  CONTACT_ADMIN_TICKET_NEED,
  CONTACT_ADMIN_WITHDRAW_MESSAGE,
  // [FIX-20260902-ADMINDIVIDER] the sentence the ADMIN reads when this case opens
  contactAdminTicketDivider,
} from '@/modules/payment';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * [PROG-20260905-CENSUSCONV] The door's TAGS travel with its code.
 *
 * Every assertion below is about the door's behaviour — it catches a button PRESS not a
 * typed phrase, it replies before it opens the case, it writes the history row between
 * them, and a failed acknowledgement still opens the case. Those rules are true wherever
 * the door lives.
 *
 * Pinned to the service alone, this file would go red the day the door moves into a role
 * directory, for a change that altered nothing — and a spec that reddens on safe changes
 * gets deleted, which would cost twelve real rules. So the source is the service plus the
 * directories the door may move to, and the slice is taken from whichever file carries the
 * opening tag.
 */
const DOOR_SOURCES: readonly string[] = [
  'webhook.service.ts',
  /* [PROG-20260905-LADDER] the seat itself became a ladder step. Both doors live in ONE
     file on purpose — the slice below runs from the plain door's tag to the withdraw
     door's, and splitting them across two files would break a slice that guards twelve
     rules. Added BEFORE the move, so the conversion is visible rather than a repair. */
  'gates',
  'ticket',
  'payment-reply',
  'hook-reply',
];

const WEBHOOK_DIR = join(__dirname, '../../src/modules/webhook');

const SRC = ((): string => {
  const parts: string[] = [];
  for (const entry of DOOR_SOURCES) {
    const abs = join(WEBHOOK_DIR, entry);
    if (!existsSync(abs)) continue; // a role directory a later step creates
    if (statSync(abs).isDirectory()) {
      for (const f of readdirSync(abs).sort()) {
        if (f.endsWith('.ts')) parts.push(readFileSync(join(abs, f), 'utf8'));
      }
    } else {
      parts.push(readFileSync(abs, 'utf8'));
    }
  }
  return parts.join('\n');
})();
/** บล็อกของประตูนี้ ตัดตั้งแต่หัวคอมเมนต์ถึงประตูของตัวถอนที่อยู่ถัดไป */
/**
 * [PROG-20260905-CENSUSCONV] The door is the seat in the spine PLUS the body it calls.
 *
 * The tags still mark the seat, and the assertions about ORDER — reply, then history row,
 * then case — are about the body. After the extraction those two live in different files,
 * so the slice is the seat's span followed by the extracted body. Every assertion keeps
 * its meaning; none of them was ever about which file the code sat in.
 */
const DOOR_BODY = ((): string => {
  const f = join(WEBHOOK_DIR, 'ticket', 'open-admin-case.ts');
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
})();

const DOOR =
  SRC.slice(
    SRC.indexOf('[FEAT-20260831-ADMINDIRECT] the plain admin button'),
    SRC.indexOf(
      '[FEAT-20260831-ADMINVIAWITHDRAW] the withdraw-side admin button',
    ),
  ) + DOOR_BODY;

describe('[ADMINDIRECT] ข้อความที่เกี่ยวข้อง', () => {
  it('🔴 ประตูจับ "การกดปุ่ม" ไม่ใช่คำที่ลูกค้าพิมพ์', () => {
    /* [FEAT-20260902-ADMINPOSTBACK] เดิมประตูเทียบข้อความตรง ๆ
       (`String(msgContent).trim() === CONTACT_ADMIN_MESSAGE`) ซึ่งแยกไม่ออกว่า
       มาจากปุ่มหรือลูกค้าพิมพ์เอง — พิสูจน์จริง 02/09 พิมพ์ 12:45 กด 12:49 แถวใน DB
       เหมือนกันทุกอย่าง ⇒ ตอนนี้ต้องมาจาก postback payload เท่านั้น

       ⚠️ `event.type === 'postback'` เป็นส่วนหนึ่งของเงื่อนไข ไม่ใช่ของแถม:
          `msgContent` ของ postback คือ payload ถ้าเทียบแต่ payload ลูกค้าพิมพ์
          payload เองก็ผ่าน — รูโหว่เดิมกลับมาทันที */
    expect(DOOR).toContain('payLinkFromPostback(');
    expect(DOOR).toContain("event.type === 'postback'");
    /* [PROG-20260905-LADDER] the seat became a ladder step, so the local
       `payLinkPressed` is gone and the door asks `pressed(ctx) === 'contact_admin'`.
       The RULE is unchanged and still asserted: the door matches the payload-derived
       ACTION NAME. Only the variable's name went away. */
    expect(DOOR).toContain("=== 'contact_admin'");
    // ห้ามกลับไปเทียบคำอีก ไม่ว่าจะแบบเป๊ะหรือ substring
    expect(DOOR).not.toContain(
      'String(msgContent).trim() === CONTACT_ADMIN_MESSAGE',
    );
    expect(DOOR).not.toContain('.includes(CONTACT_ADMIN_MESSAGE)');
  });

  it('⭐⭐⭐ สองปุ่มยังคนละข้อความ — ประตูจึงไม่ทับกัน', () => {
    expect(CONTACT_ADMIN_MESSAGE).not.toBe(CONTACT_ADMIN_WITHDRAW_MESSAGE);
    expect(CONTACT_ADMIN_WITHDRAW_MESSAGE.trim()).not.toBe(
      CONTACT_ADMIN_MESSAGE.trim(),
    );
  });

  it('🔴 the divider is the BARE label — nothing may be added to it', () => {
    /* [FIX-20260902-ADMINDIVIDER] Owner, 02/09:
           before: "เคสนี้สร้างโดยระบบ ติดต่อแอดมิน"
           now:    "ติดต่อแอดมิน"
       The old prefix reads as the system having decided something on its own,
       which is not what happened — the customer pressed a button. Any other
       wording invented here would be a guess standing in for the owner's.

       ⚠️ Asserted with `toBe`, not `toContain`. A `contains` check stays green the
          day someone puts a prefix back, and a prefix is exactly what was removed.
       ⚠️ NO OTHER PATH may change: `openTicketBySystem` leaves the sentence to its
          caller, so register scenario-A and the money path ("…เนื่องจาก…") still
          read as they did. This test therefore inspects only THIS door's block,
          it does not forbid the phrase file-wide. */
    expect(DOOR).toContain('contactAdminTicketDivider(');
    expect(DOOR).not.toContain('เคสนี้สร้างโดยระบบ ${');
    // the wording lives in the copy file alone — no literal in the webhook path
    expect(DOOR).not.toContain('ลูกค้ากดปุ่ม');

    // whatever label goes in comes out, with nothing grown on either end
    expect(contactAdminTicketDivider(CONTACT_ADMIN_MESSAGE)).toBe(
      CONTACT_ADMIN_MESSAGE,
    );
    expect(contactAdminTicketDivider(CONTACT_ADMIN_WITHDRAW_MESSAGE)).toBe(
      CONTACT_ADMIN_WITHDRAW_MESSAGE,
    );
    /* The two buttons stay distinguishable from the divider alone because their
       labels differ — an operator can tell a withdraw case, one that already
       cleared the withdraw notice screens, from a plain one with no invented
       explanation anywhere. */
    expect(contactAdminTicketDivider(CONTACT_ADMIN_WITHDRAW_MESSAGE)).not.toBe(
      contactAdminTicketDivider(CONTACT_ADMIN_MESSAGE),
    );
  });

  it('⭐⭐ ค่าที่ยื่นเข้าคิวตรงกับที่ระบบเคยสร้างไว้เอง', () => {
    /* แถวจริงทุกใบในฐานอ่านว่า category=Other · need_detail=ติดต่อแอดมิน
       ⇒ ประตูนี้ไม่ได้เปลี่ยนการจัดหมวด แค่ทำให้มันเกิดแน่นอนขึ้น */
    expect(CONTACT_ADMIN_TICKET_CATEGORY).toBe('Other');
    expect(CONTACT_ADMIN_TICKET_NEED).toBe(CONTACT_ADMIN_MESSAGE);
  });

  it('⭐ ข้อความตอบกลับแก้ที่เดียว และไม่ว่าง', () => {
    expect(CONTACT_ADMIN_ACK_TEXT.trim().length).toBeGreaterThan(0);
    /* ห้ามฝังสตริงไว้ในเส้นเว็บฮุค — เจ้าของบอกว่าอาจแก้ทีหลัง */
    expect(DOOR).toContain('CONTACT_ADMIN_ACK_TEXT');
    expect(DOOR).not.toContain('น้องลั๊คกี้');
  });
});

describe('[ADMINDIRECT] ลำดับและความปลอดภัยของประตู', () => {
  it('⭐⭐⭐ ตอบก่อน เปิดเคสทีหลัง — สลับเมื่อไหร่ข้อความจะกลายเป็นบอทพูดในห้องที่แอดมินถือ', () => {
    /* `claimRoomAndOpenCase` ตั้ง assist_status:true ซึ่งเป็นสวิตช์ปิดปากบอท */
    /* [PROG-20260905-LADDER] `this.sendTextReply(` used to appear inside the seat, in the
       deps literal the spine built there. That binding moved into `turnDeps`, so the seat
       no longer spells it — but the ORDER this case protects was never the seat's: it is
       the BODY's, and the body calls `deps.sendTextReply` then `openTicketBySystem`. The
       assertion follows the code. */
    const reply = DOOR.indexOf('deps.sendTextReply(');
    const open = DOOR.indexOf('openTicketBySystem(');
    expect(reply).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(-1);
    expect(reply).toBeLessThan(open);
  });

  it('⭐⭐⭐ ไม่มีห้อง = ไม่เปิดเคส และไม่ล้ม', () => {
    expect(DOOR).toContain("String(inboundRoom?.['_id'] ?? '')");
    /* [FEAT-20260902-ADMINPOSTBACK] เดิมเป็น `if (adminRoomId) {` ครอบทั้งก้อน
       ตอนนี้เป็น early-return เพราะตัวนี้กลายเป็นฟังก์ชันที่ทั้งสองประตูเรียก
       และต้องบอกผู้เรียกได้ว่าเปิดเคสหรือไม่
       ⚠️ ต้องมี log ด้วย: postback ไม่ถูกบันทึกเป็นแถวแชท ถ้าเงียบตรงนี้
          จะไม่มีร่องรอยที่ไหนเลยว่าลูกค้ากดปุ่ม */
    expect(DOOR).toContain('if (!adminRoomId) {');
    expect(DOOR).toContain('[ADMINDIRECT] no room for');
  });

  it('🔴 ack ต้องถูกบันทึกลงแชท และลำดับต้องเป๊ะ — ส่ง → บันทึก → เปิดเคส', () => {
    /* [FIX-20260902-ACKROW] เดิมประตูนี้ส่ง ack ออกไปโดย**ไม่บันทึก** ทั้งที่ทุกที่
       ในไฟล์นี้ (11 จุด) บันทึกกันหมด ⇒ แอดมินเปิดห้องมาเห็นแต่ divider ไม่รู้ว่า
       ลูกค้าถูกบอกอะไรไปแล้ว เสี่ยงพูดซ้ำหรือพูดขัดกัน

       ลำดับเป็นเรื่องเป็นเรื่องจริง สองด้าน:
       · บันทึก**หลัง**ส่ง — ถ้าบันทึกก่อน จะได้แถวของประโยคที่ลูกค้าอาจไม่เคยได้รับ
         (บั๊กเดียวกับ [FIX-20260901-FALLBACKMARKERROW])
       · บันทึก**ก่อน**เปิดเคส — `openTicketBySystem` ตั้ง `assist_status:true`
         ถ้าเปิดก่อน แถวนี้จะกลายเป็นบอทพูดในห้องที่แอดมินถือแล้ว */
    const send = DOOR.indexOf('deps.sendTextReply(');
    const logRow = DOOR.indexOf("senderType: 'bot'");
    const open = DOOR.indexOf('openTicketBySystem(');

    expect(send).toBeGreaterThan(-1);
    expect(logRow).toBeGreaterThan(-1); // มีการบันทึกจริง ไม่ใช่ส่งแล้วเงียบ
    expect(open).toBeGreaterThan(-1);
    expect(send).toBeLessThan(logRow); // ส่งก่อน แล้วค่อยบันทึก
    expect(logRow).toBeLessThan(open); // บันทึกก่อน แล้วค่อยเปิดเคส

    // บันทึกข้อความจริงที่ส่งออก ไม่ใช่สตริงอื่นที่บังเอิญคล้าย
    const rowBlock = DOOR.slice(logRow, open);
    expect(rowBlock).toContain('content: CONTACT_ADMIN_ACK_TEXT');
    // ล้มแล้วเคสต้องยังเปิด — เหมือนขาส่ง
    expect(rowBlock).toContain('[ADMINDIRECT] ack row not written');
  });

  it('⭐⭐⭐ ใช้ประตูเปิดเคสกลาง ไม่ได้เขียนตัวสร้าง ticket ใหม่', () => {
    /* ตัวเดียวกับปุ่ม "เปิดเคส" ของแอดมิน (openTicketBySystem → claimRoomAndOpenCase) */
    expect(DOOR).toContain('openTicketBySystem(');
    expect(DOOR).not.toContain('ticketModel.create');
  });

  it('⭐⭐⭐ ส่งข้อความไม่ออก เคสต้องยังเปิด', () => {
    /* โควต้าหมด / reply token หมดอายุ = เรื่องปกติของเส้นนี้ ถ้าอยู่ try ก้อนเดียว
       กับการเปิดเคส ลูกค้าจะไม่ได้ทั้งข้อความและไม่ได้เคส ซึ่งแย่กว่าก่อนมีประตูนี้ */
    const reply = DOOR.indexOf('this.sendTextReply(');
    const innerCatch = DOOR.indexOf('[ADMINDIRECT] ack not delivered');
    const open = DOOR.indexOf('openTicketBySystem(');
    expect(innerCatch).toBeGreaterThan(reply);
    expect(innerCatch).toBeLessThan(open);
  });

  it('⭐⭐ ล้มแล้วต้องไม่กลืนข้อความลูกค้า', () => {
    expect(DOOR).toContain('catch (err)');
    expect(DOOR).toContain('[ADMINDIRECT] failed');
  });

  it('⭐⭐ ยิง ticket:new ให้หน้าจอเด้ง realtime', () => {
    /* Same conversion: the binding moved to `turnDeps`, the CALL is the body's. */
    expect(DOOR).toContain('publishTicketCreated(');
  });
});
