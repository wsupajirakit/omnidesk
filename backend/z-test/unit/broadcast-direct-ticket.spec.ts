/**
 * [FEAT-20260825-BCASTDIRECTTICKET] multicast แล้วเปิดเคสรอไว้ให้
 * ===========================================================================
 * สิ่งที่ต้องได้: option สำหรับ multicast เท่านั้น · ติ๊กหรือไม่ก็ได้ · ติ๊กแล้ว
 * คนที่ได้รับจะถูกเปิด direct ticket ให้ โดยเหตุผลใช้ข้อความเดียวกับช่อง
 * "แคมเปญนี้ทำเพื่ออะไร" · เส้น divider ต้องเป็นเส้นเดียวกับที่ระบบใช้อยู่แล้ว
 * (ห้ามทำเอง จะซ้ำ) · seamless ห้ามกระทบการส่ง
 */
import {
  openDirectTicketsForReached,
  wantsDirectTicket,
  needTextFor,
  dividerTextFor,
  TICKET_CATEGORY,
} from '@/modules/content';

const ROOM = 'a0d00000000000000000002d';
const HOOK = 'a0d00000000000000000002e';

const buildDeps = (openImpl?: () => Promise<unknown>) => {
  const warned: string[] = [];
  const rooms = [{ _id: ROOM }];
  const created: Array<Record<string, unknown>> = [];
  const deps = {
    /* ประตูกลางเรียก `create` บนสองโมเดลนี้ · สตับให้ครบเพื่อให้เทสเดินผ่าน
       **ตัวจริง** ไม่ใช่เดินผ่านของปลอมที่เราเขียนเลียนแบบเอง — ถ้าวันหนึ่ง
       ประตูเปลี่ยนวิธีสร้าง ticket เทสนี้จะแดง ซึ่งเป็นสิ่งที่ต้องการ */
    ticketModel: {
      create: (doc: Record<string, unknown>) => {
        created.push(doc);
        return Promise.resolve({ _id: 't1', ...doc });
      },
    } as never,
    chatRoomModel: {
      find: () => ({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve(rooms) }),
        }),
      }),
      // openTicketBySystem อ่านห้องเองด้วย — คืนห้องที่ยังไม่ถูกจอง
      findById: () => ({
        lean: () => Promise.resolve({ user_id: 'm1', hook_id: HOOK }),
      }),
      findOneAndUpdate: () =>
        openImpl
          ? { lean: () => openImpl() }
          : { lean: () => Promise.resolve({ _id: ROOM }) },
    } as never,
    chatMessageModel: { create: () => Promise.resolve({ _id: 'd1' }) } as never,
    assignHistoryModel: { create: () => Promise.resolve({}) } as never,
    warn: (m: string) => warned.push(m),
  };
  return { deps, warned, created };
};

const JOB = (over: Record<string, unknown> = {}) => ({
  name: 'โปรเดือนสิงหา',
  description: 'แจ้งลูกค้าว่าแบงค์กลับมาปกติแล้ว',
  is_direct_ticket: true,
  ...over,
});

describe('[BCASTDIRECTTICKET] §1 กฎล้วน — ปรับได้ที่ไฟล์เดียว', () => {
  it('⭐⭐ (T1) ไม่ติ๊ก / ไม่มีคอลัมน์ = ไม่เปิด', () => {
    expect(wantsDirectTicket(JOB({ is_direct_ticket: false }))).toBe(false);
    expect(wantsDirectTicket({ name: 'งานเก่าที่ไม่มีคอลัมน์นี้' })).toBe(
      false,
    );
    expect(wantsDirectTicket(null)).toBe(false);
    /* ค่าที่ "ดูเหมือนจริง" ต้องไม่นับ — คอลัมน์นี้ไม่มี default แถวเก่าจึงว่าง
       และค่าขยะที่หลุดเข้ามาต้องแปลว่าไม่เปิด ไม่ใช่เปิด */
    for (const v of [1, 'true', 'yes', {}]) {
      expect(wantsDirectTicket({ is_direct_ticket: v })).toBe(false);
    }
  });

  it('⭐⭐ (T2) เหตุผลของเคส = ข้อความ "แคมเปญนี้ทำเพื่ออะไร" ตัวเดียวกัน', () => {
    expect(needTextFor(JOB())).toBe('แจ้งลูกค้าว่าแบงค์กลับมาปกติแล้ว');
    expect(needTextFor(JOB({ description: '  เว้นวรรครอบข้าง  ' }))).toBe(
      'เว้นวรรครอบข้าง',
    );
    expect(needTextFor({})).toBe('');
  });

  it('⭐ (T3) ข้อความบน divider แยกฟังก์ชันไว้ เผื่อวันหนึ่งไม่เหมือนกัน', () => {
    /* วันนี้เหมือนกัน แต่แยกไว้ตั้งแต่แรกเพราะสองอย่างนี้มีโอกาสแยกทางกันสูง */
    expect(dividerTextFor(JOB())).toBe(needTextFor(JOB()));
  });

  it('⭐ (T4) หมวดของเคสเป็นค่าที่คอลเลกชันถือจริง', () => {
    expect(['Other', 'Payment']).toContain(TICKET_CATEGORY);
  });
});

describe('[BCASTDIRECTTICKET] §2 พฤติกรรมตอนรันจริง', () => {
  const reached = new Map([[HOOK, ['U1']]]);

  it('⭐⭐ (T5) ติ๊กไว้ + มีคนได้รับ ⇒ เปิดเคสให้', async () => {
    const { deps, created } = buildDeps();
    const r = await openDirectTicketsForReached(JOB(), reached, deps);
    expect(r.opened).toBe(1);
    expect(r.failed).toBe(0);
    /* ⭐ ตรวจ "ของที่ถูกเขียนจริง" ไม่ใช่แค่ตัวนับ — เหตุผลของเคสต้องเป็นข้อความ
       ช่อง "แคมเปญนี้ทำเพื่ออะไร" ตัวเดียวกันเป๊ะ */
    expect(created).toHaveLength(1);
    expect(created[0]?.need_detail ?? created[0]?.needDetail ?? '').toBe(
      'แจ้งลูกค้าว่าแบงค์กลับมาปกติแล้ว',
    );
  });

  it('⭐⭐ (T6) ไม่ติ๊ก ⇒ ไม่แตะอะไรเลย', async () => {
    const { deps } = buildDeps();
    const r = await openDirectTicketsForReached(
      JOB({ is_direct_ticket: false }),
      reached,
      deps,
    );
    expect(r).toEqual({ opened: 0, skipped: 0, failed: 0 });
  });

  it('⭐⭐ (T7) ไม่มีใครได้รับ (เช่นงาน broadcast) ⇒ ไม่เปิดให้ใคร', async () => {
    /* broadcast ไม่มีรายชื่อผู้รับ ⇒ ตัวเรียกส่ง map ว่างมา ⇒ เงียบโดยธรรมชาติ
       ไม่ต้องมี if send_kind ที่ไหนเลย */
    const { deps } = buildDeps();
    const r = await openDirectTicketsForReached(JOB(), new Map(), deps);
    expect(r).toEqual({ opened: 0, skipped: 0, failed: 0 });
  });

  it('⭐⭐ (T8) ติ๊กไว้แต่ไม่มีข้อความเหตุผล ⇒ ไม่เปิด และเตือน', async () => {
    /* เคสที่เปิดมาโดยไม่บอกว่าให้ทำอะไร แย่กว่าไม่มีเคส */
    const { deps, warned } = buildDeps();
    const r = await openDirectTicketsForReached(
      JOB({ description: '   ' }),
      reached,
      deps,
    );
    expect(r.opened).toBe(0);
    expect(warned.join(' ')).toContain('แคมเปญนี้ทำเพื่ออะไร');
  });

  it('⭐⭐ (T9) ลูกค้ามีเคสเปิดอยู่แล้ว = ข้าม ไม่ใช่พัง', async () => {
    /* ตัวกันเคสซ้ำของประตูกลางทำงานถูกต้อง ⇒ ต้องไม่ถูกนับเป็น failed
       และต้องไม่ warn ไม่งั้น log จะเต็มไปด้วยเรื่องปกติ */
    const { deps, warned } = buildDeps(() => Promise.resolve(null));
    const r = await openDirectTicketsForReached(JOB(), reached, deps);
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);
    expect(warned).toEqual([]);
  });

  it('⭐⭐ (T10) SEAMLESS — พังจริงก็ยังไม่โยนออกไป', async () => {
    /* ข้อความอยู่บนมือถือลูกค้าแล้ว เปิดเคสพลาดต้องไม่ทำให้แคมเปญที่สำเร็จ
       กลายเป็นล้มเหลว */
    const { deps, warned } = buildDeps(() =>
      Promise.reject(new Error('mongo ล่ม')),
    );
    const r = await openDirectTicketsForReached(JOB(), reached, deps);
    expect(r.failed).toBe(1);
    expect(warned.join(' ')).toContain('mongo ล่ม');
  });
});

describe('[BCASTDIRECTTICKET] §3 ไม่ทำ divider เอง — ใช้ประตูกลาง', () => {
  const src = require('fs').readFileSync(
    require('path').join(
      process.cwd(),
      'src/modules/content/broadcast-follow-up/open-direct-ticket-on-multicast.ts',
    ),
    'utf8',
  ) as string;
  const code = src
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('⭐⭐ (P1) เรียก openTicketBySystem ไม่ได้เขียน divider เอง', () => {
    expect(code).toContain('openTicketBySystem');
    /* 🔴 เขียนเองเมื่อไหร่ = เส้นซ้ำสองเส้นในห้องเดียว · กฎ "หนึ่ง divider ต่อ
       หนึ่งเหตุการณ์" อยู่ที่ ticket-divider.helper.ts */
    expect(code).not.toContain('writeTicketDivider');
    expect(code).not.toContain('variant:');
    expect(code).not.toContain('message_type');
  });

  it('⭐⭐ (P2) import แบบ deep path ไม่ใช่ barrel (กันวงจรตอน boot)', () => {
    /* `tickets.module.ts` import `@/modules/content` อยู่ ⇒ ดึง barrel กลับ = วงจร
       ซึ่งพังแบบ schema เป็น undefined ตอน boot */
    expect(code).toContain("from '../../tickets/create-by-admin'");
    expect(code).not.toContain('@/modules/tickets');
  });
});
