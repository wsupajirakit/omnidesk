import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';

import { InsightRegistrationsService } from '@/modules/tickets';

/**
 * ==== [FEAT-20260820-REGINSIGHT] registration counts for the insight page ====
 *
 * ⚠️ RESPONSE SHAPE CHANGED 2026-08-21 — every case below that spells the whole
 * `data` object gained `admin_bot_assisted`, and they went RED first, which is
 * correct: a card that grows a third bar IS a contract change and the suite is
 * supposed to say so. See the [FEAT-20260821-REGBOTASSIST] block at the end for
 * what the new bucket means. เพิ่มแท่ง = เปลี่ยนสัญญา · เทสต้องแดงก่อนเสมอ.
 *
 * Owner (2026-08-20): "Register data … แท่งกราฟแนวนอน อันแรก = สมัครโดย member
 * อันสอง = สมัครโดย admin … นับแค่จำนวน อย่าคิวรี่ member มา … filter oa ตาม
 * แท็บที่เลือก" and, on the legacy value: "system ไม่นับ ช่างมัน ปล่อยเลย".
 *
 * The three things that would make this endpoint silently useless, pinned:
 *  ⭐ counting the legacy 'system' rows (owner explicitly excluded them) or,
 *     worse, widening $in and changing what a bar means;
 *  ⭐ fetching member documents instead of counting (find/lean on a 6.9 MB
 *     collection for a 2-number card);
 *  ⭐ joining chat_rooms by String(_id) — the LIVE rows hold ObjectId in
 *     chat_rooms.user_id AND chat_rooms.hook_id (verified against the real
 *     dev DB, 2026-08-20: join by String = NOT FOUND, by ObjectId = the only
 *     shape that matches) — a string join compiles, runs, and counts zero
 *     forever.
 *
 * Mock style follows customer-link-reg-source.spec.ts: plain objects with
 * jest.fn(); no Nest testing module needed (the service has no other deps).
 */

type AggregateGroup = { _id: string; count: number };

const makeMemberModel = (groups: AggregateGroup[] = []) => ({
  aggregate: jest.fn(() => ({ exec: jest.fn(async () => groups) })),
  find: jest.fn(),
  countDocuments: jest.fn(),
});

/** hookModel is only consumed by getAllowedHookIds' group fallback. */
const makeHookModel = (ids: string[] = []) => ({
  find: jest.fn(() => ({
    select: jest.fn(() => ({
      lean: jest.fn(async () => ids.map((id) => ({ _id: id }))),
    })),
  })),
});

const HOOK_A = new Types.ObjectId().toHexString();
const HOOK_B = new Types.ObjectId().toHexString();

/** An operator scoped by the per-user whitelist (tier 2 of getAllowedHookIds). */
const scopedUser = (hooks: string[]) => ({ allowedHooks: hooks }) as never;
/** roleName 'superadmin' ⇒ getAllowedHookIds returns null (all OAs). */
const superUser = () => ({ roleName: 'superadmin' }) as never;

const svc = (member = makeMemberModel(), hook = makeHookModel()) =>
  new InsightRegistrationsService(member as never, hook as never);

describe('InsightRegistrationsService — count-only registration insights', () => {
  it('⭐ counts ONLY admin and member — the legacy "system" value is excluded by owner order', async () => {
    const member = makeMemberModel([
      { _id: 'admin', count: 2 },
      { _id: 'member', count: 3 },
      { _id: 'system', count: 9 }, // must not leak into any bucket
    ]);
    const res = await svc(member).getRegistrationCounts({}, superUser());

    const pipeline = (member.aggregate.mock.calls[0] as unknown[])[0] as Array<
      Record<string, Record<string, unknown>>
    >;
    expect(pipeline[0]?.['$match']?.['link_registered_by']).toEqual({
      $in: ['admin', 'member'],
    });
    expect(res).toEqual({
      success: true,
      data: { admin: 2, member: 3, admin_bot_assisted: 0, total: 5 },
    });
  });

  it('⭐ never fetches member documents — aggregate only, find/countDocuments untouched', async () => {
    const member = makeMemberModel([]);
    await svc(member).getRegistrationCounts({}, superUser());
    expect(member.aggregate).toHaveBeenCalledTimes(1);
    expect(member.find).not.toHaveBeenCalled();
    expect(member.countDocuments).not.toHaveBeenCalled();
  });

  it('⭐ OA scope joins chat_rooms with ObjectId hook ids and a direct _id ↔ user_id $eq (live-DB shape)', async () => {
    const member = makeMemberModel([]);
    await svc(member).getRegistrationCounts(
      { line_oa_hook_id: HOOK_A },
      superUser(),
    );

    const pipeline = (member.aggregate.mock.calls[0] as unknown[])[0] as Array<
      Record<string, never>
    >;
    const lookup = pipeline.find((s) => '$lookup' in s)?.[
      '$lookup'
    ] as unknown as {
      from: string;
      let: Record<string, unknown>;
      pipeline: Array<Record<string, never>>;
      as: string;
    };
    expect(lookup.from).toBe('chat_rooms');
    // the member _id rides as-is — NO $toString; the live user_id is ObjectId
    expect(lookup.let).toEqual({ memberId: '$_id' });
    const roomMatch = lookup.pipeline[0]?.['$match'] as unknown as {
      $expr: unknown;
      hook_id: { $in: unknown[] };
    };
    expect(roomMatch.$expr).toEqual({ $eq: ['$user_id', '$$memberId'] });
    expect(roomMatch.hook_id.$in).toHaveLength(1);
    expect(roomMatch.hook_id.$in[0]).toBeInstanceOf(Types.ObjectId);
    expect(String(roomMatch.hook_id.$in[0])).toBe(HOOK_A);
    // and rows without a matching room are dropped before grouping
    expect(
      pipeline.some(
        (s) =>
          JSON.stringify(s) ===
          JSON.stringify({ $match: { 'oa_rooms.0': { $exists: true } } }),
      ),
    ).toBe(true);
  });

  it('superuser with NO hook filter counts globally — no $lookup stage at all', async () => {
    const member = makeMemberModel([]);
    await svc(member).getRegistrationCounts({}, superUser());
    const pipeline = (member.aggregate.mock.calls[0] as unknown[])[0] as Array<
      Record<string, unknown>
    >;
    expect(pipeline.some((s) => '$lookup' in s)).toBe(false);
  });

  it('scoped operator without an explicit hook is limited to their allowed OAs', async () => {
    const member = makeMemberModel([]);
    await svc(member).getRegistrationCounts({}, scopedUser([HOOK_A, HOOK_B]));
    const pipeline = (member.aggregate.mock.calls[0] as unknown[])[0] as Array<
      Record<string, never>
    >;
    const lookup = pipeline.find((s) => '$lookup' in s)?.[
      '$lookup'
    ] as unknown as {
      pipeline: Array<Record<string, never>>;
    };
    const roomMatch = lookup.pipeline[0]?.['$match'] as unknown as {
      hook_id: { $in: unknown[] };
    };
    expect(roomMatch.hook_id.$in.map(String).sort()).toEqual(
      [HOOK_A, HOOK_B].sort(),
    );
  });

  it('a hook outside the caller scope is Forbidden — same rule as getTicketInsights', async () => {
    const member = makeMemberModel([]);
    await expect(
      svc(member).getRegistrationCounts(
        { line_oa_hook_id: HOOK_B },
        scopedUser([HOOK_A]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(member.aggregate).not.toHaveBeenCalled();
  });

  it('no OA access at all short-circuits like the tickets endpoint — no query fired', async () => {
    const member = makeMemberModel([]);
    // no user ⇒ fail closed ⇒ [] (allowed-hook-ids.ts:106)
    const res = await svc(member).getRegistrationCounts({}, undefined);
    expect(res).toEqual({ success: true, data: null, scope: 'no_oa_access' });
    expect(member.aggregate).not.toHaveBeenCalled();
  });

  it('date range rides Bangkok wall-clock semantics: -7h UTC, end-of-day 23:59:59', async () => {
    const member = makeMemberModel([]);
    await svc(member).getRegistrationCounts(
      { from: '2026-08-01', to: '2026-08-20' },
      superUser(),
    );
    const match = (
      (member.aggregate.mock.calls[0] as unknown[])[0] as Array<
        Record<string, Record<string, { $gte: Date; $lte: Date }>>
      >
    )[0]?.['$match'];
    expect(match?.['link_registered_at']?.$gte).toEqual(
      new Date(Date.UTC(2026, 7, 1, -7, 0, 0)),
    );
    expect(match?.['link_registered_at']?.$lte).toEqual(
      new Date(Date.UTC(2026, 7, 20, 23 - 7, 59, 59)),
    );
  });

  it('no dates ⇒ no link_registered_at constraint (all-time count)', async () => {
    const member = makeMemberModel([]);
    await svc(member).getRegistrationCounts({}, superUser());
    const match = (
      (member.aggregate.mock.calls[0] as unknown[])[0] as Array<
        Record<string, Record<string, unknown>>
      >
    )[0]?.['$match'];
    expect(match && 'link_registered_at' in match).toBe(false);
  });

  it('an invalid hook id never throws and never queries — zeros, quietly', async () => {
    const member = makeMemberModel([]);
    const res = await svc(member).getRegistrationCounts(
      { line_oa_hook_id: 'not-an-object-id' },
      superUser(),
    );
    expect(member.aggregate).not.toHaveBeenCalled();
    expect(res).toEqual({
      success: true,
      data: { admin: 0, member: 0, admin_bot_assisted: 0, total: 0 },
    });
  });

  it('empty result set answers zeros, not nulls — the FE draws two bars either way', async () => {
    const res = await svc(makeMemberModel([])).getRegistrationCounts(
      {},
      superUser(),
    );
    expect(res).toEqual({
      success: true,
      data: { admin: 0, member: 0, admin_bot_assisted: 0, total: 0 },
    });
  });
});

describe('⭐ semi_admin — รู้จัก แต่ยังไม่นับ (ตั้งใจ ไม่ใช่ตกหล่น)', () => {
  /* Owner 2026-08-21: *"insight report ต้องรู้จัก เผื่อคิวรี่อนาคต"*.
     `semi_admin` is reserved in REGISTERED_BY and NOTHING WRITES IT YET, so
     leaving it uncounted changes no number today. These two cases exist so that
     cannot stop being true quietly: the day the list or the mapping moves, one
     of them fails and somebody has to mean it. */

  it('⭐ ยังไม่อยู่ใน $in ที่ใช้นับ — จะนับต้องตั้งใจ ไม่ใช่หลุดเข้ามา', async () => {
    const member = makeMemberModel([]);
    await svc(member).getRegistrationCounts({}, superUser());

    const pipeline = (member.aggregate.mock.calls[0] as unknown[])[0] as Array<
      Record<string, Record<string, unknown>>
    >;
    const inList = (
      pipeline[0]?.['$match']?.['link_registered_by'] as { $in: string[] }
    )?.$in;
    expect(inList).not.toContain('semi_admin');
    expect(inList).toEqual(['admin', 'member']);
  });

  it('⭐ ต่อให้ group หลุดเข้ามา ก็ถูกทิ้ง และ total ไม่บวมตาม', async () => {
    /* This is edit 2 of the three named in the service comment: widening `$in`
       ALONE fetches the group and throws it away. The row would then be counted
       nowhere while looking like it had been handled. */
    const member = makeMemberModel([
      { _id: 'admin', count: 3 },
      { _id: 'member', count: 5 },
      { _id: 'semi_admin', count: 7 },
    ]);
    const res = await svc(member).getRegistrationCounts({}, superUser());
    expect(res).toEqual({
      success: true,
      data: { admin: 3, member: 5, admin_bot_assisted: 0, total: 8 },
    });
  });
});

/* ==== [FEAT-20260821-REGBOTASSIST] แท่งที่สาม: บอทช่วยแอดมิน =====================
 * เจ้าของสั่ง 21/08:
 *   *"สมัครโดยแอดมิน เปลี่ยนเงื่อนไข 'admin' และ config.follow_up.line.request_reg_at
 *     ต้องไม่มีค่า /// label ใหม่ สมัครโดย Bot ช่วย Admin = 'admin' + request_reg_at มีค่า"*
 *   *"ไม่รวมแท่ง มันจะเป็นสามแท่งตอนจบ"*
 *
 * แท่ง `admin` เดิมถูก **ผ่าครึ่ง** ตามว่าบอทเคยไล่ตามคนนี้มาก่อนไหม:
 *   · บอทเปิดเคสไล่ตาม (scenario A) → ประทับ `request_reg_at`
 *   · แอดมินมาปิดจ๊อบทีหลัง        → `link_registered_by = 'admin'`
 *   ⇒ มีทั้งสองอย่าง = **บอทช่วยแอดมิน** ไม่ใช่แอดมินทำเองล้วน
 *
 * ⚠️ ตรงกับที่ `follow-up.keys.ts:40-43` เขียนกำกับไว้ว่า `request_reg_at`
 * **"อ่านเพื่อนับ ไม่ใช่เพื่อตัดสิน"** — งานนี้คือการนับพอดี ไม่ใช่การฝืนกฎ
 *
 * ⚠️ ค่าจริงใน DB (วัด 21/08): field นี้เป็น `date` เมื่อมี และ `missing` เมื่อไม่มี
 * **ไม่มี `null` เลย** — แต่กติกาที่เขียนต้องรับทั้งสองแบบ เพราะ `member.schema.ts`
 * ห้ามใส่ `default` ในถุง `config` และไม่มีอะไรกันไม่ให้มีคนเขียน null ในอนาคต
 */
describe('⭐ [FEAT-20260821-REGBOTASSIST] แท่ง admin ถูกผ่าเป็นสองแท่ง', () => {
  const pipelineOf = (member: ReturnType<typeof makeMemberModel>) =>
    (member.aggregate.mock.calls[0] as unknown[])[0] as Array<
      Record<string, unknown>
    >;

  it('⭐⭐ นับ admin ที่ไม่เคยถูกบอทไล่ตาม แยกจาก admin ที่เคย', async () => {
    const member = makeMemberModel([
      { _id: 'member', count: 3 },
      { _id: 'admin', count: 5 },
      { _id: 'admin_bot_assisted', count: 2 },
    ]);
    const res = await svc(member).getRegistrationCounts({}, superUser());
    expect(res).toEqual({
      success: true,
      data: { member: 3, admin: 5, admin_bot_assisted: 2, total: 10 },
    });
  });

  it('⭐⭐ total รวมทั้งสามแท่ง — ไม่งั้นตัวเลขบนจอบวกไม่ลง', async () => {
    /* การ์ดโชว์ "รวมทั้งหมด" ใต้สามแถว · ถ้า total ไม่รวมแท่งใหม่ แอดมินจะเห็น
       3 + 5 + 2 แล้วรวมได้ 8 ซึ่งอ่านแล้วเหมือนระบบนับผิด */
    const member = makeMemberModel([{ _id: 'admin_bot_assisted', count: 7 }]);
    const res = await svc(member).getRegistrationCounts({}, superUser());
    expect((res['data'] as Record<string, number>)['total']).toBe(7);
  });

  it('⭐⭐ การแยกเกิดที่ $group ไม่ใช่ที่ $match — แถว admin ต้องถูกดึงมาครบก่อน', async () => {
    /* ถ้าไปแยกที่ $match จะต้องยิงสองรอบ และ `total` จะนับซ้ำหรือขาดได้ง่าย
       $in ยังเป็น ['admin','member'] เท่าเดิม ⇒ ไม่มีแถวไหนหลุดจากการนับ */
    const member = makeMemberModel([]);
    await svc(member).getRegistrationCounts({}, superUser());
    const p = pipelineOf(member);
    expect(
      (p[0]?.['$match'] as Record<string, unknown>)?.['link_registered_by'],
    ).toEqual({ $in: ['admin', 'member'] });

    const group = p.find((s) => '$group' in s)?.['$group'] as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(group['_id'])).toContain('request_reg_at');
    expect(JSON.stringify(group['_id'])).toContain('admin_bot_assisted');
  });

  it('⭐⭐ กิ่งไหนแมปเป็นอะไร — ปักให้แน่น ไม่ใช่แค่ "มีคำนี้อยู่ในไปป์ไลน์"', async () => {
    /* ⚠️ เคสนี้เกิดจาก mutation ที่ **หลุด**: สลับ `'admin'` กับ
       `'admin_bot_assisted'` ในสอง branch ของ `$cond` แล้วเทสทั้งชุดยังเขียว
       เพราะทุกเคสป้อนผลลัพธ์ที่ group เสร็จแล้วมาจาก mock — ไม่มีใครเดินตรรกะจริง
       และเคส "การแยกเกิดที่ $group" ก็แค่เช็คว่า **มีคำนี้อยู่** ไม่ได้เช็คว่าอยู่ฝั่งไหน
       ⇒ ต้องอ่านโครง `$cond` จริงว่า **เงื่อนไข "ไม่มีค่า" ให้ผลเป็น `admin`**
       สลับเมื่อไหร่ = คนที่บอทไล่ตามถูกนับเป็นแอดมินทำเอง และกลับกัน
       เช็คว่ามีคำ ≠ เช็คว่าอยู่ถูกที่. */
    const member = makeMemberModel([]);
    await svc(member).getRegistrationCounts({}, superUser());
    const group = pipelineOf(member).find((s) => '$group' in s)?.['$group'] as
      Record<string, unknown> | undefined;
    const outer = (group?.['_id'] as { $cond?: unknown[] })?.$cond;
    expect(Array.isArray(outer)).toBe(true);
    // outer: [ ไม่ใช่ admin ?, ใช้ค่าเดิม, <cond ชั้นใน> ]
    const inner = (outer as unknown[])[2] as { $cond?: unknown[] };
    const [cond, whenNoValue, whenHasValue] = inner.$cond as unknown[];
    expect(JSON.stringify(cond)).toContain('request_reg_at');
    expect(whenNoValue).toBe('admin');
    expect(whenHasValue).toBe('admin_bot_assisted');
  });

  it('⭐⭐ "ไม่มีค่า" หมายถึงทั้งไม่มีคีย์และเป็น null', async () => {
    /* ของจริงวันนี้มีแต่ `date` กับ `missing` แต่ถุง `config` ไม่มี default และ
       ไม่มีอะไรกันคนเขียน null ในอนาคต · ถ้ากติกาจับแค่ `missing` วันนั้นแถว null
       จะถูกนับเป็น "บอทช่วย" ทั้งที่บอทไม่เคยแตะเลย */
    const member = makeMemberModel([]);
    await svc(member).getRegistrationCounts({}, superUser());
    const group = pipelineOf(member).find((s) => '$group' in s)?.['$group'] as
      Record<string, unknown> | undefined;
    const asText = JSON.stringify(group?.['_id']);
    expect(asText).toMatch(/missing/);
    expect(asText).toMatch(/null/);
  });

  it('⭐ ค่าที่ไม่รู้จักยังถูกทิ้งเหมือนเดิม — system ไม่โผล่กลับมา', async () => {
    const member = makeMemberModel([
      { _id: 'member', count: 1 },
      { _id: 'system', count: 9 },
      { _id: 'semi_admin', count: 4 },
    ]);
    const res = await svc(member).getRegistrationCounts({}, superUser());
    expect(res).toEqual({
      success: true,
      data: { member: 1, admin: 0, admin_bot_assisted: 0, total: 1 },
    });
  });

  it('⭐ no_oa_access ยังคืน data: null ไม่ใช่ศูนย์ — แท่งที่สามไม่เปลี่ยนเรื่องนี้', async () => {
    /* ⚠️ ผมเขียนเคสนี้ผิดรอบแรกว่าให้คืนศูนย์ครบทุกแท่ง — ของจริงคือ `data: null`
       และมันถูกแล้ว: `:113-116` เป็น fail-closed โดยตั้งใจ "answer no access,
       never a global number a scoped operator shouldn't see" · ศูนย์แปลว่า
       "ไม่มีใครสมัคร" ซึ่งเป็นคำตอบคนละอันกับ "คุณไม่มีสิทธิ์เห็น"
       เก็บเคสนี้ไว้เพราะการเพิ่มแท่งไม่ควรเผลอเปลี่ยนพฤติกรรมนี้ */
    const res = await svc(makeMemberModel()).getRegistrationCounts(
      {},
      scopedUser([]),
    );
    expect(res).toEqual({ success: true, data: null, scope: 'no_oa_access' });
  });
});
