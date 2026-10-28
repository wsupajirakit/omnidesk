/**
 * ==== [FIX-20260811-RETRYSCHEMA] schema ต้องรับทุก field ที่ runner เขียนจริง ====
 *
 * 🔴 ทำไมไฟล์นี้ต้องมี — บั๊กที่มันกัน:
 * `payment-runner.service.ts:1615-1628` เขียน `resume_cursor` + `awaiting_retry_at`
 * ตอน pause run เพื่อรอปุ่ม [ลองใหม่] แต่ `handoff-chain-run.schema.ts` **ไม่ได้ประกาศ
 * 2 field นั้น** และ `@Schema()` ไม่ตั้ง `strict` ⇒ ใช้ default `strict: true` ของ
 * mongoose ซึ่ง **ตัด field ที่ไม่รู้จักทิ้งเงียบ ไม่ error**
 * `updateOne` ตอบ `modifiedCount: 1` เหมือนสำเร็จ แต่ค่าไม่ถึง DB
 * ⇒ claim ใน `_resume` (filter มี `resume_cursor`) จับไม่เจอ
 * ⇒ **ปุ่ม [ลองใหม่] ตอบ `stale_retry` ทุกครั้ง** = กดแล้วไม่ทำงาน
 *
 * 🔴 ทำไมเทสที่มีอยู่จับไม่ได้ — และทำไมเทสนี้ต้องไม่ mock:
 * `paytool-p2-runner.spec.ts:491` mock `runModel` เป็น `Record<string, unknown>[]`
 * แล้ว `Object.assign` ตรง ๆ ⇒ **ไม่มี schema มาตัด field เลย** เทส `(D7b)` จึง assert
 * `resume_cursor === 1` แล้วผ่าน ทั้งที่ production ทิ้งค่านั้น
 * ⇒ ไฟล์นี้จึงเทสกับ **`HandoffChainRunSchema` ตัวจริง** ไม่ผ่าน mock ใด ๆ
 * เป็นเทส "contract ระหว่างโค้ดที่เขียน กับ schema ที่ยอมรับ" ซึ่ง mock ปิดตาไว้
 *
 * ⚠️ ไม่ต้องต่อ Mongo — `schema.path()` และ `new Model(...).toObject()` ทำงานใน memory
 * (mongoose บังคับ strict ตอน hydrate ไม่ต้องรอ write) จึงรันในชุด unit ได้ ไม่ต้องมี DB
 * หมายเหตุ: mongoose 9.9.1 **ไม่มี** `schema.castObject()` — ลองแล้วได้
 * `castObject is not a function` จึงใช้ทาง model แทน
 *
 * กฎสำหรับรอบหน้า: เพิ่ม field ที่ runner เขียน ⇒ ต้องเพิ่ม `@Prop` **และ**
 * เพิ่มชื่อใน `WRITTEN_BY_RUNNER` ข้างล่าง ไม่งั้นเทสนี้แดง
 */
import { model } from 'mongoose';

import { HandoffChainRunSchema } from '@/modules/handoff/schemas/handoff-chain-run.schema';

/** model ชั่วคราวสำหรับทดสอบกฎ strict — ชื่อไม่ซ้ำเพื่อไม่ชนกับ model จริงของแอป
 *  ไม่ต้อง connect: การ hydrate เอกสารเกิดใน memory ทั้งหมด */
const TestRun = model('HandoffChainRunContractTest', HandoffChainRunSchema);
/** ส่งเข้า schema แล้วดูว่าอะไรรอด = จำลองสิ่งที่เกิดตอนเขียนจริง */
const throughSchema = (doc: Record<string, unknown>) =>
  new TestRun(doc).toObject() as unknown as Record<string, unknown>;

/** ทุก field ที่ `payment-runner.service.ts` เขียนลง `handoff_chain_runs` จริง
 *  (ไล่จาก `$set` ทุกจุดใน runner — ไม่ใช่เดา) */
const WRITTEN_BY_RUNNER = [
  'chain_key',
  'env_tag',
  'hook_id',
  'member_user_id',
  'subject_type',
  'subject_id',
  'slip_record_id',
  'raw_transaction',
  'status',
  'cursor',
  'current_step_order',
  'reply_token',
  'needs_review',
  'started_at',
  'ended_at',
  // [FIX-20260811-RETRYSCHEMA] 2 ตัวนี้คือของที่หายไปและทำให้ปุ่มพัง
  'resume_cursor',
  'awaiting_retry_at',
] as const;

/** สถานะทุกค่าที่ runner set ลง `status` จริง */
const STATUSES_WRITTEN = [
  'running',
  'succeeded',
  'stopped',
  'replied',
  'locked_review',
  'failed',
  'awaiting_retry', // [FIX-20260811-RETRYSCHEMA]
] as const;

describe('[FIX-20260811-RETRYSCHEMA] handoff_chain_runs schema contract', () => {
  it('★ ทุก field ที่ runner เขียน ต้องมี @Prop — ไม่งั้น strict:true ตัดทิ้งเงียบ', () => {
    const missing = WRITTEN_BY_RUNNER.filter(
      (f) => !HandoffChainRunSchema.path(f),
    );
    expect(missing).toEqual([]);
  });

  it('★★ resume_cursor + awaiting_retry_at ต้องรอดจาก strict (ตัวที่เคยหาย)', () => {
    // hydrate ผ่าน model จริง = เดินกฎ strict ตัวเดียวกับที่ save/updateOne ใช้
    // field ที่ไม่ถูกประกาศจะไม่ปรากฏในผลลัพธ์ = อาการที่เจอใน production เป๊ะ
    const cast = throughSchema({
      chain_key: 'X',
      env_tag: 'dev',
      member_user_id: 'U1',
      subject_type: 'slip',
      status: 'awaiting_retry',
      cursor: 0,
      resume_cursor: 1,
      awaiting_retry_at: new Date('2026-08-11T00:00:00Z'),
      reply_token: 'RT',
      needs_review: false,
    });

    expect(cast.resume_cursor).toBe(1);
    expect(cast.awaiting_retry_at).toBeInstanceOf(Date);
    expect(cast.status).toBe('awaiting_retry');
  });

  it('★ status enum ต้องรับทุกค่าที่ runner set — create/save จะ throw ถ้าขาด', () => {
    // `updateOne` ข้าม enum validation จึงไม่เคยฟ้อง แต่ `create`/`save` ฟ้อง
    // ⇒ ค่าที่ขาดใน enum เป็นระเบิดเวลา ไม่ใช่แค่เรื่องความสะอาด
    const declared = HandoffChainRunSchema.path('status') as unknown as {
      enumValues: string[];
    };
    const missing = STATUSES_WRITTEN.filter(
      (s) => !declared.enumValues.includes(s),
    );
    expect(missing).toEqual([]);
  });

  it('resume_cursor เป็น Number และ awaiting_retry_at เป็น Date (ชนิดต้องตรง)', () => {
    // ชนิดผิด = ค่าถูก cast เพี้ยน แล้ว claim จับไม่เจออีกแบบหนึ่ง
    expect(HandoffChainRunSchema.path('resume_cursor').instance).toBe('Number');
    expect(HandoffChainRunSchema.path('awaiting_retry_at').instance).toBe(
      'Date',
    );
  });

  it('ทั้งสอง field เป็น optional — แถวเดิมที่ไม่มีค่าต้องไม่พัง', () => {
    // additive ไม่ต้อง migrate: run ที่ไม่เคย pause จะไม่มี 2 field นี้
    expect(HandoffChainRunSchema.path('resume_cursor').isRequired).toBeFalsy();
    expect(
      HandoffChainRunSchema.path('awaiting_retry_at').isRequired,
    ).toBeFalsy();
  });

  it('★ claim filter ของ _resume cast ได้ครบ — ไม่มี field ไหนหลุด', () => {
    // เงื่อนไขจริงจาก payment-runner.service.ts:777-779 ถ้า field ใดถูกตัด
    // filter จะแคบลงเงียบ ๆ แล้วจับไม่เจอ ซึ่งคืออาการเดิมเป๊ะ
    const filter = throughSchema({
      status: 'awaiting_retry',
      resume_cursor: 3,
    });
    expect(filter.status).toBe('awaiting_retry');
    expect(filter.resume_cursor).toBe(3);
  });
});
