import { plainToInstance } from 'class-transformer';

import { TicketsService, UpdateTicketDto } from '@/modules/tickets';

/**
 * ==== [FIX-20260830-CLAIMRACEGUARD] รับเคสพร้อมกัน "โดยไม่ส่ง expected" ======
 *
 * [FIX-20260823-CLAIMCAS] กันการแย่งเคสไว้แล้ว — แต่กันแบบ **opt-in**: ต้องให้
 * ผู้เรียกส่ง `expected_admin_user_id` มาเองถึงจะมีเงื่อนไขเจ้าของในฟิลเตอร์
 * (`cas-requested.util.ts` · เจตนาเดิมคือ "ไม่ส่ง = พฤติกรรมเดิมทุกบรรทัด"
 *  เพื่อไม่ให้ **โอนเคส** พังซ้ำรอย `[FIX-20260824-CASGHOST]`)
 *
 * 🔴 ช่องที่เหลืออยู่ — วัดจากโค้ด FE จริง ไม่ใช่สมมติ:
 *   ปุ่ม "รับเคส" บนหน้าจอมี **สี่ทาง** และมีทางเดียวที่ส่ง expected มา
 *     ส่ง    · TicketChat.tsx:1105  handleExecuteClaim
 *     ไม่ส่ง · TicketChat.tsx:2862  executeAction (targetStatus 1)
 *     ไม่ส่ง · TicketSupport.tsx:978 executeJobAction (targetStatus 1)
 *     ไม่ส่ง · TicketSupport.tsx:1156 handleOperatorChange (0 → 1)
 *   ⇒ สามในสี่ทางยังเป็น last-write-wins: สองคนกดพร้อมกัน **สำเร็จทั้งคู่**
 *     ได้ 200 ทั้งคู่ ไม่มี error ไม่มี log · คนแรกเห็นบนจอว่าตัวเองได้เคส
 *     ทั้งที่ DB เป็นของคนที่เขียนทีหลัง
 *
 * เทสนี้ตรึง **สองด้าน** เท่า ๆ กัน:
 *   ด้านที่ต้องกัน   — รับเคสบนตั๋วที่ยังว่าง ต้องมีเงื่อนไข "ต้องยังว่างอยู่" ในฟิลเตอร์
 *   ด้านที่ต้องไม่เปลี่ยน — โอนเคส / ปิดเคส / แก้ field ธรรมดา / รับเคสที่ส่ง expected
 *                        ต้องเหมือนเดิมทุกตัวอักษร (ด้านนี้คือด้านที่พังเงียบ
 *                        และเป็นบั๊กจริงเมื่อ 24/08 ที่ทำโอนเคสพังทั้งระบบ)
 *
 * ⚠️ ห้ามลบ `viaPipe()` — เหตุผลเดียวกับ `ticket-claim-cas.spec.ts`:
 *    `ValidationPipe({transform:true})` ใส่ทุก property ของ DTO ลงมาเป็น
 *    `undefined` เสมอ ⇒ ส่ง object ดิบจะพิสูจน์อะไรไม่ได้เลย
 */

const ID = 'a0d000000000000000000016';
const ADMIN_A = 'a0d000000000000000000043';
const ADMIN_B = 'a0d000000000000000000044';
/** ผู้แย่งตัวจริง — คนที่ชนะไปก่อนหน้าเสี้ยววินาที */
const ADMIN_C = 'a0d000000000000000000085';

type Before = Record<string, unknown> | null;

const viaPipe = (body: Record<string, unknown>): Record<string, unknown> => ({
  ...(plainToInstance(UpdateTicketDto, body, {
    enableImplicitConversion: true,
  }) as unknown as Record<string, unknown>),
});

/**
 * `after` = สิ่งที่การอ่านครั้งที่สอง (หลังเขียนไม่ติด) เห็น — จำเป็นต่อการจำลอง
 * "ถูกแย่ง" เพราะการถูกแย่งแปลว่าเจ้าของเปลี่ยนไประหว่างสองการอ่าน
 */
function buildService(
  before: Before,
  result: Record<string, unknown> | null,
  after: Before = before,
) {
  const findOneAndUpdate = jest.fn(() => {
    const query: Record<string, unknown> = {
      populate: jest.fn(() => query),
      lean: jest.fn(() => Promise.resolve(result)),
    };
    return query;
  });
  let reads = 0;
  const ticketModel = {
    findById: () => ({
      select: () => ({
        lean: () => Promise.resolve(++reads === 1 ? before : after),
      }),
    }),
    findOneAndUpdate,
  };
  const service = new TicketsService(
    ticketModel as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    /* [FEAT-20260905-CUSTPROV PART 3] the tier reader takes its paths from the
       active provider now. This suite is not about tiers, so the default entry
       is enough — but it must be PRESENT, or the service cannot construct. */
    {
      resolve: () => ({
        tierPaths: ['data.profile.tier', 'profile.tier', 'tier'],
      }),
    } as never,
  );
  jest
    .spyOn(service as never, 'publishScopedTicketEvent')
    .mockReturnValue(undefined as never);
  jest
    .spyOn(service as never, 'populateAttachedFiles')
    .mockImplementation(((t: unknown) => Promise.resolve(t)) as never);
  return { service, findOneAndUpdate };
}

const filterOf = (fn: jest.Mock): Record<string, unknown> =>
  (fn.mock.calls[0] as unknown[] | undefined)?.[0] as Record<string, unknown>;

const setOf = (fn: jest.Mock): Record<string, unknown> =>
  (
    (fn.mock.calls[0] as unknown[] | undefined)?.[1] as {
      $set?: Record<string, unknown>;
    }
  )?.$set ?? {};

/** เงื่อนไข "ตั๋วต้องยังไม่มีเจ้าของ" ที่ต้องอยู่ในฟิลเตอร์ของคำสั่งเขียน */
const UNOWNED = { $in: [null, undefined] };

describe('[CLAIMRACEGUARD] 🔴 รับเคสบนตั๋วที่ยังว่าง — ต้องกันแม้ไม่ส่ง expected', () => {
  it('⭐⭐ รับเคส (0 → 1) ไม่ส่ง expected → ฟิลเตอร์ต้องบังคับว่า "ต้องยังว่างอยู่"', async () => {
    /* นี่คือปุ่มรับเคสของ TicketSupport.tsx:978 และ TicketChat.tsx:2862 เป๊ะ ๆ
       ก่อน fix: ฟิลเตอร์เป็น {_id, job_status:{$ne:2}} ⇒ สองคนกดพร้อมกันติดทั้งคู่ */
    const { service, findOneAndUpdate } = buildService(
      { job_status: 0 },
      { _id: ID, job_status: 1 },
    );

    await service.updateTicket(
      ID,
      viaPipe({ job_status: 1, admin_user_id: ADMIN_B }),
    );

    expect(filterOf(findOneAndUpdate)).toMatchObject({
      admin_user_id: UNOWNED,
    });
    // ค่าที่เขียนต้องไม่เปลี่ยน — guard อยู่ในฟิลเตอร์ ไม่ใช่ใน $set
    expect(setOf(findOneAndUpdate)).toMatchObject({ admin_user_id: ADMIN_B });
  });

  it('⭐⭐ มอบหมายผู้ดูแลบนตั๋วที่ยังว่าง (TicketSupport:1156) → ต้องกันเหมือนกัน', async () => {
    /* `handleOperatorChange` ส่ง admin_user_id + job_status(0→1) โดยไม่ส่ง expected
       — เป็น "การรับเคส" ทุกความหมาย ไม่ใช่การโอน */
    const { service, findOneAndUpdate } = buildService(
      { job_status: 0 },
      { _id: ID, job_status: 1 },
    );

    await service.updateTicket(
      ID,
      viaPipe({
        admin_user_id: ADMIN_B,
        job_status: 1,
        assigned_at: new Date(),
        chat_status: 'admin',
      }),
    );

    expect(filterOf(findOneAndUpdate)).toMatchObject({
      admin_user_id: UNOWNED,
    });
  });

  it('⭐⭐ ตั๋วว่างแต่ job_status เป็น 1 อยู่แล้ว (unassign มาก่อน) → ยังต้องกัน', async () => {
    /* กันไว้ไม่ให้ fix ไปผูกกับ "0 → 1" เพราะความว่างของเจ้าของต่างหากคือสิ่งที่แย่งกัน
       ถ้าผูกกับสถานะ ตั๋วที่ถูกปลดเจ้าของ (job_status 1, admin_user_id null) จะเป็นรู */
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: null },
      { _id: ID },
    );

    await service.updateTicket(ID, viaPipe({ admin_user_id: ADMIN_B }));

    expect(filterOf(findOneAndUpdate)).toMatchObject({
      admin_user_id: UNOWNED,
    });
  });

  it('⭐⭐ คนที่แพ้ต้องได้ข้อความ "ถูกรับไปแล้ว" ไม่ใช่ "ถูกปิดไปแล้ว"', async () => {
    /* 🔴 ข้อความนี้คือสิ่งที่ FE ใช้แยกแยะ — TicketChat.tsx:1090 จับด้วย regex
       /ถูกรับไปแล้วโดยแอดมินท่านอื่น/ เพื่อ **ไม่ปิดหน้าเคสทิ้ง** (เคสยังเปิดอยู่
       แค่เปลี่ยนมือ) · ถ้าตอบว่า "ถูกปิดไปแล้ว" แอดมินจะไปตามหาสาเหตุผิดทาง
       ก่อน fix: เขียนติดทั้งคู่ จึงไม่มีใครแพ้ และไม่มีข้อความนี้เลย */
    const { service } = buildService(
      { job_status: 0 }, // ตอนอ่านครั้งแรก ยังว่าง
      null, // เขียนไม่ติด — มีคนแย่งไปแล้ว
      { job_status: 1, admin_user_id: ADMIN_C }, // อ่านอีกที: ADMIN_C ถือไปแล้ว
    );

    await expect(
      service.updateTicket(
        ID,
        viaPipe({ job_status: 1, admin_user_id: ADMIN_B }),
      ),
    ).rejects.toThrow(/ถูกรับไปแล้วโดยแอดมินท่านอื่น/);
  });
});

describe('[CLAIMRACEGUARD] ⭐ ด้านที่ต้องไม่เปลี่ยน — seamless (บั๊ก 24/08 ห้ามกลับมา)', () => {
  it('⭐ โอนเคส (ตั๋วมีเจ้าของ → คนอื่น) — ห้ามมีเงื่อนไขเจ้าของ', async () => {
    /* payload จริงจาก stg-omnidesk ที่เคยได้ 409 ผิด ๆ ตอน [FIX-20260824-CASGHOST]
       ถ้า fix นี้ทำให้เคสนี้ติด guard = ทำบั๊กเดิมกลับมา = ห้ามเด็ดขาด */
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID },
    );

    await service.updateTicket(ID, viaPipe({ admin_user_id: ADMIN_B }));

    expect(filterOf(findOneAndUpdate)).not.toHaveProperty('admin_user_id');
  });

  it('⭐ ปิดเคสของตัวเอง — ห้ามมีเงื่อนไขเจ้าของ และ $ne:2 ต้องยังอยู่', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID, job_status: 2 },
    );

    await service.updateTicket(ID, viaPipe({ job_status: 2 }));

    const f = filterOf(findOneAndUpdate);
    expect(f).toMatchObject({ job_status: { $ne: 2 } });
    expect(f).not.toHaveProperty('admin_user_id');
  });

  it('⭐ แก้ need_detail / category เฉย ๆ — ห้ามมีเงื่อนไขเจ้าของ', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID },
    );

    await service.updateTicket(ID, viaPipe({ need_detail: 'x' }));

    expect(filterOf(findOneAndUpdate)).not.toHaveProperty('admin_user_id');
  });

  it('⭐ รับเคสที่ส่ง expected มาจริง — ต้องใช้ค่าที่ส่งมา ไม่ใช่ค่าที่ derive เอง', async () => {
    /* เส้นของ TicketChat.tsx:1105 — guard เดิมต้องชนะ ห้ามถูก fix นี้กลบ */
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID },
    );

    await service.updateTicket(
      ID,
      viaPipe({ admin_user_id: ADMIN_B, expected_admin_user_id: ADMIN_A }),
    );

    expect(filterOf(findOneAndUpdate)).toMatchObject({
      admin_user_id: ADMIN_A,
    });
  });

  it('⭐⭐ ตั๋ว**ว่าง** + ส่ง expected มา → ต้องใช้ค่าที่ส่งมา (casRequested ชนะเสมอ)', async () => {
    /* 🔴 เคสนี้คือเคสเดียวที่แยก "casRequested ชนะ" ออกจาก "isUnownedClaim ชนะ" ได้
       ═══════════════════════════════════════════════════════════════════════
       เคส "รับเคสต่อ" ข้างล่างใช้ `before` ที่**มีเจ้าของ** ⇒ `isUnownedClaim` เป็นเท็จ
       อยู่แล้วไม่ว่าจะเรียงสาขายังไง ⇒ มันพิสูจน์ลำดับสาขาไม่ได้เลย
       ต้องใช้ `before` ที่ **ว่าง** คู่กับ expected ที่ **ไม่ว่าง** ทั้งสองเงื่อนไขจึงจริงพร้อมกัน
       ⇒ ถ้าใครสลับลำดับ ternary (เอา isUnownedClaim ขึ้นก่อน) เทสนี้แดงทันที
       ของจริงที่กัน: ผู้กดเห็นว่า A ถืออยู่ แต่ตั๋วถูกปล่อยว่างไปแล้ว ⇒ ต้อง 409
       ไม่ใช่เขียนติดเงียบ ๆ บนความคาดหวังที่ล้าสมัย (reviewer จับได้ก่อน merge) */
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: null },
      { _id: ID },
    );

    await service.updateTicket(
      ID,
      viaPipe({ admin_user_id: ADMIN_B, expected_admin_user_id: ADMIN_A }),
    );

    expect(filterOf(findOneAndUpdate)).toMatchObject({
      admin_user_id: ADMIN_A,
    });
  });

  it('⭐ ปลดเจ้าของ (ส่ง admin_user_id: null) — ห้ามมีเงื่อนไขเจ้าของ', async () => {
    /* ไม่ใช่การ "รับ" — ไม่มีใครแย่งอะไรกัน ⇒ ต้องไม่ติด guard */
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID },
    );

    await service.updateTicket(ID, viaPipe({ admin_user_id: null }));

    expect(filterOf(findOneAndUpdate)).not.toHaveProperty('admin_user_id');
  });

  it('⭐ ตั๋วหาไม่เจอ (before = null) — ห้าม derive guard จากอากาศ', async () => {
    const { service, findOneAndUpdate } = buildService(null, null);

    await expect(
      service.updateTicket(ID, viaPipe({ admin_user_id: ADMIN_B })),
    ).rejects.toThrow();

    expect(filterOf(findOneAndUpdate)).not.toHaveProperty('admin_user_id');
  });
});
