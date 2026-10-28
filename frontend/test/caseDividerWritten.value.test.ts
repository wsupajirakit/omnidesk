/**
 * [FIX-20260820-DIVIDEROWNER] the synthetic divider stands down only for its own case
 * ============================================================================
 * Owner, 2026-08-20: "abandon ต้องไม่เบิ้ล · ไม่มาแก้ไขปลายเหตุ · ทุกอย่างต้องปกติ
 * พวก slip ปกติ seamless ห้ามกระทบ + proof test".
 *
 * The rule under test reads a stamp the backend writes (`metadata.ticket_id` on
 * the divider row) instead of inferring anything. See `caseDividerWritten.ts` for
 * why the conflated `direct_ticket` flag was the actual cause, and why the
 * earlier `actor_name` version was replaced rather than kept.
 *
 * The cases below are the six the fix has to get right, and each is here because
 * it either broke, or would have broken, under the version this replaced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { caseDividerAlreadyWritten } from '../components/chat/caseDividerWritten';

const TICKET = 'a0d000000000000000000098';
const OTHER_TICKET = 'a0d000000000000000000099';

/** the row `claimRoomAndOpenCase` writes, as it appears in the database */
const stampedRow = (ticketId: string) => ({
  _id: 'r1',
  message_type: 'divider',
  content: 'เคสนี้สร้างโดยระบบ ต้องการลงทะเบียน',
  metadata: { variant: 'direct_ticket', actor_name: 'ระบบ', ticket_id: ticketId },
});

/** the slip path's row — same variant, never stamped. 20 of these are live. */
const slipRow = {
  _id: 'r2',
  message_type: 'divider',
  content: 'เคสนี้สร้างโดยระบบ เนื่องจาก ยอดในสลิป 2,500 บาท · รายการรอฝาก ไม่มี',
  metadata: { variant: 'direct_ticket' },
};

describe('⭐ abandon stops doubling', () => {
  it('the case whose line is in the transcript draws nothing more', () => {
    expect(caseDividerAlreadyWritten([stampedRow(TICKET)], TICKET)).toBe(true);
  });

  it('finds it among a full transcript', () => {
    expect(
      caseDividerAlreadyWritten(
        [
          { message_type: 'text', content: '011311 asdasdjasdh' },
          slipRow,
          { message_type: 'divider', metadata: { variant: 'accept' } },
          stampedRow(TICKET),
        ],
        TICKET,
      ),
    ).toBe(true);
  });
});

describe('⭐ everything else keeps drawing — this is the seamless half', () => {
  it('⭐ the slip path is untouched: its row has no stamp', () => {
    /* if this ever returned true, a slip case would lose its only line. */
    expect(caseDividerAlreadyWritten([slipRow], TICKET)).toBe(false);
  });

  it('⭐ a room holding BOTH kinds of case — neither suppresses the other', () => {
    /* the hole that killed the previous version: it asked "does this room have a
       system row", so a slip case sharing a room with an abandon case went blank.
       ห้องเดียวมีสองแบบ ต่างคนต่างอ่านป้ายของตัวเอง. */
    const stream = [stampedRow(OTHER_TICKET), slipRow];
    expect(caseDividerAlreadyWritten(stream, OTHER_TICKET)).toBe(true);
    expect(caseDividerAlreadyWritten(stream, TICKET)).toBe(false);
  });

  it('⭐ every row written before this shipped carries no stamp', () => {
    /* the real rows already in the database — including the four from the system
       opener — have no `ticket_id`. They must read as "not written yet" so the
       page behaves exactly as it did. ของเก่าต้องเหมือนเดิมเป๊ะ. */
    const legacySystemRow = {
      message_type: 'divider',
      metadata: { variant: 'direct_ticket', actor_name: 'ระบบ' },
    };
    expect(caseDividerAlreadyWritten([legacySystemRow], TICKET)).toBe(false);
  });

  it('⭐ a failed row write leaves the line drawn, not lost', () => {
    /* `writeTicketDivider` swallows its errors and returns null, so "no row" is a
       real outcome. Being loud is recoverable; a hole in the transcript is not. */
    expect(caseDividerAlreadyWritten([], TICKET)).toBe(false);
  });
});

describe('unknown resolves towards drawing', () => {
  it('no case id, no stream, junk rows', () => {
    expect(caseDividerAlreadyWritten([stampedRow(TICKET)], null)).toBe(false);
    expect(caseDividerAlreadyWritten([stampedRow(TICKET)], '')).toBe(false);
    expect(caseDividerAlreadyWritten([stampedRow(TICKET)], '   ')).toBe(false);
    expect(caseDividerAlreadyWritten(null, TICKET)).toBe(false);
    expect(caseDividerAlreadyWritten(undefined, TICKET)).toBe(false);
    expect(
      caseDividerAlreadyWritten(
        [null, undefined, {}, { metadata: null }, { message_type: 'divider' }],
        TICKET,
      ),
    ).toBe(false);
  });

  it('an ObjectId-shaped id is compared by its string form', () => {
    /* the page holds `selectedTicket._id`, which arrives from the API as a
       string, but a caller passing the raw value must still match. */
    expect(
      caseDividerAlreadyWritten([stampedRow(TICKET)], {
        toString: () => TICKET,
      }),
    ).toBe(true);
  });
});

describe('⭐ every OTHER divider is invisible to this rule', () => {
  const OTHERS = [
    'accept', 'close', 'assign', 'bot', 'auto_ticket',
    'reopen_by_admin', 'suppressed_reply',
  ];
  it.each(OTHERS)('%s — even stamped with this ticket — is not it', variant => {
    expect(
      caseDividerAlreadyWritten(
        [{ message_type: 'divider', metadata: { variant, ticket_id: TICKET } }],
        TICKET,
      ),
    ).toBe(false);
  });

  it('a plain message is not it, whatever its metadata says', () => {
    expect(
      caseDividerAlreadyWritten(
        [
          {
            message_type: 'text',
            metadata: { variant: 'direct_ticket', ticket_id: TICKET },
          },
        ],
        TICKET,
      ),
    ).toBe(false);
  });
});

describe('the page really uses it', () => {
  const src = readFileSync(
    resolve(__dirname, '../components/chat/ChatRoomView.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('gates the synthetic on it, before the row is built', () => {
    const gate = src.indexOf('caseDividerAlreadyWritten(');
    const build = src.indexOf('เคสนี้สร้างโดยระบบ เนื่องจาก');
    expect(gate).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(gate);
  });

  it('⭐ the result actually gates the ternary — not computed and ignored', () => {
    const from = src.indexOf('const synthetic');
    const cond = src.slice(from, src.indexOf('message_type:', from));
    expect(from).toBeGreaterThan(-1);
    expect(cond).toMatch(/!\s*caseLineAlreadyDrawn/);
  });

  it('⭐ it is given the case id, or it could never match anything', () => {
    expect(src).toMatch(/caseDividerAlreadyWritten\(\s*messages,\s*ticketMeta\?\.\_id/);
  });

  it('the page passes the ticket id down as `_id`', () => {
    const page = readFileSync(
      resolve(__dirname, '../pages/chat/TicketChat.tsx'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const at = page.indexOf('ticketMeta={{');
    expect(at).toBeGreaterThan(-1);
    expect(page.slice(at, at + 400)).toContain('_id:');
  });

  it('⭐ the merge that renders EVERY other divider is byte-identical', () => {
    /* owner: "divider เดิมต้องไม่กระทบ มันมีหลายตัว proof ด้วย".
       The guard sits in the ternary that builds the ONE synthetic row. Everything
       downstream — the real rows from the API, the synthetic `close` rows the page
       injects, the hasMore window, the sort — is asserted here line for line, so a
       change to any of them cannot slip through as part of this fix.
       ท่อที่วาดเส้นอื่นทั้งหมด ต้องเหมือนเดิมทุกตัวอักษร. */
    for (const line of [
      'const allExtra = [...(extraDividers ?? []), ...synthetic];',
      'if (allExtra.length === 0) return messages;',
      'const merged = [...messages, ...visibleDividers];',
    ]) {
      expect(src.replace(/\s+/g, ' ')).toContain(line.replace(/\s+/g, ' '));
    }
    /* and the sort still orders the whole stream by time, ascending */
    expect(src.replace(/\s+/g, ' ')).toContain(
      'merged.sort((a, b) => new Date(a.created_at as any).getTime() - new Date(b.created_at as any).getTime())',
    );
  });

  it('⭐ the guard touches ONLY the synthetic — one reference, inside the ternary', () => {
    expect(src.split('caseLineAlreadyDrawn').length - 1).toBe(2); // declared + used once
  });

  it('⭐ the replaced heuristic is gone for good', () => {
    /* the owner asked for the symptom fix to be removed, not layered over.
       ห้ามเหลือของเก่าไว้ซ้อนกัน. */
    expect(src).not.toContain('hasSystemCaseDividerRow');
    expect(src).not.toContain('systemCaseDivider');
  });
});

/* ── [FIX-20260825-NOSYSLINEONREOPEN] ────────────────────────────────────────
 * เจ้าของ 25/08 รายงานว่าป้ายส้ม "เคสนี้สร้างโดยระบบ" **เลื่อนตาม** ทุกครั้งที่กด
 * เปิดเคสในห้องที่ปิดไปแล้ว แล้วสรุปเป็นกติกาว่า *"มันก็ไม่ควรจะมีไง เวลาเปิดเคส
 * (ที่ถูกปิด)"* — เคสที่คนกดเปิด ไม่ใช่เคสที่ระบบสร้าง
 *
 * แถวตัวอย่างข้างล่างคัดรูปมาจากของจริงในฐาน 25/08:
 *   {"variant":"reopen_by_admin","actor_name":"dev (Developer)",
 *    "ticket_id":"a0d00000000000000000009a"}
 */
import { caseOpenedByAdmin } from '../components/chat/caseDividerWritten';

const adminOpenRow = (variant: string, ticketId: string) => ({
  message_type: 'divider',
  content: 'เปิดเคส โดย dev (Developer)',
  metadata: { variant, actor_name: 'dev (Developer)', ticket_id: ticketId },
});

describe('[NOSYSLINEONREOPEN] บทสนทนาบอกได้ว่าเคสใบนี้ใครเปิด', () => {
  it('⭐⭐ (T1) แอดมินกดเปิดเคสที่ปิดไปแล้ว = คนเปิด', () => {
    expect(caseOpenedByAdmin([adminOpenRow('reopen_by_admin', TICKET)], TICKET)).toBe(true);
  });

  it('⭐⭐ (T2) แอดมินเปิดเคสแรกของห้อง (ไม่ใช่ reopen) ก็คือคนเปิดเหมือนกัน', () => {
    /* BE แยกสอง variant ไว้เพื่อรายงาน แต่คำถามของป้ายส้มคือ "ระบบสร้างหรือเปล่า"
       ซึ่งคำตอบเหมือนกันทั้งคู่ · ตกตัวใดตัวหนึ่ง = ป้ายโผล่ผิดครึ่งหนึ่งของเคส */
    expect(caseOpenedByAdmin([adminOpenRow('open_by_admin', TICKET)], TICKET)).toBe(true);
  });

  it('⭐⭐⭐ (T3) ผูกกับ "ใบนี้" ไม่ใช่ "ห้องนี้เคยมีไหม"', () => {
    /* กับดักเดิมที่เคยทำให้เคสสลิปหายป้ายไปทั้งเส้น (ดูเคส BOTH kinds ข้างบน) ·
       ห้องที่เคยมีคนกดเปิดเคสใบก่อน ต้องไม่ไปปิดป้ายของเคสที่ระบบสร้างใบใหม่ */
    const stream = [adminOpenRow('reopen_by_admin', OTHER_TICKET)];
    expect(caseOpenedByAdmin(stream, OTHER_TICKET)).toBe(true);
    expect(caseOpenedByAdmin(stream, TICKET)).toBe(false);
  });

  it('⭐⭐ (T4) เคสที่ระบบสร้างจริง ๆ ยังตอบว่าไม่ใช่คนเปิด', () => {
    // ป้ายส้มของเคสแบบนี้ต้องยังขึ้นเหมือนเดิม — นี่คือครึ่ง seamless
    expect(caseOpenedByAdmin([stampedRow(TICKET)], TICKET)).toBe(false);
    expect(caseOpenedByAdmin([slipRow], TICKET)).toBe(false);
  });

  it('⭐ (T5) แถวเก่าที่ไม่มี ticket_id อ่านว่าไม่ตรง ⇒ ของเดิมไม่กระทบ', () => {
    const legacy = { message_type: 'divider', metadata: { variant: 'reopen_by_admin' } };
    expect(caseOpenedByAdmin([legacy], TICKET)).toBe(false);
  });

  it('⭐ (T6) ไม่มี id / ไม่ใช่อาเรย์ / แถวขยะ = false ไม่ใช่ระเบิด', () => {
    expect(caseOpenedByAdmin([adminOpenRow('reopen_by_admin', TICKET)], null)).toBe(false);
    expect(caseOpenedByAdmin(null, TICKET)).toBe(false);
    expect(caseOpenedByAdmin([null, 7, {}, { message_type: 'text' }], TICKET)).toBe(false);
  });

  it('⭐ (T7) ข้อความธรรมดาที่ metadata หน้าตาเหมือนกัน ไม่นับ', () => {
    const fake = {
      message_type: 'text',
      metadata: { variant: 'reopen_by_admin', ticket_id: TICKET },
    };
    expect(caseOpenedByAdmin([fake], TICKET)).toBe(false);
  });
});

describe('[NOSYSLINEONREOPEN] ต่อสายเข้าหน้าจอแล้วจริง', () => {
  const view = readFileSync(
    resolve(process.cwd(), 'components/chat/ChatRoomView.tsx'),
    'utf8',
  )
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('⭐⭐ (T8) ผลถูกใช้ปิดการวาดป้ายจริง ไม่ใช่คำนวณทิ้ง', () => {
    expect(view).toContain('caseOpenedByAdmin(messages, ticketMeta?._id)');
    expect(view, 'ต้องอยู่ในเงื่อนไขเดียวกับที่ตัดสินว่าจะวาดหรือไม่').toContain(
      '!caseOpenedByHand',
    );
  });

  it('⭐⭐ (T9) ตัวกันเดิมยังอยู่ครบ — เพิ่มเงื่อนไข ไม่ได้แทนที่', () => {
    expect(view).toContain('!caseLineAlreadyDrawn');
    expect(view).toContain("ticketMeta?.direct_ticket === true");
  });
});
