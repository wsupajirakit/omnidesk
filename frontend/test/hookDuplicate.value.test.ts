/* [FEAT-20260818-CLONEFULL] ปุ่ม Copy Item ต้องยิงเส้น duplicate ของตัวเอง
 * ===========================================================================
 * อาการที่ตรวจพบจากของจริง 18/08: OA ที่โคลนมาได้ค่าไม่ครบ — creds 5 ตัว
 * (`channel_secret` `access_token` `custom_ai_key` `slip_verify_key`
 * `external_password`) + `raw_site_rules_data` + `site_rules_updated_at` หายทุกใบ
 * เพราะ `GET /hook/:id` ส่ง `__SECRET_KEPT__` แทนค่าจริง (ตั้งใจ — ค่าลับต้องไม่ถึง
 * เบราว์เซอร์) ฟอร์มจึงไม่มีอะไรจะคัดลอก
 *
 * ทางแก้: BE คัดลอกจาก id ต้นทางเองที่ `POST /hook/:sourceId/duplicate`
 * เทสนี้ล็อก **ฝั่ง FE** ว่า
 *   1. โหมด clone ยิงเส้นใหม่ · โหมด create ยิง `POST /hook` เหมือนเดิม (ห้ามกระทบ)
 *   2. ไม่มีการส่งค่า creds จากฝั่งนี้ (ค่าจริงไม่เคยมี ส่งได้แค่ค่าว่าง/mask)
 *   3. โหมด clone ไม่เขียน audit ซ้ำจากเบราว์เซอร์ (server เขียนให้แล้ว)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const calls: { url: string; method?: string; body?: any }[] = [];
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: 'https://api.test',
  authFetch: (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Promise.resolve({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ _id: 'new-hook-id', alias: 'clone-two' }),
    } as unknown as Response);
  },
  handleApiResponse: (r: Response) => r.json(),
}));

import { webhookService } from '../services/hook';

const FORM = {
  alias: 'clone-two',
  line_oa_name: 'Clone Two',
  company_name: 'CloneCo',
  group_id: 'group-1',
  status: 0,
  telegram_key: '',
  telegram_chat_id: '',
  suggestion_text: 'a',
} as any;

beforeEach(() => {
  calls.length = 0;
});

describe('[CLONEFULL] duplicateHook', () => {
  it('⭐ ยิง POST /hook/:sourceId/duplicate (ไม่ใช่ /hook)', async () => {
    await webhookService.duplicateHook('src-123', FORM);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test/hook/src-123/duplicate');
    expect(calls[0].method).toBe('POST');
  });

  it('⭐ ส่งค่าที่กรอกในฟอร์มไปครบ และ map group_id → group เหมือน createHook', async () => {
    await webhookService.duplicateHook('src-123', FORM);
    const body = calls[0].body;
    expect(body.alias).toBe('clone-two');
    expect(body.company_name).toBe('CloneCo');
    expect(body.group).toBe('group-1');
    expect(body.group_id).toBeUndefined();
  });

  it('⭐ ไม่ส่งค่า creds จากฝั่งเบราว์เซอร์ (ไม่มีค่าจริงอยู่แล้ว)', async () => {
    await webhookService.duplicateHook('src-123', {
      ...FORM,
      channel_secret: '__SECRET_KEPT__',
      access_token: '__SECRET_KEPT__',
    });
    const body = calls[0].body;
    // ส่งไปได้แค่ sentinel/ค่าว่าง — BE เป็นฝ่ายถอด sentinel แล้วเติมจากต้นทางเอง
    for (const f of ['channel_secret', 'access_token']) {
      expect(
        body[f] === undefined || body[f] === '' || body[f] === '__SECRET_KEPT__',
      ).toBe(true);
    }
  });

  it('createHook เดิมยังยิง POST /hook ไม่ถูกเปลี่ยนเส้น', async () => {
    await webhookService.createHook(FORM);
    expect(calls[0].url).toBe('https://api.test/hook');
  });
});

/** หน้าเพจ render ใน vitest ไม่ได้ (fetch ตอน mount) จึงล็อกที่ source */
describe('[CLONEFULL] HookFormPage ต่อสายไว้ถูกโหมด', () => {
  const code = readFileSync(
    resolve(__dirname, '../pages/hook/HookFormPage.tsx'),
    'utf8',
  );

  it('⭐ clone → duplicateHook · โหมดอื่น → createHook', () => {
    expect(code).toMatch(
      /effectiveMode === 'clone' && cloneSourceId[\s\S]{0,120}duplicateHook\(/,
    );
    expect(code).toContain('await webhookService.createHook(createPayload)');
  });

  it('⭐ โหมด clone ไม่เขียน audit จากเบราว์เซอร์ (กันแถวซ้ำ)', () => {
    expect(code).toContain("if (createdId && effectiveMode !== 'clone')");
    // สาขา action:'clone' ของฝั่ง FE ต้องหายไปแล้ว
    expect(code).not.toContain("? 'clone' : 'create'");
  });
});

describe('[AUDITCLONE] หน้า audit อ่าน action=clone ได้', () => {
  const code = readFileSync(
    resolve(__dirname, '../pages/admin/AuditLogs.tsx'),
    'utf8',
  );

  it('⭐ badge มี label ของ clone (ไม่งั้นโชว์คำดิบ)', () => {
    expect(code).toContain("a === 'clone' ? t('audit.action_clone')");
  });

  it('⭐ ตัวกรองมีตัวเลือก clone', () => {
    expect(code).toContain("{ value: 'clone', label: t('audit.action_clone') }");
  });

  it('มีคำแปลครบทั้ง 4 ภาษา', () => {
    for (const lang of ['th', 'en', 'it', 'zh']) {
      const dict = JSON.parse(
        readFileSync(
          resolve(__dirname, `../i18n/translations/${lang}.json`),
          'utf8',
        ),
      );
      expect(typeof dict['audit.action_clone']).toBe('string');
      expect(dict['audit.action_clone'].length).toBeGreaterThan(0);
    }
  });
});
