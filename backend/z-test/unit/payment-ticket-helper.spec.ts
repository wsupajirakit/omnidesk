import { openPaymentTicketIfIdle } from '@/modules/payment/payment-ticket.helper';

/**
 * [FEAT-20260810-PAYTICKET] สัญญาของ helper เปิด ticket ตรง
 *
 * ล็อกไว้ 3 เรื่อง:
 *   (A) กันตาย — ค่าว่างต้องกลายเป็น "-" ไม่ใช่ปล่อยแถวเปล่าให้แอดมินอ่านไม่ออก
 *   (B) กันซ้ำ — ห้อง claim ไม่ได้ ⇒ ไม่สร้าง และไม่ยิง realtime
 *   (C) ไม่ throw — ทุก error ต้องถูกกลืน เพราะผู้เรียกอยู่บนเส้นทางเงิน
 */

const makeDeps = (
  o: {
    claimable?: boolean;
    member?: unknown;
    throwOnCreate?: boolean;
  } = {},
) => {
  const created: Record<string, unknown>[] = [];
  const published: unknown[] = [];
  const q = (v: unknown) => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.lean = () => c;
    c.exec = () => Promise.resolve(v);
    return c;
  };
  return {
    created,
    published,
    deps: {
      memberModel: {
        findOne: () =>
          q(o.member === undefined ? { _id: 'MEMBER1' } : o.member),
      } as never,
      chatRoomModel: {
        findOneAndUpdate: () => ({
          exec: () =>
            Promise.resolve(o.claimable === false ? null : { _id: 'ROOM1' }),
        }),
      } as never,
      ticketModel: {
        create: (doc: Record<string, unknown>) => {
          if (o.throwOnCreate) throw new Error('db down');
          created.push(doc);
          return Promise.resolve({ _id: 'T1' });
        },
      } as never,
      publishTicketNew: (d: Record<string, unknown>) => published.push(d),
      log: () => {},
      warn: () => {},
    },
  };
};

const input = (over: Record<string, unknown> = {}) => ({
  channelUserId: 'U1',
  hookId: 'HOOK1',
  needDetail: 'เหตุผลที่แอดมินอ่าน',
  directDetail: 'payment:member-not-match',
  ...over,
});

describe('openPaymentTicketIfIdle — กันตายเมื่อค่าว่าง', () => {
  it('needDetail ว่าง ⇒ ใช้ "-" ไม่ปล่อยแถวเปล่า', async () => {
    const { created, deps } = makeDeps();
    await openPaymentTicketIfIdle(input({ needDetail: '' }), deps);
    expect(created[0]!.need_detail).toBe('-');
  });

  it('needDetail เป็นช่องว่างล้วน ⇒ ก็ยังได้ "-"', async () => {
    const { created, deps } = makeDeps();
    await openPaymentTicketIfIdle(input({ needDetail: '   ' }), deps);
    expect(created[0]!.need_detail).toBe('-');
  });

  it('directDetail ว่าง ⇒ "-"', async () => {
    const { created, deps } = makeDeps();
    await openPaymentTicketIfIdle(input({ directDetail: '' }), deps);
    expect(created[0]!.direct_ticket_detail).toBe('-');
  });

  it('มีค่าจริง ⇒ ใช้ค่านั้น ไม่ถูกแทนที่', async () => {
    const { created, deps } = makeDeps();
    await openPaymentTicketIfIdle(input(), deps);
    expect(created[0]!.need_detail).toBe('เหตุผลที่แอดมินอ่าน');
    expect(created[0]!.direct_ticket_detail).toBe('payment:member-not-match');
  });
});

describe('openPaymentTicketIfIdle — กันซ้ำ / กันพัง', () => {
  it('ห้องถูก claim อยู่แล้ว ⇒ ไม่สร้าง และไม่ยิง realtime', async () => {
    const { created, published, deps } = makeDeps({ claimable: false });
    const r = await openPaymentTicketIfIdle(input(), deps);
    expect(r).toBeNull();
    expect(created).toHaveLength(0);
    // ยิง realtime ทั้งที่ไม่ได้สร้าง = หน้าเว็บเด้ง ticket ผี
    expect(published).toHaveLength(0);
  });

  it('ไม่พบ member ⇒ ไม่สร้าง (ไม่สร้าง member ผีขึ้นมา)', async () => {
    const { created, deps } = makeDeps({ member: null });
    expect(await openPaymentTicketIfIdle(input(), deps)).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('ไม่มี channelUserId/hookId ⇒ ไม่สร้าง', async () => {
    const { created, deps } = makeDeps();
    await openPaymentTicketIfIdle(input({ channelUserId: '' }), deps);
    await openPaymentTicketIfIdle(input({ hookId: null }), deps);
    expect(created).toHaveLength(0);
  });

  it('⭐ DB ล่ม ⇒ คืน null ไม่ throw (ผู้เรียกอยู่บนเส้นทางเงิน)', async () => {
    const { deps } = makeDeps({ throwOnCreate: true });
    await expect(openPaymentTicketIfIdle(input(), deps)).resolves.toBeNull();
  });

  it('สร้างสำเร็จ ⇒ ยิง ticket:new พร้อม hook_id เป็น string', async () => {
    const { published, deps } = makeDeps();
    await openPaymentTicketIfIdle(input(), deps);
    expect(published).toHaveLength(1);
    // publisher จะ drop ถ้า hook_id ว่าง/ไม่ใช่ string
    expect(typeof (published[0] as Record<string, unknown>).hook_id).toBe(
      'string',
    );
  });
});
