// [FEAT-20260802-BANKNICE] เรียก "ทะเบียนธนาคารกลาง" จาก BE (/api/banks)
//   แหล่งความจริงเดียว (BE bankDirectory) → FE ไม่ถือ copy เอง (no tech debt)
//   cache ไว้ใน module — โหลดครั้งเดียวต่อ session (ข้อมูลนิ่ง ไม่ต้องดึงซ้ำ)
//   ⚠️ endpoint กันด้วย auth (คนนอกยิงไม่ได้) · โลโก้เป็น static ที่ BE host
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

export interface BankInfo {
  code?: string;
  color?: string;
  official_name?: string;
  thai_name?: string;
  nice_name?: string;
  logo?: string; // relative path เช่น /bank-logos/bbl.png
}

type BankTable = Record<string, BankInfo>;
let cache: BankTable | null = null;
let inflight: Promise<BankTable> | null = null;

export const bankService = {
  /** โหลดทะเบียนธนาคาร (ประเทศ th) แบบ cache · โหลดพร้อมกันหลายที่ก็ยิงครั้งเดียว */
  getDirectory: async (country = 'th'): Promise<BankTable> => {
    if (cache) return cache;
    if (!inflight) {
      inflight = (async () => {
        try {
          const res = await authFetch(`${API_BASE_URL}/api/banks`, { method: 'GET' });
          const parsed = await handleApiResponse<any>(res, 'banks');
          cache = (parsed?.data?.[country] as BankTable) || {};
        } catch (e) {
          console.error('load bank directory failed', e);
          cache = {}; // ล้มเหลว = ว่าง · UI fallback ไปโชว์ code เดิม ไม่พัง
        }
        return cache;
      })();
    }
    return inflight;
  },

  /** หา info ของธนาคารจาก code (bbl/BBL/" bbl ") — ไม่รู้จัก → null */
  lookup: (table: BankTable, code?: string | null): BankInfo | null => {
    const key = String(code ?? '').trim().toLowerCase();
    return key && table[key] ? table[key] : null;
  },

  /** URL โลโก้เต็ม (เติม host ของ BE) · ไม่มี → null */
  logoUrl: (logo?: string | null): string | null => (logo ? `${API_BASE_URL}${logo}` : null),
};
