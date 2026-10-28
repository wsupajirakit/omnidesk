/**
 * [FEAT-20260825-CLEAREDAT] `raw_profile_cleared_at` — the stamp the dev-only
 * "remove profile" button leaves behind.
 * ===========================================================================
 * Owner, 25/08/2026: *"เพิ่ม column ใหม่ ... action นี้จะเกิดขึ้นตอนกด remove
 * profile (ตอนนี้มีแค่ dev ที่เห็นปุ่ม) ... เอาให้จบจนกด remove แล้ว stamp
 * เวลาได้จริง"*
 *
 * ⭐ THIS SPEC DRIVES THE REAL METHOD, it does not read the source. The thing
 * that actually matters here is the SHAPE OF THE UPDATE DOCUMENT that reaches
 * Mongo, and only calling the method can show that. A source-text pin would
 * pass just as happily if the `$set` ended up in a second, separate write.
 *
 * ⚠️ Same service-stub idiom as `member-scope.spec.ts` — `Object.create` on the
 * prototype so no Nest container is needed.
 */
import { MembersService } from '@/modules/chat';

const MEMBER = 'a0d00000000000000000007a';

/** The dev-remove guard reads this; without it every call is refused. */
const DEV_AUTH = { username: 'devtester', roleName: 'superadmin' } as never;

const buildService = () => {
  const seen: {
    calls: Array<{ filter: unknown; update: Record<string, unknown> }>;
  } = { calls: [] };
  const svc = Object.create(MembersService.prototype) as Record<
    string,
    unknown
  >;
  svc.memberModel = {
    updateOne: (filter: unknown, update: Record<string, unknown>) => {
      seen.calls.push({ filter, update });
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
    },
  };
  // the scope check is not what this spec is about — let it pass
  svc.ensureMemberInScope = () => Promise.resolve();
  return { svc: svc as unknown as MembersService, seen };
};

describe('[CLEAREDAT] กดปุ่ม remove profile แล้วต้องได้ stamp เวลาจริง', () => {
  const origEnv = process.env.DEV_REMOVE_USERNAMES;
  beforeAll(() => {
    process.env.DEV_REMOVE_USERNAMES = 'devtester';
  });
  afterAll(() => {
    if (origEnv === undefined) delete process.env.DEV_REMOVE_USERNAMES;
    else process.env.DEV_REMOVE_USERNAMES = origEnv;
  });

  it('⭐⭐ (T1) เขียน raw_profile_cleared_at เป็นวันที่จริง', async () => {
    const { svc, seen } = buildService();
    const before = Date.now();
    await svc.clearRawProfile(MEMBER, DEV_AUTH);
    const after = Date.now();

    const set = seen.calls[0]?.update?.['$set'] as
      Record<string, unknown> | undefined;
    expect(set).toBeDefined();
    const stamp = set?.['raw_profile_cleared_at'];
    expect(stamp).toBeInstanceOf(Date);
    /* เวลาต้องเป็น "ตอนนี้" ไม่ใช่ค่าคงที่ที่ใครเผลอ hardcode ไว้ */
    const ms = (stamp as Date).getTime();
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it('⭐⭐ (T2) ลบข้อมูลกับประทับเวลาอยู่ใน write เดียวกัน — atomic', async () => {
    /* สองคำสั่งแยกกัน = มีเสี้ยววินาทีที่โปรไฟล์หายแล้วแต่เวลายังไม่ถูกเขียน
       ถ้าเครื่องดับตรงนั้น จะเหลือแถวที่ "ถูกล้างแต่ไม่รู้ว่าเมื่อไหร่" ตลอดไป */
    const { svc, seen } = buildService();
    await svc.clearRawProfile(MEMBER, DEV_AUTH);

    expect(seen.calls).toHaveLength(1);
    const update = seen.calls[0]!.update;
    expect(update['$unset']).toEqual({ raw_profile_data: '' });
    expect(Object.keys(update).sort()).toEqual(['$set', '$unset']);
  });

  it('⭐ (T3) ยังยิงที่ member คนที่ถูกระบุเท่านั้น', async () => {
    const { svc, seen } = buildService();
    await svc.clearRawProfile(MEMBER, DEV_AUTH);
    expect(seen.calls[0]?.filter).toEqual({ _id: MEMBER });
  });

  it('⭐⭐ (P1 PIN) ถูกปฏิเสธ = ห้ามเขียนอะไรเลยแม้แต่ stamp', async () => {
    /* ถ้า stamp ถูกเขียนทั้งที่ guard ปฏิเสธ จะกลายเป็นร่องรอยว่า "เคยถูกล้าง"
       ทั้งที่ข้อมูลยังอยู่ครบ — อ่านย้อนหลังแล้วเข้าใจผิดสนิท */
    const { svc, seen } = buildService();
    await expect(
      svc.clearRawProfile(MEMBER, {
        username: 'someone-else',
        roleName: 'superadmin',
      } as never),
    ).rejects.toBeDefined();
    expect(seen.calls).toHaveLength(0);
  });

  it('⭐ (P2 PIN) id ไม่ถูกต้อง = ปฏิเสธก่อน ไม่แตะฐานข้อมูล', async () => {
    const { svc, seen } = buildService();
    await expect(
      svc.clearRawProfile('not-an-id', DEV_AUTH),
    ).rejects.toBeDefined();
    expect(seen.calls).toHaveLength(0);
  });
});

describe('[CLEAREDAT] สคีมาและ index ประกาศไว้ถูกแบบ', () => {
  const schema = require('fs').readFileSync(
    require('path').join(
      process.cwd(),
      'src/modules/chat/schemas/member.schema.ts',
    ),
    'utf8',
  ) as string;

  it('⭐⭐ (T4) ไม่มี default — field ต้อง "ไม่มีอยู่" จนกว่าจะถูกล้างครั้งแรก', () => {
    const i = schema.indexOf('raw_profile_cleared_at?: Date');
    expect(i).toBeGreaterThan(-1);
    // ย่านของ @Prop ที่ประกาศ field นี้ (ก่อนหน้าบรรทัดชื่อ field)
    const propAt = schema.lastIndexOf('@Prop(', i);
    const prop = schema.slice(propAt, i);
    expect(prop).toContain('type: Date');
    /* default ตัวไหนก็ตามจะทำให้ partial index ด้านล่างครอบทั้งคอลเลกชัน
       และ '' จะเป็นสตริงในคอลัมน์วันที่ ซึ่งทำให้คิวรี่ผิดแบบเงียบ ๆ */
    expect(prop).not.toContain('default');
  });

  it('⭐⭐ (T5) index เป็น partial บน $exists ไม่ใช่ index เต็ม', () => {
    const i = schema.indexOf('{ raw_profile_cleared_at: 1 }');
    expect(i).toBeGreaterThan(-1);
    const region = schema.slice(i, i + 260);
    expect(region).toContain('partialFilterExpression');
    expect(region).toContain('$exists: true');
    expect(region).toContain('background: true');
  });
});
