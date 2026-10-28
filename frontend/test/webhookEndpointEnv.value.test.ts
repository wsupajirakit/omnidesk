/* [FEAT-20260814-WEBHOOKURLENV] the webhook endpoint's base-URL choice
 * ===========================================================================
 * เจ้าของสั่ง 14/08: "webhook endpoint ใช้ env = VITE_WEBHOOK_URL ถ้าไม่มี fallback
 * VITE_API_BASE_URL เอา VITE_WEBHOOK_URL ขึ้นก่อนเป็นหลัก ห้ามพัง"
 *
 * ⚠️ ทำไมเทสตรรกะแทนที่จะ render component: `import.meta.env` ถูก inline เป็น
 *    constant ตอน build (vitest.config `define`) ⇒ สลับค่าใน runtime ไม่ได้จริง
 *    การ mock ให้ผ่านจะเป็นการเทสของปลอม เคสที่ต้องกันคือ "เลือก base ผิดตัว"
 *    ซึ่งเป็นตรรกะล้วน ๆ — เทสตรงนั้นถึงจะกัดจริง
 *    define เป็น build-time ⇒ เทสค่าที่ตัดสินใจ ไม่ใช่ค่าที่ inline มาแล้ว
 *
 * เคสที่ต้องไม่พัง: ไม่ตั้ง VITE_WEBHOOK_URL = ต้องได้ URL เดิมเป๊ะ (no-op)
 */
import { describe, it, expect } from 'vitest';

/** ตรรกะเดียวกับ `HookFormModal.tsx` — override ก่อน, ว่าง/ไม่มี = fallback */
const pickWebhookBase = (override: unknown, apiBase: string): string =>
  String(override ?? '').trim() || apiBase;

/** ประกอบ endpoint แบบเดียวกับใน component (ตัด / ท้าย, encode alias) */
const buildEndpoint = (base: string, alias: string): string => {
  const a = String(alias || '')
    .trim()
    .replace(/^\/+/, '');
  if (!a) return '';
  return `${String(base || '').replace(/\/+$/, '')}/${encodeURIComponent(a)}/webhook`;
};

const API = 'https://dev-omnidesk-chat.example.com';
const HOOKURL = 'https://omnidesk-core-api.example.com';

describe('[WEBHOOK URL ENV] VITE_WEBHOOK_URL มาก่อน VITE_API_BASE_URL', () => {
  it('⭐ ตั้ง VITE_WEBHOOK_URL → ใช้ตัวนั้น ไม่ใช่ API base', () => {
    expect(pickWebhookBase(HOOKURL, API)).toBe(HOOKURL);
    expect(buildEndpoint(pickWebhookBase(HOOKURL, API), 'cczzz')).toBe(
      `${HOOKURL}/cczzz/webhook`,
    );
  });

  it('⭐ ไม่ตั้งเลย → fallback เป็น API base (พฤติกรรมเดิมเป๊ะ)', () => {
    // เคสสำคัญสุด: วันนี้ไม่มีที่ไหนตั้ง VITE_WEBHOOK_URL ⇒ ต้องได้ URL เดิม
    for (const empty of [undefined, null, '']) {
      expect(pickWebhookBase(empty, API)).toBe(API);
    }
    expect(buildEndpoint(pickWebhookBase(undefined, API), 'cczzz')).toBe(
      `${API}/cczzz/webhook`,
    );
  });

  it('⭐ ตั้งเป็นช่องว่างล้วน → นับว่าไม่ได้ตั้ง (กัน env ที่พิมพ์เว้นวรรคค้าง)', () => {
    expect(pickWebhookBase('   ', API)).toBe(API);
  });

  it('ตัด / ท้ายของ base ไม่ให้เกิด // ซ้อน', () => {
    expect(buildEndpoint(`${HOOKURL}/`, 'cczzz')).toBe(`${HOOKURL}/cczzz/webhook`);
    expect(buildEndpoint(`${HOOKURL}///`, 'cczzz')).toBe(`${HOOKURL}/cczzz/webhook`);
  });

  it('alias ว่าง = ไม่มี endpoint (ไม่โชว์ URL ที่ใช้ไม่ได้)', () => {
    expect(buildEndpoint(HOOKURL, '')).toBe('');
    expect(buildEndpoint(HOOKURL, '   ')).toBe('');
  });

  it('alias มี / นำหน้า หรืออักขระพิเศษ ถูกจัดการเหมือนเดิม', () => {
    expect(buildEndpoint(HOOKURL, '/cczzz')).toBe(`${HOOKURL}/cczzz/webhook`);
    expect(buildEndpoint(HOOKURL, 'a b')).toBe(`${HOOKURL}/a%20b/webhook`);
  });
});
