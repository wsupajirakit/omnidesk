import { plainToInstance } from 'class-transformer';
import { ValidationPipe } from '@nestjs/common';

import { TicketsService, UpdateTicketDto } from '@/modules/tickets';

/**
 * ==== [FIX-20260823-CLAIMCAS] สองคนกด "รับเคสต่อ" พร้อมกัน =================
 *
 * เจ้าของสั่ง 23/08/2026: *"ต้องกัน race condition 100%"*
 *
 * อาการเดิม: ฟิลเตอร์ของคำสั่งเขียนคือ `{ _id, job_status:{$ne:2}, scope }`
 * — **ไม่มีเงื่อนไขว่าใครถืออยู่** ⇒ สองคนกดพร้อมกันสำเร็จทั้งคู่ คนกดทีหลังชนะ
 * และคนแรกไม่มีทางรู้ว่าถูกแย่ง เห็นบนจอว่าตัวเองได้เคสทั้งที่ไม่ได้
 * (`findOneAndUpdate` atomic ระดับเอกสารจริง — แต่ atomic ไม่ได้แปลว่ากันแย่ง)
 *
 * ตอนนี้: ผู้กดส่ง `expected_admin_user_id` = เจ้าของที่ **ตัวเองเห็นบนจอตอนกด**
 * เงื่อนไขถูก AND เข้าไปในฟิลเตอร์ของคำสั่งเขียน**เดียวกัน** ⇒ ไม่มีช่องว่าง
 * ระหว่างอ่านกับเขียน ⇒ กันได้ 100% ไม่ใช่แค่ลดโอกาส
 *
 * เทสนี้ตรึงสองด้าน — ด้านที่ต้องกัน และ **ด้านที่ต้องไม่เปลี่ยน** เพราะด้านหลัง
 * คือด้านที่พังเงียบ: ผู้เรียกทุกรายที่มีอยู่วันนี้ไม่ส่ง field นี้มา
 */

const ID = 'a0d000000000000000000016';
const ADMIN_A = 'a0d000000000000000000043';
const ADMIN_B = 'a0d000000000000000000044';
/* [FIX-20260824-CASGHOST] คนที่สาม — ผู้แย่งตัวจริง มีไว้เพื่อให้ "เจ้าของเปลี่ยน" เป็นเรื่องที่เกิดขึ้นจริงในเทส */
const ADMIN_C = 'a0d000000000000000000085';

type Before = Record<string, unknown> | null;

/* [FIX-20260824-CASGHOST] ⚠️ `findById` ถูกเรียก **สองครั้ง** ในคำขอเดียว และสองครั้งนี้
   เป็นคนละช่วงเวลา — ครั้งแรกอ่านก่อนเขียน ครั้งที่สองอ่าน "หลังแพ้" เพื่อดูว่าเกิดอะไรขึ้น
   ของเดิม mock คืนเอกสารใบเดียวกันทั้งสองครั้ง ⇒ จำลอง "ถูกแย่ง" ไม่ได้จริง เพราะการถูกแย่ง
   แปลว่า **เจ้าของเปลี่ยนไประหว่างสองการอ่านนั้น** ⇒ เทสผ่านได้แม้โค้ดสรุปสาเหตุมั่ว
   ⇒ `after` = สิ่งที่การอ่านครั้งที่สองเห็น (ไม่ส่ง = เหมือนเดิม ⇒ เทสอื่นไม่กระทบสักตัว)
   สองการอ่านคนละเวลา ต้อง mock คนละใบถึงจะจำลองการแย่งได้จริง */

/* [FIX-20260824-CASGHOST] 🔴 ส่ง body ผ่าน **DTO transform ตัวจริง** ก่อนเข้า service
   ═══════════════════════════════════════════════════════════════════════════
   เรียก `service.updateTicket(ID, { job_status: 2 })` ตรง ๆ **พิสูจน์บั๊กนี้ไม่ได้**
   เพราะบั๊กเกิดจาก `ValidationPipe({transform:true})` ที่ controller — มันแปลง body
   เป็น instance ของ DTO แล้ว class-transformer ใส่ **ทุก property ที่ประกาศไว้**
   ลงไปด้วยค่า `undefined` ⇒ คีย์ `expected_admin_user_id` โผล่มาเองทั้งที่ไม่มีใครส่ง
   object ธรรมดาไม่มีคีย์นั้น ⇒ ทั้งโค้ดที่ถูกและโค้ดที่พังให้ผลเท่ากัน ⇒ เทสเขียวทั้งคู่
   (เขียนพลาดมาแล้วรอบหนึ่งในไฟล์นี้ mutation จับได้ จึงต้องมีบรรทัดนี้)
   ⚠️ ห้ามลบ `viaPipe()` แล้วส่ง object ดิบ — เทสจะกลายเป็นของประดับทันที
   skill dev-local §5: เรียก service ตรง ๆ ไม่ใช่ round-trip · มันข้ามชั้นที่ field เกิด/หาย */
const viaPipe = (body: Record<string, unknown>): Record<string, unknown> => ({
  ...(plainToInstance(UpdateTicketDto, body, {
    enableImplicitConversion: true,
  }) as unknown as Record<string, unknown>),
});

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

/** ฟิลเตอร์ที่ `findOneAndUpdate` ถูกเรียกด้วยจริง */
const filterOf = (fn: jest.Mock): Record<string, unknown> =>
  (fn.mock.calls[0] as unknown[] | undefined)?.[0] as Record<string, unknown>;

/** `$set` ที่ถูกเขียนจริง */
const setOf = (fn: jest.Mock): Record<string, unknown> =>
  (
    (fn.mock.calls[0] as unknown[] | undefined)?.[1] as {
      $set?: Record<string, unknown>;
    }
  )?.$set ?? {};

describe('[CLAIMCAS] เงื่อนไขเจ้าของเข้าไปอยู่ในฟิลเตอร์ของคำสั่งเขียน', () => {
  it('⭐ ผู้กดเห็นว่า A ถืออยู่ → ฟิลเตอร์บังคับว่าต้องยังเป็น A', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID, job_status: 1, admin_user_id: ADMIN_B },
    );

    await service.updateTicket(ID, {
      admin_user_id: ADMIN_B,
      expected_admin_user_id: ADMIN_A,
    });

    expect(filterOf(findOneAndUpdate)).toMatchObject({
      admin_user_id: ADMIN_A,
    });
  });

  it('⭐ ผู้กดเห็นว่ายังว่าง → ฟิลเตอร์บังคับว่าต้องยังว่างอยู่', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 0 },
      { _id: ID, job_status: 1, admin_user_id: ADMIN_A },
    );

    await service.updateTicket(ID, {
      admin_user_id: ADMIN_A,
      expected_admin_user_id: '',
    });

    expect(filterOf(findOneAndUpdate)['admin_user_id']).toEqual({
      $in: [null, undefined],
    });
  });

  it('⭐ ค่าที่ใช้เป็นเงื่อนไข ต้องไม่ถูกเขียนลงเอกสาร', async () => {
    // ถ้าหลุดลง $set จะได้ field ขยะติดตั๋วไปตลอดกาล
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID },
    );

    await service.updateTicket(ID, {
      admin_user_id: ADMIN_B,
      expected_admin_user_id: ADMIN_A,
    });

    expect(setOf(findOneAndUpdate)).not.toHaveProperty(
      'expected_admin_user_id',
    );
    expect(setOf(findOneAndUpdate)).toMatchObject({ admin_user_id: ADMIN_B });
  });

  it('⭐ แพ้การแย่ง → บอกความจริงว่าถูกแย่ง ไม่ใช่ "ถูกปิดไปแล้ว"', async () => {
    /* ก่อนแก้ เส้นนี้ตกไปที่ `closedMessage()` ⇒ คนที่แพ้ได้ข้อความว่าเคสถูกปิด
       ซึ่งไม่จริง — เคสยังเปิดอยู่ แค่เปลี่ยนมือ ⇒ ไปตามหาสาเหตุผิดทาง
       result = null คือสิ่งที่ Mongo คืนเมื่อฟิลเตอร์ไม่ match */
    /* [FIX-20260824-CASGHOST] ADMIN_C แย่งไปได้ระหว่างที่เราอ่านกับเราเขียน ⇒ การอ่าน
       ครั้งที่สองต้องเห็น **เจ้าของคนใหม่** นั่นคือนิยามของ "ถูกแย่ง" และเป็นสิ่งเดียวที่
       ทำให้พูดคำนี้ได้อย่างซื่อสัตย์ */
    const { service } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      null,
      { job_status: 1, admin_user_id: ADMIN_C },
    );

    await expect(
      service.updateTicket(ID, {
        admin_user_id: ADMIN_B,
        expected_admin_user_id: ADMIN_A,
      }),
    ).rejects.toThrow('เคสนี้ถูกรับไปแล้วโดยแอดมินท่านอื่น');
  });

  it('เคสถูกปิดจริง → ยังได้ข้อความ "ถูกปิดไปแล้ว" เหมือนเดิม', async () => {
    // สองเหตุผลต้องแยกออกจากกัน ไม่ใช่กลบด้วยข้อความเดียว
    const { service } = buildService({ job_status: 2 }, null);

    await expect(
      service.updateTicket(ID, {
        admin_user_id: ADMIN_B,
        expected_admin_user_id: ADMIN_A,
      }),
    ).rejects.toThrow('เคสนี้ถูกปิดไปแล้ว');
  });
});

/* [FIX-20260824-CASGHOST] สามการกระทำบนหน้าจอที่ **ไม่ได้ขอ** guard เลย — และทั้งสาม
   พังพร้อมกันบน stg 24/08 เพราะ guard ติดเอง (`in` เป็น true เสมอใต้ transform)
   ⇒ ฟิลเตอร์กลายเป็น "ตั๋วต้องยังไม่มีเจ้าของ" ⇒ ตั๋วที่มีเจ้าของแล้วเขียนไม่ติดสักคำสั่ง
   เทสสามข้อนี้ยิงผ่าน `updateTicket` **ตัวจริง** ไม่ใช่ predicate เปล่า ๆ
   ⇒ ถ้าใครเผลอกลับไปใช้ `in` อีก จะแดงที่นี่ทันทีทั้งสามข้อ */
describe('[FIX-20260824-CASGHOST] ⭐ ปิดเคส / โอนเคส / เปลี่ยนหมวด — บนตั๋วที่ "มีเจ้าของแล้ว"', () => {
  it('⭐ ปิดเคสของตัวเอง — ฟิลเตอร์ต้องไม่มีเงื่อนไขเจ้าของ และต้องเขียนติด', async () => {
    /* อาการจริง 24/08: กดปิดเคส → 409 "เคสนี้ถูกรับไปแล้วโดยแอดมินท่านอื่น"
       ทั้งที่เคสเป็นของตัวเอง ไม่มีใครแย่ง (ticket 6a8b8850…) */
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID, job_status: 2 },
    );

    await service.updateTicket(ID, viaPipe({ job_status: 2 }), {
      userId: ADMIN_A,
      roleName: 'superadmin',
    } as never);

    expect(filterOf(findOneAndUpdate)).not.toHaveProperty('admin_user_id');
  });

  it('⭐ โอนเคสให้แอดมินอีกคน — payload จริงจาก stg ที่เคยได้ 409', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID },
    );

    // body ที่ curl ของเจ้าของส่งจริง — ไม่มี expected_admin_user_id
    await service.updateTicket(ID, viaPipe({ admin_user_id: ADMIN_B }));

    expect(filterOf(findOneAndUpdate)).not.toHaveProperty('admin_user_id');
  });

  it('⭐ รับเคสปกติ (ตั๋วยังไม่มีเจ้าของ 0 → 1) — ต้องเขียนติด', async () => {
    /* เส้นนี้ต่างจาก "รับเคสต่อ": ตั๋วยังว่าง ไม่มี admin_user_id และ FE ไม่ได้ส่ง
       expected มาด้วย ⇒ การเขียน **ต้องติด** · ใต้โค้ดที่พัง (`[FIX-20260824-CASGHOST]`)
       filter กลายเป็น `{admin_user_id:{$in:[null,undefined]}}` ซึ่งบังเอิญ "match"
       ตั๋วที่ยังว่าง ⇒ เส้นนี้จึงเป็นเส้นเดียวที่ **รอดมาได้** ตอนของจริงพัง — ตรงกับ
       ที่เจ้าของเจอ (รับเคสใหม่ได้ แต่โอน/ปิด/รับต่อ พัง)

       🔴 [FIX-20260830-CLAIMRACEGUARD] 30/08 — บรรทัด assert ถูกแก้ อ่านเหตุผลก่อนแก้กลับ
       ═══════════════════════════════════════════════════════════════════════
       เดิมบรรทัดนี้คือ `expect(filter).not.toHaveProperty('admin_user_id')` โดยตั้งใจ
       ให้แปลว่า "ghost-key ต้องไม่กลับมา" · แต่มันตรึงไว้แรงเกินเจตนา: มันห้าม
       **เงื่อนไขเจ้าของทุกชนิด** รวมถึงเงื่อนไข "ตั๋วต้องยังว่างอยู่" ที่จำเป็นต่อการ
       กันสองคนกดรับพร้อมกัน (ปุ่มรับเคส 3 ใน 4 ทางไม่ส่ง expected มา ⇒ เดิมคือ
       last-write-wins สำเร็จทั้งคู่ ไม่มีสัญญาณเตือน)

       ⚠️ สิ่งที่เทสนี้ต้องพิสูจน์จริง ๆ คือ **การเขียนต้องติด** (ตั๋วว่างจริง ผู้กดต้องได้)
          ไม่ใช่ "ฟิลเตอร์ต้องว่างเปล่า" — สองอย่างนี้ไม่เท่ากัน และความต่างคือ
          พฤติกรรมตอนสองคนกดชนกันเท่านั้น

       ✅ ghost-key ยังถูกกันครบ ไม่ได้อ่อนลง — เพราะบั๊กนั้นคือ "guard ติด**ทุก**คำขอ"
          ซึ่งถูกจับด้วยเคสอื่นในไฟล์นี้ที่ตั๋ว**มีเจ้าของแล้ว**: โอนเคส (:215),
          ปิดเคสของตัวเอง (:199), แก้ need_detail (:267) — ทั้งสามยังยืนยันว่า
          ฟิลเตอร์ต้องไม่มี `admin_user_id` เลย · พิสูจน์ด้วย mutation แล้ว:
          เปลี่ยน `isCasRequested` กลับไปใช้ `in` ⇒ เคสเหล่านั้นแดงทันที
       revert: กลับไปเป็น `.not.toHaveProperty('admin_user_id')` พร้อมถอด fix ที่ service */
    const { service, findOneAndUpdate } = buildService(
      { job_status: 0 },
      { _id: ID, job_status: 1 },
    );

    await service.updateTicket(
      ID,
      viaPipe({ job_status: 1, admin_user_id: ADMIN_B }),
    );

    /* เงื่อนไขที่ยอมให้มีได้มีแบบเดียว: "ต้องยังว่างอยู่" — ห้ามเป็นการเทียบกับ
       แอดมินคนใดคนหนึ่ง ซึ่งเป็นรูปที่ ghost-key สร้างและทำให้เขียนไม่ติด */
    expect(filterOf(findOneAndUpdate)).toMatchObject({
      admin_user_id: { $in: [null, undefined] },
    });
    expect(setOf(findOneAndUpdate)).toMatchObject({ admin_user_id: ADMIN_B });
  });

  it('⭐ รับเคสต่อ (ส่ง expected มาจริง) — guard ต้องติด และต้องเป็นเจ้าของคนที่เห็น', async () => {
    /* เส้นเดียวใน 4 เส้นที่ **ตั้งใจ** ให้ guard ทำงาน — ต้องไม่ถูก fix กลบไปด้วย */
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
    expect(setOf(findOneAndUpdate)).not.toHaveProperty(
      'expected_admin_user_id',
    );
  });

  it('⭐ แก้ need_detail เฉย ๆ ก็ต้องไม่ติด guard', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID },
    );

    await service.updateTicket(ID, viaPipe({ need_detail: 'x' }));

    expect(filterOf(findOneAndUpdate)).not.toHaveProperty('admin_user_id');
  });
});

describe('[CLAIMCAS] ⭐ ไม่ส่ง field นี้มา = พฤติกรรมเดิมทุกตัวอักษร', () => {
  it('เคลมแบบเดิม (ไม่ส่ง expected) → ฟิลเตอร์ไม่มีเงื่อนไขเจ้าของ', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID },
    );

    await service.updateTicket(ID, { admin_user_id: ADMIN_B });

    expect(filterOf(findOneAndUpdate)).not.toHaveProperty('admin_user_id');
  });

  it('ปิดเคส (ไม่ส่ง expected) → ฟิลเตอร์เดิม job_status:{$ne:2} ครบ', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1, admin_user_id: ADMIN_A },
      { _id: ID, job_status: 2 },
    );

    await service.updateTicket(ID, { job_status: 2 });

    const f = filterOf(findOneAndUpdate);
    expect(f).toMatchObject({ job_status: { $ne: 2 } });
    expect(f).not.toHaveProperty('admin_user_id');
  });

  it('แก้ field ธรรมดา (ไม่ส่ง expected) → ไม่มีเงื่อนไขเจ้าของ', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1 },
      { _id: ID },
    );

    await service.updateTicket(ID, { category: 'Payment' });

    expect(filterOf(findOneAndUpdate)).not.toHaveProperty('admin_user_id');
  });
});

describe('[FEAT-20260826-CLOSECLEARFU] clear_follow_up เป็นเงื่อนไข ไม่ใช่คอลัมน์', () => {
  /* 🔴 เทสนี้เกิดจาก mutation ที่ไม่แดง: ถอด `delete updateData['clear_follow_up']`
     ออกแล้วชุดเทสทั้งกอง **ยังเขียว** ⇒ flag จะไหลลง `$set` แล้วงอกเป็นฟิลด์จริง
     บนเอกสาร ticket ทุกใบที่ปิดผ่านกล่องยืนยัน โดยไม่มีใครรู้
     เหตุผลเดียวกับ `expected_admin_user_id` ที่ถูก delete อยู่ก่อนแล้ว —
     ค่าที่ใช้ "ตัดสิน" ต้องไม่ถูก "เก็บ" · ฟิลด์ที่งอกเงียบ ๆ ลบทีหลังไม่ได้ */

  it('⭐ ส่ง clear_follow_up มาแล้วต้องไม่ถูกเขียนลงเอกสาร', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1 },
      { _id: ID },
    );

    await service.updateTicket(ID, {
      job_status: 2,
      clear_follow_up: true,
    });

    const written = setOf(findOneAndUpdate);
    expect(written).not.toHaveProperty('clear_follow_up');
    // ปิดเคสยังต้องทำงานเหมือนเดิมทุกอย่าง
    expect(written).toMatchObject({ job_status: 2 });
  });

  it('⭐ ปิดเคสแบบไม่ส่ง flag → payload เท่าเดิมเป๊ะ', async () => {
    const { service, findOneAndUpdate } = buildService(
      { job_status: 1 },
      { _id: ID },
    );

    await service.updateTicket(ID, { job_status: 2 });

    expect(setOf(findOneAndUpdate)).not.toHaveProperty('clear_follow_up');
  });
});

describe('[CLAIMCAS] DTO ต้องยอมให้ field นี้ผ่าน ValidationPipe', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  });
  const meta = {
    type: 'body' as const,
    metatype: UpdateTicketDto,
    data: '',
  };

  it('⭐ field ถูกประกาศใน DTO จึงรอดจาก whitelist (main.ts:136)', async () => {
    // ไม่ประกาศ = ถูกตัดทิ้งเงียบ ๆ ก่อนถึง handler ⇒ CAS ไม่ทำงานและไม่มีใครรู้
    const out = (await pipe.transform(
      { admin_user_id: ADMIN_B, expected_admin_user_id: ADMIN_A },
      meta,
    )) as Record<string, unknown>;

    expect(out['expected_admin_user_id']).toBe(ADMIN_A);
  });

  it("สตริงว่าง ('ยังไม่มีใครถือ') ผ่านได้ ไม่ถูกตัดทิ้ง", async () => {
    const out = (await pipe.transform(
      { admin_user_id: ADMIN_A, expected_admin_user_id: '' },
      meta,
    )) as Record<string, unknown>;

    expect(out).toHaveProperty('expected_admin_user_id', '');
  });
});

/**
 * [FIX-20260827-TKTMEMBERPARAM] ชั้น 1b — fallback ของ close-case คิวรี่ผิด field
 * 📖 todo/task/27082026/todo1_27082026_tickets-line-user-id-fix.md
 * ============================================================================
 * 🔴 บั๊กแฝงในบล็อกเคลียร์ follow-up (เขียน 26/08 — โดยผมเอง): ticket ที่ไม่มี
 * `chat_user_id` จะ fallback ไปคิวรี่ `members.line_user_id` — ซึ่งเป็น **LINE
 * string** — ด้วยค่า `tickets.line_user_id` ที่จริง ๆ เป็น **member ObjectId
 * เสมอ** (วัดจริง 27/08: 17/17 แถวเป็น ObjectId · schema ก็ประกาศ
 * `ObjectId ref:'Member'`) ⇒ หา member ไม่เจอเงียบ ๆ ⇒ follow-up ไม่ถูกเคลียร์
 * โดยไม่มีใครรู้ — silent failure แบบเดียวกับ guard เงียบของชั้น 1a เป๊ะ
 * คอมเมนต์เดิมในโค้ดยังเล่าความเชื่อผิดต่อว่า "อาจเป็น LINE id แล้วแต่วิธีเปิด"
 * วันนี้ยังไม่ระเบิดเพราะทุกแถวมี chat_user_id — เทสนี้กันวันที่มันโผล่
 */
describe('[FIX-20260827-TKTMEMBERPARAM] close-case fallback หา member ด้วย _id', () => {
  it('🔴 ticket ที่มีแต่ line_user_id ⇒ member ถูกหาแบบ {_id} ไม่ใช่ {line_user_id}', async () => {
    const MID = 'a0d000000000000000000086';
    const memberFindOne = jest.fn(() => ({
      select: () => ({ lean: () => Promise.resolve(null) }),
    }));
    const before = {
      _id: ID,
      job_status: 1,
      admin_user_id: ADMIN_A,
      // แถวยุคเก่าที่ dual-write ยังไม่เคยเติม chat_user_id ให้
      line_user_id: MID,
    } as unknown as Before;
    const closed = { _id: ID, job_status: 2 };

    const findOneAndUpdate = jest.fn(() => {
      const query: Record<string, unknown> = {
        populate: jest.fn(() => query),
        lean: jest.fn(() => Promise.resolve(closed)),
      };
      return query;
    });
    const ticketModel = {
      findById: () => ({
        select: () => ({ lean: () => Promise.resolve(before) }),
      }),
      findOneAndUpdate,
    };
    const service = new TicketsService(
      ticketModel as never,
      {} as never,
      {} as never,
      {} as never,
      { findOne: memberFindOne } as never,
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

    await service.updateTicket(
      ID,
      viaPipe({ job_status: 2, clear_follow_up: true }),
      { userId: ADMIN_A } as never,
    );

    expect(memberFindOne).toHaveBeenCalledTimes(1);
    const filter = (memberFindOne.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    /* tickets.line_user_id คือ member `_id` — คิวรี่ members ต้องใช้ `_id`
       การคิวรี่ field `line_user_id` (LINE string) ด้วย ObjectId = เจอ null ตลอดกาล */
    expect(Object.keys(filter)).toEqual(['_id']);
    expect(String(filter['_id'])).toBe(MID);
  });
});
