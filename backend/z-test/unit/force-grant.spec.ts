/**
 * [FEAT-20260828-FORCEGRANTCOUNT] "ให้สิทธิ์ OA นี้กับผู้ใช้ในกลุ่ม" — ทำอะไรจริง
 * ===========================================================================
 * เจ้าของ 28/08: *"ติ๊กแล้วได้จริงไหม"*
 *
 * 🔴 เคส negative คือเคสที่สำคัญที่สุดในไฟล์นี้ และเป็นเรื่องความปลอดภัย ไม่ใช่การแสดงผล
 *    ผู้ใช้ที่ **ไม่มี** `allowed_hooks` แปลว่า "ไม่มี allowlist" = เห็น OA ทุกตัว
 *    ในกลุ่มอยู่แล้ว (`auth.service.ts:255`) ⇒ ถ้า `$addToSet` ให้เขา จะกลายเป็น
 *    การสร้าง allowlist ที่มี OA ตัวเดียว **ตัดสิทธิ์ที่เขาเคยมีทั้งหมดทิ้ง**
 *    จากเห็นทุก OA เหลือเห็นตัวเดียว — และไม่มี error ให้เห็นเลย
 *    ⇒ `allowed_hooks: { $exists: true }` ในตัวกรองคือบรรทัดที่กันเรื่องนี้
 *
 * ⚠️ ทุกเคสยิงผ่านเมธอดจริง ไม่ได้ก๊อปเงื่อนไขมาเขียนซ้ำในเทส — ถ้าวันหนึ่งมีคน
 *    ถอด `$exists` ออก เคสข้างล่างจะแดงทันที
 */
import { HooksService } from '@/modules/hooks/hooks.service';

/** จับ filter + update ที่ถูกส่งเข้า `updateMany` และคำถามของ `countDocuments` */
function makeService(
  opts: { modified?: number; matched?: number; unrestricted?: number } = {},
) {
  const seen: {
    updateFilters: Record<string, unknown>[];
    updates: Record<string, unknown>[];
    countFilters: Record<string, unknown>[];
  } = { updateFilters: [], updates: [], countFilters: [] };

  const userModel = {
    updateMany: (f: Record<string, unknown>, u: Record<string, unknown>) => {
      seen.updateFilters.push(f);
      seen.updates.push(u);
      return {
        exec: () =>
          Promise.resolve({
            modifiedCount: opts.modified ?? 3,
            matchedCount: opts.matched ?? 3,
          }),
      };
    },
    countDocuments: (f: Record<string, unknown>) => {
      seen.countFilters.push(f);
      return { exec: () => Promise.resolve(opts.unrestricted ?? 4) };
    },
  };

  /* เมธอดที่ทดสอบเป็น private และไม่แตะ dependency ตัวอื่นเลย ⇒ ประกอบ instance
     แบบว่าง ๆ แล้วเสียบเฉพาะ `userModel` · ไม่ต้องยก DI ทั้งโมดูลมาเพื่อสองคิวรี่ */
  const service = Object.create(HooksService.prototype) as HooksService;
  (service as unknown as Record<string, unknown>)['userModel'] = userModel;
  /* เมธอดเป็น private ⇒ เข้าถึงผ่าน handle ที่ประกาศชนิดไว้ชัด แทนการยิง
     `service['...']` ซึ่ง TypeScript อ่านเป็น `never` แล้วเรียกไม่ได้ */
  const grant = (
    service as unknown as {
      grantHookToGroupUsers: (
        h: unknown,
        g: unknown,
      ) => Promise<{
        granted: number;
        matched: number;
        already_unrestricted: number;
      }>;
    }
  ).grantHookToGroupUsers.bind(service);
  return { service, grant, seen };
}

const HOOK = 'hook-1';
const GROUP = 'group-1';

describe('[FORCEGRANT] ใครถูกแตะ และใครต้องไม่ถูกแตะ', () => {
  it('⭐⭐ 🔴 NEGATIVE — ผู้ใช้ที่ไม่มี allowlist ต้องไม่ถูกแตะ', async () => {
    /* 🔴 ถ้าตัวกรองนี้หลุด คนที่เคยเห็น OA ทุกตัวจะเหลือเห็นตัวเดียว
       นี่คือการตัดสิทธิ์คนจริง ไม่ใช่บั๊กการแสดงผล */
    const { grant, seen } = makeService();
    await grant(HOOK, GROUP);

    expect(seen.updateFilters[0]).toEqual({
      groups: GROUP,
      allowed_hooks: { $exists: true },
      deleted_at: { $exists: false },
    });
  });

  it('⭐⭐ 🔴 POSITIVE — เพิ่มเข้า allowlist ของคนที่มีอยู่แล้ว', async () => {
    const { grant, seen } = makeService();
    await grant(HOOK, GROUP);

    expect(seen.updates[0]).toEqual({ $addToSet: { allowed_hooks: HOOK } });
  });

  it('⭐⭐ 🔴 เพิ่มอย่างเดียว ห้ามลบ — `$addToSet` ไม่ใช่ `$set`', async () => {
    /* `$set` จะเขียนทับ allowlist ทั้งชุด = ถอนสิทธิ์ OA อื่นของเขาทิ้งหมด
       และติ๊กซ้ำจะไม่เพิ่มซ้ำเพราะ `$addToSet` เป็น idempotent โดยธรรมชาติ */
    const { grant, seen } = makeService();
    await grant(HOOK, GROUP);

    const update = seen.updates[0] as Record<string, unknown>;
    expect(Object.keys(update)).toEqual(['$addToSet']);
    expect(update['$set']).toBeUndefined();
    expect(update['$pull']).toBeUndefined();
  });

  it('⭐ ผู้ใช้ที่ถูกลบไปแล้วต้องไม่ได้สิทธิ์', async () => {
    const { grant, seen } = makeService();
    await grant(HOOK, GROUP);
    expect(seen.updateFilters[0]?.['deleted_at']).toEqual({ $exists: false });
  });

  it('⭐ ไม่แตะ `updated_at` ของผู้ใช้ — การให้สิทธิ์ไม่ใช่การแก้โปรไฟล์', async () => {
    /* `timestamps: false` มีอยู่เดิม · หลุดเมื่อไหร่ ประวัติการแก้ไขของผู้ใช้
       ทุกคนในกลุ่มจะขยับพร้อมกันโดยไม่มีใครแก้อะไรจริง */
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'src/modules/hooks/hooks.service.ts'),
      'utf8',
    ) as string;
    const body = src.slice(src.indexOf('private async grantHookToGroupUsers'));
    expect(body.slice(0, body.indexOf('return {'))).toContain(
      'timestamps: false',
    );
  });
});

describe('[FORCEGRANTCOUNT] ตัวเลขที่คืนต้องตรงกับสิ่งที่เกิดจริง', () => {
  it('⭐⭐ 🔴 นับคนที่ไม่มี allowlist ด้วยคิวรี่ของตัวเอง ไม่ใช่ลบกันเอา', async () => {
    /* ลบ `matched` ออกจากจำนวนคนในกลุ่มจะผิดทันทีที่มีคนถูกลบระหว่างสองคำสั่ง
       ⇒ ต้องถามฐานตรง ๆ ด้วยเงื่อนไขที่เป็นภาพสะท้อนของตัวกรองด้านบน */
    const { grant, seen } = makeService();
    await grant(HOOK, GROUP);

    expect(seen.countFilters[0]).toEqual({
      groups: GROUP,
      allowed_hooks: { $exists: false },
      deleted_at: { $exists: false },
    });
  });

  it('⭐⭐ คืนตัวเลขครบสามตัวตามที่ฐานตอบ', async () => {
    const { grant } = makeService({ modified: 3, matched: 5, unrestricted: 4 });
    const out = await grant(HOOK, GROUP);

    expect(out).toEqual({ granted: 3, matched: 5, already_unrestricted: 4 });
  });

  it('⭐ ติ๊กซ้ำ ⇒ `granted` เป็น 0 แต่ยัง matched — ไม่ใช่ความล้มเหลว', async () => {
    /* คนมีสิทธิ์อยู่แล้วทั้งหมด ⇒ `$addToSet` ไม่เปลี่ยนอะไร · หน้าจอต้องแยก
       "ไม่มีอะไรต้องเพิ่ม" ออกจาก "ทำไม่สำเร็จ" ได้ */
    const { grant } = makeService({ modified: 0, matched: 3, unrestricted: 4 });
    const out = await grant(HOOK, GROUP);

    expect(out.granted).toBe(0);
    expect(out.matched).toBe(3);
  });
});
