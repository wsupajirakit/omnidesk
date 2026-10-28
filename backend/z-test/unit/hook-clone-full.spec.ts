/* [FEAT-20260818-CLONEFULL] Copy Item ต้องได้ค่าครบ · [FIX-20260818-AUDITCLONE]
 * ===========================================================================
 * อาการที่ตรวจพบจากของจริง 18/08 (เทียบ `omnideskdevoatwo` กับ `omnideskdevoa` ทีละ field):
 *   เท่ากัน 75 · หายไป 7 · เพี้ยน 2
 *   หาย  = creds 5 ตัว (`channel_secret` `access_token` `custom_ai_key`
 *          `slip_verify_key` `external_password`) + `raw_site_rules_data` +
 *          `site_rules_updated_at`
 *   เพี้ยน = `image_answer_text` หาย `\n` ท้าย 1 ตัว (create ตัดด้วย trimToString
 *          แต่ update ไม่ตัด) และ `status` (ค่าที่ผู้ใช้สลับในฟอร์ม — ไม่ใช่บั๊ก)
 *
 * ค่าที่ใช้ในเทสนี้ยกมาจากสองแถวนั้นจริง ไม่ได้แต่งขึ้น
 */
import { HookAuditLogSchema, buildClonePatch } from '@/modules/hooks';
import { SENSITIVE_FIELDS } from '@/infra/crypto';
import { stripKeptSecrets } from '../../src/modules/hooks/hook-write.helpers';
import { SECRET_MASK } from '../../src/modules/hooks/hooks.service';

/** ท่อนของแถวจริง `omnideskdevoa` (ตัดให้สั้นแต่คงรูปเดิม) */
const SOURCE = {
  _id: 'src-id',
  __v: 3,
  alias: 'omnideskdevoa',
  webhook_url: 'https://old.example/omnideskdevoa/webhook',
  created_at: new Date('2026-07-27T15:08:38Z'),
  updated_at: new Date('2026-08-17T17:18:27Z'),
  created_by: 'someone',
  channel_secret: 'enc:xl195QOX53d4H3E5.qMpRQQrQaDZTxRtlIEzfWUxlgOUbLc9',
  access_token: 'enc:KJS2m7F8iFPD4g26.f2yO84dRJy6zpnuY7HD68_ov6bRMWFQAMOBix',
  custom_ai_key: 'enc:2pinaYIbYcmNkEoI.fT9c6xN9F3szQl0GrZfXY06a1rmMD1s3Np',
  slip_verify_key: 'enc:A5sKJ-TYZQhczBX4.99ob7ErfCMNWiLa8zsF2zdW2sQyPXemq',
  external_password: 'enc:fixtureiv01.fixturetag01.fixturect01',
  telegram_key: null,
  raw_site_rules_data: {
    data: { shop: { cashback: { agent_id: '3c0a9e80' } } },
  },
  site_rules_updated_at: '2026-08-17T17:18:27.614Z',
  image_answer_text: 'ได้รับรูปแล้วนะคะ [[[assist]]]\n',
  company_name: 'omnideskDemo',
  status: 0,
  gemini_temperature: 0.7,
  flex_success: 'flex-1',
  group: 'group-1',
};

/** แถวที่ create เพิ่งสร้างจาก payload ของฟอร์ม (creds ว่างเพราะถูก mask) */
const freshFromForm = (over: Record<string, unknown> = {}) => ({
  _id: 'new-id',
  __v: 0,
  alias: 'omnideskdevoatwo',
  webhook_url: 'https://new.example/omnideskdevoatwo/webhook',
  created_at: new Date('2026-08-18T01:00:29Z'),
  updated_at: new Date('2026-08-18T01:00:29Z'),
  channel_secret: '',
  access_token: '',
  slip_verify_key: '',
  external_password: '',
  telegram_key: null,
  raw_site_rules_data: null,
  site_rules_updated_at: null,
  image_answer_text: 'ได้รับรูปแล้วนะคะ [[[assist]]]',
  company_name: 'two',
  status: 1,
  gemini_temperature: 0.7,
  flex_success: 'flex-1',
  group: 'group-1',
  ...over,
});

describe('[CLONEFULL] buildClonePatch — เติมเฉพาะที่ฟอร์มให้ไม่ได้', () => {
  it('⭐ creds ทั้ง 5 ตัวที่หายไป ถูกเติมกลับตามที่เก็บไว้ (ciphertext ไม่ถูกแตะ)', () => {
    const report = buildClonePatch(freshFromForm(), SOURCE, SENSITIVE_FIELDS);
    expect(report.inherited.sort()).toEqual(
      [
        'access_token',
        'channel_secret',
        'custom_ai_key',
        'external_password',
        'slip_verify_key',
      ].sort(),
    );
    // ค่าที่เติมต้องเป็นตัวเดิมเป๊ะ — ห้ามถอดรหัส/เข้ารหัสซ้ำ
    expect(report.patch['channel_secret']).toBe(SOURCE.channel_secret);
    expect(report.patch['access_token']).toBe(SOURCE.access_token);
    expect(String(report.patch['custom_ai_key'])).toMatch(/^enc:/);
  });

  it('⭐ ข้อมูลที่ระบบดึงมาเก็บ (site rules) ถูกเติมด้วย', () => {
    const report = buildClonePatch(freshFromForm(), SOURCE, SENSITIVE_FIELDS);
    expect(report.copied).toContain('raw_site_rules_data');
    expect(report.copied).toContain('site_rules_updated_at');
    expect(report.patch['raw_site_rules_data']).toEqual(
      SOURCE.raw_site_rules_data,
    );
  });

  it('⭐ ข้อความที่ต่างกันแค่ `\\n` ท้าย ถูกคืนเป็นค่าต้นทางแบบตรงบิต', () => {
    const report = buildClonePatch(freshFromForm(), SOURCE, SENSITIVE_FIELDS);
    expect(report.preserved).toContain('image_answer_text');
    expect(report.patch['image_answer_text']).toBe(SOURCE.image_answer_text);
    expect(String(report.patch['image_answer_text']).endsWith('\n')).toBe(true);
  });

  it('⭐ ตัวตนของรายการใหม่ห้ามถูกทับ (alias / webhook_url / เวลา / _id)', () => {
    const report = buildClonePatch(freshFromForm(), SOURCE, SENSITIVE_FIELDS);
    for (const key of [
      '_id',
      '__v',
      'alias',
      'webhook_url',
      'created_at',
      'updated_at',
      'created_by',
    ]) {
      expect(Object.keys(report.patch)).not.toContain(key);
    }
  });

  it('⭐ ค่าที่ผู้ใช้กรอก/สลับในฟอร์มชนะเสมอ (ชื่อบริษัท · สถานะ)', () => {
    const report = buildClonePatch(freshFromForm(), SOURCE, SENSITIVE_FIELDS);
    expect(Object.keys(report.patch)).not.toContain('company_name');
    expect(Object.keys(report.patch)).not.toContain('status');
  });

  it('creds ที่ payload ส่งค่าจริงมา (ผู้ใช้พิมพ์ token ใหม่) ต้องไม่ถูกทับด้วยของต้นทาง', () => {
    const report = buildClonePatch(
      freshFromForm({ channel_secret: 'enc:brand-new-value' }),
      SOURCE,
      SENSITIVE_FIELDS,
    );
    expect(report.inherited).not.toContain('channel_secret');
    expect(Object.keys(report.patch)).not.toContain('channel_secret');
    // ตัวอื่นยังสืบทอดตามปกติ
    expect(report.inherited).toContain('access_token');
  });

  it('ต้นทางเป็นค่าว่าง/null = ไม่มีอะไรต้องเติม', () => {
    const report = buildClonePatch(
      freshFromForm(),
      { ...SOURCE, custom_ai_key: null, raw_site_rules_data: null },
      SENSITIVE_FIELDS,
    );
    expect(report.inherited).not.toContain('custom_ai_key');
    expect(report.copied).not.toContain('raw_site_rules_data');
  });

  it('ค่าที่ต่างกันจริง (ไม่ใช่แค่ช่องว่าง) ต้องไม่ถูกคืนเป็นของต้นทาง', () => {
    const report = buildClonePatch(
      freshFromForm({ image_answer_text: 'ข้อความที่ผู้ใช้แก้เอง' }),
      SOURCE,
      SENSITIVE_FIELDS,
    );
    expect(report.preserved).not.toContain('image_answer_text');
    expect(Object.keys(report.patch)).not.toContain('image_answer_text');
  });

  it('array ว่างถือว่ายังไม่มีค่า จึงเติมจากต้นทางได้', () => {
    const report = buildClonePatch(
      freshFromForm({ flex_custom_ids: [] }),
      { ...SOURCE, flex_custom_ids: ['a', 'b'] },
      SENSITIVE_FIELDS,
    );
    expect(report.patch['flex_custom_ids']).toEqual(['a', 'b']);
  });

  it('เอกสารต้นทางกับใหม่เหมือนกันหมด = patch ว่าง (ไม่เขียน DB เปล่า ๆ)', () => {
    const identical = { ...SOURCE, _id: 'new-id', alias: 'x' };
    const report = buildClonePatch(identical, SOURCE, SENSITIVE_FIELDS);
    expect(report.patch).toEqual({});
  });
});

/* [FIX-20260818-CLONEAIPAIR] คู่ผูก ai_vendor ↔ custom_ai_key บนเส้น duplicate
 * ===========================================================================
 * เจอตอน merge p2 เข้ามา (audit 18/08) — เส้น duplicate เกิดก่อนที่ p2 จะเพิ่ม
 * `ai_vendor`/`ai_model` จึงไม่รู้จักกติกา "คีย์เป็นของค่ายนั้น" ที่ p2 วางไว้
 *
 * ของจริงที่เกิดได้: ทุกแถวใน DB ตอนนี้ `ai_vendor` เป็น null (= ค่า default) และ
 * มี `custom_ai_key` อยู่ 6/7 แถว · ฟอร์ม Copy Item เปิดให้สลับ vendor ได้จริง
 * (`AiVendorSelect` disable เฉพาะโหมด view) ⇒ กด copy แล้วเลือก deepseek จะได้
 * OA ใหม่ที่เป็น deepseek แต่ถือคีย์ gemini ของต้นทาง
 *
 * ทำไมร้ายแรงกว่าที่คิด: `resolveVendorKey` เอา "คีย์ของ hook เอง" ก่อนเสมอ
 * (`resolve-vendor-key.ts:59-60`) ไม่ได้เช็คว่าคีย์นั้นเป็นของค่ายไหน ⇒ คีย์ Google
 * จะถูกส่งออกไปที่ api.deepseek.com — ตรงกับสิ่งที่ไฟล์นั้นประกาศห้ามไว้เอง
 * ("คีย์ค่ายหนึ่งห้ามหลุดไปอีกค่ายเด็ดขาด")
 *
 * กติกาที่เทสนี้ตรึง: **ค่ายย้าย = คีย์ไม่ตามไป** (และ model ก็ไม่ตามไป เพราะเป็น
 * ชื่อรุ่นของอีกค่าย) · ค่ายไม่ย้าย = ทุกอย่างเหมือนเดิมเป๊ะ (เคสข้างบนทั้ง 13 ตัว
 * ต้องเขียวต่อโดยไม่แก้แม้บรรทัดเดียว — นั่นคือหลักฐาน before/after ที่ห้ามกระทบ)
 */
describe('[CLONEAIPAIR] duplicate: ค่ายย้ายแล้วคีย์ต้องไม่ตามไป', () => {
  /** ต้นทางที่มีคีย์ของค่ายเดิมอยู่จริง (เหมือนแถวจริงทุกแถวใน DB ตอนนี้) */
  const geminiSource = { ...SOURCE, ai_vendor: null, ai_model: null };

  it('⭐ สลับค่าย (default → deepseek) ⇒ ไม่สืบทอด custom_ai_key', () => {
    const report = buildClonePatch(
      freshFromForm({ ai_vendor: 'deepseek', ai_model: null }),
      geminiSource,
      SENSITIVE_FIELDS,
    );
    expect(Object.keys(report.patch)).not.toContain('custom_ai_key');
    expect(report.inherited).not.toContain('custom_ai_key');
    expect(report.skipped).toContain('custom_ai_key');
  });

  it('⭐ สลับค่าย ⇒ ไม่เติม ai_model ของค่ายเดิมกลับมา (ชื่อรุ่นข้ามค่าย)', () => {
    const report = buildClonePatch(
      freshFromForm({ ai_vendor: 'deepseek', ai_model: null }),
      { ...geminiSource, ai_model: 'gemini-2.0-flash' },
      SENSITIVE_FIELDS,
    );
    expect(Object.keys(report.patch)).not.toContain('ai_model');
    expect(report.skipped).toContain('ai_model');
  });

  it('สลับกลับทาง (deepseek → gemini) ก็ต้องไม่ลากคีย์ deepseek ไปด้วย', () => {
    const report = buildClonePatch(
      freshFromForm({ ai_vendor: 'gemini' }),
      { ...SOURCE, ai_vendor: 'deepseek', ai_model: 'deepseek-chat' },
      SENSITIVE_FIELDS,
    );
    expect(Object.keys(report.patch)).not.toContain('custom_ai_key');
    expect(Object.keys(report.patch)).not.toContain('ai_model');
  });

  it('ค่ายเดิม (ฟอร์มไม่แตะ vendor) ⇒ คีย์ยังสืบทอดตามเดิมทุกประการ', () => {
    // ฟอร์มไม่ส่ง vendor ⇒ แถวใหม่ว่าง ⇒ กฎ 2 เติมของต้นทาง = คู่ยังครบ
    const report = buildClonePatch(
      freshFromForm(),
      geminiSource,
      SENSITIVE_FIELDS,
    );
    expect(report.inherited).toContain('custom_ai_key');
    expect(report.skipped).toEqual([]);
  });

  it('เลือกค่ายเดิมซ้ำอีกครั้ง (gemini → gemini) ⇒ ไม่ถือว่าย้าย', () => {
    const report = buildClonePatch(
      freshFromForm({ ai_vendor: 'gemini' }),
      { ...SOURCE, ai_vendor: 'gemini' },
      SENSITIVE_FIELDS,
    );
    expect(report.inherited).toContain('custom_ai_key');
    expect(report.skipped).toEqual([]);
  });

  it('ฟอร์มล้าง vendor เป็นค่าว่าง = "ใช้ค่า default" ไม่ใช่การย้ายค่าย', () => {
    // '' ผ่าน parseAiVendor เป็น null (parse-ai-vendor.ts:38) ⇒ กฎ 2 เติมของต้นทาง
    const report = buildClonePatch(
      freshFromForm({ ai_vendor: '' }),
      geminiSource,
      SENSITIVE_FIELDS,
    );
    expect(report.skipped).toEqual([]);
    expect(report.inherited).toContain('custom_ai_key');
  });
});

describe('[AUDITCLONE] enum ของ hook_audit_logs รับ action=clone', () => {
  it('⭐ `clone` อยู่ในรายการที่อนุญาต (เดิมไม่มี ⇒ POST /audit/logs ตอบ 500 ทุกครั้ง)', () => {
    const allowed = HookAuditLogSchema.path('action').options.enum as string[];
    expect(allowed).toContain('clone');
  });

  it('ค่าที่เคยใช้อยู่ต้องยังอยู่ครบ ไม่ได้เผลอถอดตัวใดออก', () => {
    const allowed = HookAuditLogSchema.path('action').options.enum as string[];
    for (const action of [
      'create',
      'update',
      'delete',
      'send',
      'cancel',
      'toggle_status',
      'toggle_fast_mode',
      'login',
      'bulk_delete',
      'clear_tickets',
    ]) {
      expect(allowed).toContain(action);
    }
  });
});

/* [PIN-20261016-CLONEKEYSEC] Copy Item และคีย์ AI ตัวที่ 2 (`custom_ai_key_sec` = คีย์ DeepSeek)
 * ===========================================================================
 * เจ้าของรายงาน 16/10 ว่า Copy Item ไม่คัดลอกคีย์ตัวที่ 2 · ตรวจของจริงแล้ว **ไม่ใช่บั๊ก**:
 * ต้นทาง `omnideskdevoa` มีค่า `null` (ไม่มีคีย์ตั้งแต่แรก) แถวใหม่ได้ `''` — ไม่มีคีย์ทั้งคู่
 * (การเทียบรอบแรกเอา `JSON.stringify(null)` ไปเทียบกับ `""` จึงดูเหมือนหาย — วินิจฉัยผิดเอง)
 *
 * เส้นจริง: FE ส่ง `__SECRET_KEPT__` มา → `stripKeptSecrets` ตัดทิ้งเพราะ field อยู่ใน
 * `SENSITIVE_FIELDS` → แถวใหม่ไม่มีคีย์ → `buildClonePatch` เติม ciphertext ของต้นทางตรงบิต
 * ข้อยกเว้นเดียวที่ตั้งใจ: ฟอร์มสลับ `ai_vendor` ⇒ ไม่รับคีย์/รุ่นของต้นทางทั้ง 4 ช่อง
 * (`hook-clone/ai-pair.ts` [FEAT-20260904-VENDORSECCOL])
 *
 * ชุดนี้ PIN เส้นนั้นไว้ ไม่มีการแก้โค้ด — ถ้าวันหนึ่งคีย์ตัวที่ 2 ไม่ตามมาจริง ต้องแดงที่นี่
 */
describe('[CLONEKEYSEC] Copy Item: คีย์ AI ตัวที่ 2 ตามมาครบเมื่อต้นทางมี', () => {
  const SEC = 'enc:Zx9Qm2LkP0aBcDeF.k3yS3cOnDvEnDoRcIpHeRtExT00';
  const secSource = {
    ...SOURCE,
    custom_ai_key_sec: SEC,
    ai_model_sec: 'deepseek-chat',
  };

  it('⭐ ต้นทางมีคีย์ตัวที่ 2 + ฟอร์มส่ง mask มา ⇒ แถวใหม่ได้ ciphertext เดิมตรงบิต', () => {
    // ฟอร์ม Copy Item ส่งค่า mask ที่ GET ให้มา — create ตัดทิ้งก่อนเขียนแถวใหม่
    const body: Record<string, unknown> = { custom_ai_key_sec: SECRET_MASK };
    stripKeptSecrets(body, SENSITIVE_FIELDS, SECRET_MASK);
    expect(body).not.toHaveProperty('custom_ai_key_sec');

    const report = buildClonePatch(
      freshFromForm(),
      secSource,
      SENSITIVE_FIELDS,
    );
    expect(report.inherited).toContain('custom_ai_key_sec');
    expect(report.patch['custom_ai_key_sec']).toBe(SEC);
    expect(report.patch['ai_model_sec']).toBe('deepseek-chat');
  });

  it('ฟอร์มส่งคีย์ใหม่มาจริง ⇒ ของผู้ใช้ชนะ ไม่ถูกทับด้วยของต้นทาง', () => {
    const report = buildClonePatch(
      freshFromForm({ custom_ai_key_sec: 'enc:typedByAdmin.new' }),
      secSource,
      SENSITIVE_FIELDS,
    );
    expect(report.patch).not.toHaveProperty('custom_ai_key_sec');
  });

  it('🔴 ต้นทางไม่มีคีย์ (null — แถวจริง omnideskdevoa) + แถวใหม่ "" ⇒ ไม่มีอะไรให้เติม', () => {
    const report = buildClonePatch(
      freshFromForm({ custom_ai_key_sec: '' }),
      { ...SOURCE, custom_ai_key_sec: null },
      SENSITIVE_FIELDS,
    );
    expect(report.patch).not.toHaveProperty('custom_ai_key_sec');
    expect(report.inherited).not.toContain('custom_ai_key_sec');
  });

  it('ฟอร์มสลับค่าย ⇒ คีย์ตัวที่ 2 ไม่ตามมาเหมือนตัวแรก (ตั้งใจ — แอดมินกรอกของตัวเอง)', () => {
    const report = buildClonePatch(
      freshFromForm({ ai_vendor: 'deepseek' }),
      { ...secSource, ai_vendor: null },
      SENSITIVE_FIELDS,
    );
    expect(report.patch).not.toHaveProperty('custom_ai_key_sec');
    expect(report.skipped).toContain('custom_ai_key_sec');
  });

  it('คีย์ตัวที่ 2 เป็นความลับ (อยู่ใน SENSITIVE_FIELDS) ⇒ mask ตอนอ่าน + ตัดตอนเขียน', () => {
    expect(SENSITIVE_FIELDS).toContain('custom_ai_key_sec');
  });
});
