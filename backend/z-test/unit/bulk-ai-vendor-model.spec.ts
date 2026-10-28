/**
 * [FEAT-20260828-BULKAI] ตั้ง AI vendor / model ให้หลาย OA พร้อมกัน
 * ===========================================================================
 * เจ้าของ 28/08: *"หัวข้อ ai แยกเลย / กำหนด ai model / vendor ได้ ติ๊กแยกสองอย่าง
 * นี้ได้ ... ไม่ต้องพ่วงกัน"* และสั่งกำกับว่า *"proof ไม่กระทบ method อื่น
 * backtest ทุกตัวใน method"*
 *
 * ไฟล์นี้จึงมีสองครึ่ง:
 *   §1 ฟีเจอร์ใหม่ — กติกาการตรวจค่าและสัญญาของเส้นใหม่
 *   §2 **backtest** — พิสูจน์ว่า 6 method เดิมไม่ถูกแตะแม้แต่นิดเดียว
 *
 * 🔴 ครึ่งหลังสำคัญกว่าครึ่งแรก. วิธี "ง่าย" ที่จะทำฟีเจอร์นี้คือไปคลาย
 *    `typeof value !== 'boolean'` ใน `bulkUpdateHookSetting` ให้รับสตริงได้
 *    — ซึ่งจะคลายการตรวจให้ **ทั้ง 6 method พร้อมกัน** โดยไม่มีอะไรฟ้อง
 *    เคสใน §2 คือสิ่งเดียวที่จับทางลัดนั้นได้
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { Types } from 'mongoose';

import { HooksService } from '@/modules/hooks/hooks.service';
import {
  parseAiModel,
  parseAiVendor,
  AI_VENDORS,
} from '@/modules/hooks/ai-vendor/parse-ai-vendor';
import { BULK_SETTING_FIELDS } from '@/modules/hooks/hook-write.helpers';

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const SERVICE = src('src/modules/hooks/hooks.service.ts');
const CONTROLLER = src('src/modules/hooks/hooks.controller.ts');

/** เนื้อของเมธอดหนึ่งตัว ตั้งแต่ชื่อจนถึงเมธอดถัดไป */
const methodBody = (name: string): string => {
  const start = SERVICE.indexOf(`async ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const rest = SERVICE.slice(start + 1);
  const next = rest.indexOf('\n  async ');
  return next === -1 ? rest : rest.slice(0, next);
};

describe('[BULKAI] §1 การตรวจค่า — ใช้ตัวตรวจเดียวกับการเขียนทีละตัว', () => {
  it('⭐⭐ 🔴 ไม่ส่งมา (undefined) ต่างจากส่งค่าว่าง (null) — นี่คือกลไก "ติ๊กแยก"', () => {
    /* undefined = "ไม่ได้ติ๊กช่องนี้ อย่าไปยุ่ง" · null = "ติ๊กแล้วเลือกค่าเริ่มต้น"
       ถ้าสองอย่างนี้ยุบเป็นค่าเดียวกันเมื่อไหร่ การตั้ง vendor อย่างเดียวจะไป
       ล้าง model ของ OA ทิ้งด้วยโดยไม่มีใครสั่ง */
    expect(parseAiVendor(undefined)).toBeUndefined();
    expect(parseAiModel(undefined)).toBeUndefined();
    expect(parseAiVendor(null)).toBeNull();
    expect(parseAiVendor('')).toBeNull();
    expect(parseAiModel(null)).toBeNull();
    expect(parseAiModel('   ')).toBeNull();
  });

  it('⭐⭐ 🔴 vendor ที่ไม่รู้จักถูกปฏิเสธตอนเขียน ไม่ปล่อยให้เงียบ', () => {
    expect(() => parseAiVendor('openai')).toThrow(/ai_vendor must be one of/);
    for (const v of AI_VENDORS) expect(parseAiVendor(v)).toBe(v);
  });

  it('⭐ model เป็น free text แต่ยังคุมรูป — ตัดช่องว่าง จำกัดความยาว', () => {
    expect(parseAiModel('  gemini-3.5-flash ')).toBe('gemini-3.5-flash');
    expect(() => parseAiModel('x'.repeat(101))).toThrow(/100 characters/);
    expect(() => parseAiModel(42)).toThrow(/must be a string/);
  });
});

describe('[BULKAI] §1 สัญญาของเส้นใหม่', () => {
  const body = methodBody('bulkUpdateHookAi');

  it('⭐⭐ 🔴 ไม่ติ๊กอะไรเลย = 400 ไม่ใช่ "สำเร็จ 0 รายการ"', () => {
    /* ตอบว่าสำเร็จทั้งที่ไม่ได้เขียนอะไร = หน้าจอที่ลืมส่งค่าจะ ship ไปโดยไม่มีใครรู้ */
    expect(body).toContain(
      "'at least one of ai_vendor or ai_model is required'",
    );
  });

  it('⭐⭐ 🔴 เขียนเฉพาะช่องที่ติ๊ก — ช่องที่ไม่ได้ติ๊กต้องไม่ถูกแตะ', async () => {
    /* ⚠️ [FEAT-20260904-VENDORSECCOL] เคสนี้เคยปัก **รูปร่างของโค้ด** ไว้ตรง ๆ
       (`patch['ai_model'] = model` + `$set: patch`) ซึ่งพังทันทีที่การเขียนถูกแยก
       เป็นราย column ตามค่าย — ทั้งที่กฎที่มันคุ้มครองไม่ได้เปลี่ยนเลย
       ตอนนี้ถามพฤติกรรมแทน: ติ๊กอะไรมาก็เขียนแค่นั้น · แข็งแรงกว่าเพราะรีแฟกเตอร์
       ครั้งหน้าจะไม่ทำให้แดงโดยไม่มีอะไรเสีย และการเขียนช่องที่ไม่ได้ติ๊กจะแดงจริง */
    const onlyVendor = buildBulkService([
      { _id: H1, alias: 'a1', group: BULK_GROUP, ai_model: 'keep-me' },
    ]);
    await onlyVendor.service.bulkUpdateHookAi(
      { ids: [H1], ai_vendor: 'gemini' },
      bulkCtx,
    );
    expect(written(onlyVendor.writes)).toEqual({ ai_vendor: 'gemini' });

    const onlyModel = buildBulkService([
      { _id: H1, alias: 'a1', group: BULK_GROUP, ai_vendor: 'gemini' },
    ]);
    await onlyModel.service.bulkUpdateHookAi(
      { ids: [H1], ai_model: 'm' },
      bulkCtx,
    );
    expect(written(onlyModel.writes)).toEqual({ ai_model: 'm' });
  });

  it('⭐⭐ 🔴 เช็คสิทธิ์ก่อนเขียนเสมอ (all-or-nothing)', () => {
    expect(body).toContain('loadBulkTargets');
    expect(body.indexOf('loadBulkTargets')).toBeLessThan(
      body.indexOf('updateMany'),
    );
  });

  it('⭐⭐ 🔴 ล้างแคชหลังเขียน — ไม่งั้น webhook ยังตอบด้วยค่าเก่า', () => {
    expect(body).toContain('this.hookCache.cacheHook(');
    expect(body.indexOf('updateMany')).toBeLessThan(body.indexOf('cacheHook'));
  });

  it('⭐ audit แยกรายช่อง — อ่านย้อนหลังต้องรู้ว่าอะไรเปลี่ยน', () => {
    expect(body).toContain('this.auditBulk(');
    expect(body).toContain(
      'for (const [field, next] of Object.entries(patch))',
    );
  });

  it('⭐ แถวที่ค่าเท่าเดิมไม่ถูกเขียนซ้ำ · แถวเก่าที่เป็น undefined นับเป็น null', () => {
    expect(body).toContain('(hook[field] ?? null) !== next');
  });

  it('⭐ route แยกของตัวเอง ไม่ไปอาศัย settings/bulk', () => {
    expect(CONTROLLER).toContain("@Patch('ai/bulk')");
  });
});

describe('[BULKAI] §2 backtest — 6 method เดิมต้องไม่ขยับ', () => {
  it('⭐⭐ 🔴 `settings/bulk` ยังรับเฉพาะ boolean แท้', () => {
    /* 🔴 ทางลัดที่ห้ามทำ: คลายด่านนี้ให้รับสตริงเพื่อยัด ai เข้าไป
       = คลายการตรวจให้ slip_check / customer_link_enabled / custom_tool_status
         พร้อมกันทั้งสามตัว โดยไม่มีเทสไหนฟ้อง */
    expect(methodBody('bulkUpdateHookSetting')).toContain(
      "if (typeof body['value'] !== 'boolean')",
    );
  });

  it('⭐⭐ 🔴 whitelist ของ settings/bulk ไม่โต — ai ไม่ได้แอบเข้าไป', () => {
    expect([...BULK_SETTING_FIELDS].sort()).toEqual([
      'custom_tool_status',
      'customer_link_enabled',
      'slip_check',
    ]);
    expect(BULK_SETTING_FIELDS).not.toContain('ai_vendor');
    expect(BULK_SETTING_FIELDS).not.toContain('ai_model');
  });

  it('⭐⭐ 🔴 ทุก method เดิมยังเช็คสิทธิ์ก่อนเขียน', () => {
    for (const name of [
      'bulkUpdateHookStatus',
      'bulkUpdateHookSetting',
      'bulkUpdateHookHandoff',
      'bulkUpdateHookAbandon',
      'bulkUpdateHookPayment',
    ]) {
      const body = methodBody(name);
      expect(body).toContain('loadBulkTargets');
      /* 🔴 ตัวเขียนไม่ใช่ `updateMany` ทุกตัว — `bulkUpdateHookHandoff` เขียนผ่าน
         `handoffBindings.setBindingEnabledForHooks` เพราะสิ่งที่มันสลับคือ
         binding ไม่ใช่คอลัมน์บน hook · เคยปักว่า "updateMany ทุกตัว" แล้วแดง
         ซึ่งถูกแล้ว ⇒ ปักสิ่งที่เป็นจริง: การเช็คสิทธิ์ต้องมาก่อน **การเขียนของมันเอง** */
      const writeAt = ['updateMany', 'setBindingEnabledForHooks']
        .map((w) => body.indexOf(w))
        .filter((i) => i > -1);
      expect(writeAt.length).toBeGreaterThan(0);
      expect(body.indexOf('loadBulkTargets')).toBeLessThan(
        Math.min(...writeAt),
      );
    }
  });

  it('⭐⭐ 🔴 ตัวตรวจค่าของแต่ละ method เดิมยังเป็นตัวเดิม', () => {
    /* 🔴 เขียนแยกจากเคสข้างบนเพราะ **ไม่ได้ตรวจเหมือนกันทุกตัว** — เคยสมมติว่า
       ทั้งหมดใช้ `typeof value !== 'boolean'` แล้วเทสแดง ซึ่งถูกแล้ว:
       `bulkUpdateHookStatus` ใช้ `parseStatusFlag` เพราะสถานะเก็บเป็น 0/1
       ไม่ใช่ boolean · ปักของจริงรายตัว ไม่ใช่ปักข้อสมมติที่สวยกว่า */
    expect(methodBody('bulkUpdateHookStatus')).toContain(
      "W.parseStatusFlag(body['status'])",
    );
    for (const name of [
      'bulkUpdateHookSetting',
      'bulkUpdateHookHandoff',
      'bulkUpdateHookAbandon',
      'bulkUpdateHookPayment',
    ]) {
      expect(methodBody(name)).toMatch(/typeof body\['value'\] !== 'boolean'/);
    }
  });

  it('⭐⭐ 🔴 เส้นใหม่ไม่ได้ไปแก้ route เดิมสักเส้น', () => {
    for (const route of [
      "@Patch('status/bulk')",
      "@Patch('settings/bulk')",
      "@Patch('handoff/bulk')",
      "@Patch('abandon/bulk')",
      "@Patch('notice/bulk')",
      "@Patch('payment/bulk')",
    ]) {
      expect(CONTROLLER).toContain(route);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   [FEAT-20260904-VENDORSECCOL] §3 — the model must land in the column of the
   vendor the row ENDS UP on.
   ═══════════════════════════════════════════════════════════════════════════
   Owner, 04/09: *"ถ้า bulk deepseek ก็ต้องได้ deepseek / gemini ก็ gemini
   ต้องไม่โกหก"*.

   🔴 WHAT WOULD HAPPEN WITHOUT THIS. The method wrote one shared `patch` with
   `ai_model` hard-coded, so an operator who bulk-switched twenty OAs to DeepSeek
   and typed `deepseek-reasoner` in the model box had that value written into
   GEMINI's column. Save succeeded, the audit row said the model changed, and
   DeepSeek went on answering with its family default. Nothing anywhere said the
   value had no effect — the same silent class as a field missing from
   ALLOWED_UPDATES. เซฟผ่าน แต่ไม่มีผล และไม่มีอะไรฟ้อง

   ⚠️ THE HARD CASE IS "MODEL ONLY". With no vendor in the request each target
   keeps its own, and the targets can be on different vendors — so there is no
   single column that is right for all of them. Writing one anyway is the lie.
   ══════════════════════════════════════════════════════════════════════════ */

const H1 = new Types.ObjectId().toString();
const H2 = new Types.ObjectId().toString();
const BULK_GROUP = new Types.ObjectId().toString();

/** Chainable query stub — mirrors the one in wrap-ai-p2a-clone-vendor.spec.ts. */
function bulkQuery(result: unknown): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const m of ['populate', 'lean', 'sort', 'limit', 'select', 'session']) {
    q[m] = () => q;
  }
  q['exec'] = () => Promise.resolve(result);
  q['then'] = (r: (v: unknown) => unknown) => Promise.resolve(result).then(r);
  return q;
}

/** Each `updateMany` recorded as { ids, set } so a per-column write is visible. */
function buildBulkService(rows: Array<Record<string, unknown>>) {
  const writes: Array<{ ids: string[]; set: Record<string, unknown> }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const hookModel = {
    find: () => bulkQuery(rows),
    updateMany: (f: Record<string, any>, u: Record<string, any>) => {
      writes.push({
        ids: (f['_id']?.['$in'] ?? []).map((x: unknown) => String(x)),
        set: u['$set'] as Record<string, unknown>,
      });
      return bulkQuery({ acknowledged: true, modifiedCount: 1 });
    },
  };
  const pass = {
    find: () => bulkQuery([]),
    findOne: () => bulkQuery(null),
    findById: () => bulkQuery(null),
    updateOne: () => bulkQuery({ acknowledged: true }),
  };
  const service = new HooksService(
    hookModel as never,
    pass as never,
    pass as never,
    pass as never,
    { safeDecrypt: (v: string) => v, encrypt: (v: string) => v } as never,
    {
      cacheHook: () => Promise.resolve(),
      invalidateHookCache: () => Promise.resolve(),
    } as never,
    {
      createAuditLog: (row: Record<string, unknown>) => {
        audits.push(row);
        return Promise.resolve();
      },
      // the bulk paths log through writeInBackground, not createAuditLog
      writeInBackground: (row: Record<string, unknown>) => {
        audits.push(row);
      },
    } as never,
    {
      verifyDocId: () => Promise.resolve(),
      verifyLineKey: () => Promise.resolve(),
      verifyCustomAiKey: () => Promise.resolve(),
    } as never,
    { getToolForHook: () => Promise.resolve(null) } as never,
    { setEnabled: () => Promise.resolve() } as never,
    {} as never,
  );
  return { service, writes, audits };
}

const bulkCtx = {
  user: { roleName: 'superadmin', id: 'u1', groups: [BULK_GROUP] },
} as never;

/** Every `$set` merged — "was this field written at all, and with what". */
const written = (w: Array<{ set: Record<string, unknown> }>) =>
  Object.assign({}, ...w.map((x) => x.set)) as Record<string, unknown>;

describe('[BULKAI] §3 the model lands in the column of the vendor that will use it', () => {
  it("⭐ vendor=deepseek + model ⇒ ai_model_sec, and GEMINI's column is untouched", async () => {
    const { service, writes } = buildBulkService([
      { _id: H1, alias: 'a1', group: BULK_GROUP },
    ]);
    await service.bulkUpdateHookAi(
      { ids: [H1], ai_vendor: 'deepseek', ai_model: 'deepseek-reasoner' },
      bulkCtx,
    );
    const w = written(writes);
    expect(w['ai_vendor']).toBe('deepseek');
    expect(w['ai_model_sec']).toBe('deepseek-reasoner');
    expect(w).not.toHaveProperty('ai_model');
  });

  it('⭐ vendor=gemini + model ⇒ ai_model, and the SEC column is untouched', async () => {
    const { service, writes } = buildBulkService([
      { _id: H1, alias: 'a1', group: BULK_GROUP },
    ]);
    await service.bulkUpdateHookAi(
      { ids: [H1], ai_vendor: 'gemini', ai_model: 'gemini-2.5-flash' },
      bulkCtx,
    );
    const w = written(writes);
    expect(w['ai_model']).toBe('gemini-2.5-flash');
    expect(w).not.toHaveProperty('ai_model_sec');
  });

  it('⭐⭐ 🔴 model ONLY, targets on DIFFERENT vendors ⇒ each row gets its own column', async () => {
    /* The case that cannot be satisfied by one shared `$set`. H1 stays on
       gemini, H2 stays on deepseek, and the same typed model must land in a
       different column for each. คละค่าย = คนละคอลัมน์ ห้ามเขียนก้อนเดียว */
    const { service, writes } = buildBulkService([
      { _id: H1, alias: 'a1', group: BULK_GROUP, ai_vendor: 'gemini' },
      { _id: H2, alias: 'a2', group: BULK_GROUP, ai_vendor: 'deepseek' },
    ]);
    await service.bulkUpdateHookAi(
      { ids: [H1, H2], ai_model: 'shared-model-name' },
      bulkCtx,
    );
    const forH1 = writes.find((x) => x.ids.includes(H1));
    const forH2 = writes.find((x) => x.ids.includes(H2));
    expect(forH1?.set).toEqual({ ai_model: 'shared-model-name' });
    expect(forH2?.set).toEqual({ ai_model_sec: 'shared-model-name' });
  });

  it('a row that never chose a vendor follows gemini, exactly as everywhere else', async () => {
    const { service, writes } = buildBulkService([
      { _id: H1, alias: 'a1', group: BULK_GROUP },
    ]);
    await service.bulkUpdateHookAi({ ids: [H1], ai_model: 'm' }, bulkCtx);
    expect(written(writes)['ai_model']).toBe('m');
  });

  it('⭐ the audit row names the column that was ACTUALLY written', async () => {
    // A log that says `ai_model` while `ai_model_sec` moved is the same lie in
    // a different place. log ก็ห้ามโกหก
    const { service, audits } = buildBulkService([
      { _id: H1, alias: 'a1', group: BULK_GROUP },
    ]);
    await service.bulkUpdateHookAi(
      { ids: [H1], ai_vendor: 'deepseek', ai_model: 'deepseek-reasoner' },
      bulkCtx,
    );
    const fields = audits
      .flatMap((a) => (a['changed_fields'] ?? []) as Array<{ field: string }>)
      .map((c) => c.field);
    expect(fields).toContain('ai_model_sec');
    expect(fields).not.toContain('ai_model');
  });

  it('⭐ sending ai_model_sec directly is a 400, never a silent drop', async () => {
    /* The column is chosen by the vendor, so naming it in the body is a caller
       that believes something untrue. Answering 200 and ignoring it is the trap
       this whole task exists to close. */
    const { service } = buildBulkService([
      { _id: H1, alias: 'a1', group: BULK_GROUP },
    ]);
    await expect(
      service.bulkUpdateHookAi(
        { ids: [H1], ai_vendor: 'deepseek', ai_model_sec: 'x' },
        bulkCtx,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
