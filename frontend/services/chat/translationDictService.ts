import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

/**
 * ==== [FEAT-20260803-TRANSDICT] พจนานุกรมคำแปลจาก BE (offline ไม่ใช้ AI)
 * 🔒 สาย AUTO — to_dev_auto / to_prod_auto
 *
 * เดิม panel ticket support แปลป้ายเองด้วย SR_LABELS ที่ hard-code ไว้ในไฟล์ .tsx
 * ส่วน BE ก็มีคำแปลของตัวเองใน siteRulesVarSpec — **แปล json ก้อนเดียวกันแต่คนละชุด**
 * ตรวจแล้วเพี้ยนกันจริง 34 จาก 39 field ที่ทับกัน → ย้ายมาอ่านจากที่เดียว
 *
 * ── ทำไมเป็น store แบบ subscribe ไม่ใช่ hook ที่ fetch เอง ──────────────────
 *   srLabel() ถูกเรียก "ระหว่าง render" (sync) จึงต้องอ่านจากตัวแปรที่พร้อมอยู่แล้ว
 *   → เก็บใน module scope · โหลดครั้งเดียวต่อการเปิดหน้า · โหลดเสร็จค่อยกระตุ้น re-render
 *   ⚠️ ยังไม่โหลดเสร็จ = ใช้ fallback ที่ hard-code ไว้ → ไม่มีจังหวะที่ป้ายว่างหรือเป็นชื่อ field ดิบ
 *
 * ⚠️ API ล่ม = ไม่ retry รัว ๆ (กันถล่ม BE) · ใช้ fallback ต่อไปเงียบ ๆ
 * revert: ลบไฟล์นี้ + จุดเรียกใน components/profile-panel/ProfilePanel.tsx (marker เดียวกัน)
 */

export type DictMap = Record<string, Record<string, { th?: string; en?: string; desc?: string }>>;

let CACHE: DictMap = {};
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** ค่าที่ component อ่านตอน render — sync ล้วน ไม่มี await */
export const dictLookup = (dict: string, key: string): string | null => {
  const hit = CACHE?.[dict]?.[String(key).toLowerCase()];
  const v = hit?.th || '';
  return v === '' ? null : v;
};

export const isDictLoaded = () => loaded;
export const subscribeDict = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

/** โหลดครั้งเดียว — เรียกซ้ำได้ ไม่ยิงซ้ำ */
export const loadTranslationDict = async (dict = 'site_rules_label'): Promise<void> => {
  if (loaded || inflight) return inflight ?? undefined;
  inflight = (async () => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/translation-dict?dict=${encodeURIComponent(dict)}`);
      const parsed = await handleApiResponse<any>(res, 'load translation dict');
      CACHE = (parsed?.data ?? parsed) || {};
      loaded = true;
      listeners.forEach((fn) => { try { fn(); } catch (_) { /* ไม่ให้ตัวเดียวล้มพาตัวอื่นตาย */ } });
    } catch (e) {
      // เงียบไว้ — panel ยังใช้ fallback ได้ ไม่ต้องรบกวนผู้ใช้
      console.error('load translation dict failed (ใช้คำแปลสำรองในไฟล์ต่อ)', e);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

/** เรียกหลังแอดมินแก้คำแปล เพื่อดึงชุดใหม่ */
export const reloadTranslationDict = async (dict = 'site_rules_label') => {
  loaded = false;
  CACHE = {};
  await loadTranslationDict(dict);
};

/* ==== [FEAT-20260803-TRANSDICT] CRUD สำหรับหน้าแอดมิน ============================
 * ⚠️ ทุกเส้นต้องมี token — BE คุมด้วย authorize("translation_dict.manage")
 * ⚠️ ทุกครั้งที่เขียนสำเร็จ BE จะ invalidate cache ให้เอง (Redis pub/sub)
 *    ฝั่ง FE แค่ reload ชุดของตัวเองพอ
 * ============================================================================ */
export interface TranslationRow {
  _id: string;
  dict_name: string;
  key: string;
  value_th: string;
  value_en: string;
  desc_th: string;
  scope: string | null;
  source: 'seed' | 'admin';
  updated_at?: string;
  /** [FEAT-20260803-TRANSDICT] value = แปลค่า · label = แปลชื่อ field (path ผูกกับคีย์) */
  translate_mode?: 'value' | 'label';
  key_paths?: { path: string; side: string }[];
  /* ==== [REFACTOR-20260803-DICTIDENTITY] identity is 5 columns now ==============
   * 1 row = 1 WORD (not 1 position). path/scope/tool are OPTIONAL override slots,
   * null on every seeded row.
   * ⚠️ `path` (แบบมี index) ถูกถอดทิ้ง — ใช้ `path_canon` แบบยุบ index แทน
   *    index ไม่เคยกำหนดคำแปล (พิสูจน์แล้ว 0/86 กลุ่ม) เก็บไว้ = แถวซ้ำ 74%
   * ============================================================================ */
  /** null = ทุกตำแหน่ง · มีค่า = ทับเฉพาะตำแหน่งนั้น (ยุบ index เสมอ) */
  path_canon?: string | null;
  /** custom tool ที่คำแปลแถวนี้เป็นของ — แต่ละ tool คนละ json คนละ path */
  custom_tool_id?: string | null;
  /** ชื่อ tool ที่ BE resolve มาให้ (แอดมินอ่าน ObjectId ไม่รู้เรื่อง) */
  custom_tool_name?: string | null;
  /** แถวนี้เป็นชั้นไหน — BE คำนวณให้ (base = ค่ากลาง) */
  layer?: 'base' | 'tool' | 'web' | 'path';
  /** คำนี้ถูกใช้ที่ไหนบ้าง — BE คำนวณสดจาก FORMAT_RULES ไม่ได้เก็บใน DB */
  used_at?: { path: string; side: string; tag: string | null; kind?: string }[];
  used_count?: number;
  source_side?: 'profile' | 'site_rules' | 'both' | 'unknown';
}

/** dict ตัวนี้ถูกใช้ที่ path ไหน ฝั่งไหน — BE คำนวณจาก FORMAT_RULES ให้ */
export interface DictUsage { kind: string; path: string; side: 'profile' | 'site_rules' | 'both' | 'unknown'; tag: string | null }
export type UsageMap = Record<string, DictUsage[]>;

export const translationDictService = {
  listRows: async (params: { page?: number; limit?: number; dict?: string; q?: string } = {}) => {
    const sp = new URLSearchParams();
    sp.append('page', String(params.page ?? 1));
    sp.append('limit', String(params.limit ?? 50));
    if (params.dict) sp.append('dict', params.dict);
    if (params.q) sp.append('q', params.q);
    const res = await authFetch(`${API_BASE_URL}/api/translation-dict/rows?${sp.toString()}`);
    const parsed = await handleApiResponse<any>(res, 'list translation rows');
    return {
      data: (parsed?.data ?? []) as TranslationRow[],
      meta: parsed?.meta ?? { total: 0, page: 1, limit: 50 },
      usage: (parsed?.usage ?? {}) as UsageMap,
    };
  },

  /* [REFACTOR-20260803-DICTIDENTITY] custom tool list for the create/edit modal.
   * ⚠️ ใช้เส้นของ translation-dict เอง ไม่ใช่ /api/custom-tools
   *    เพราะเส้นนั้นต้องมีสิทธิ์ custom_tools.manage ซึ่งคนดูแลคำแปลอาจไม่มี */
  listTools: async (): Promise<{ _id: string; name: string }[]> => {
    const res = await authFetch(`${API_BASE_URL}/api/translation-dict/tools`);
    const parsed = await handleApiResponse<any>(res, 'load custom tools');
    return parsed?.data || [];
  },

  upsert: async (row: Partial<TranslationRow>) => {
    const res = await authFetch(`${API_BASE_URL}/api/translation-dict`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    });
    const parsed = await handleApiResponse<any>(res, 'save translation');
    await reloadTranslationDict();  // ให้ panel เห็นคำใหม่ทันทีโดยไม่ต้อง refresh
    return parsed?.data as TranslationRow;
  },

  remove: async (id: string) => {
    const res = await authFetch(`${API_BASE_URL}/api/translation-dict/${id}`, { method: 'DELETE' });
    await handleApiResponse<any>(res, 'delete translation');
    await reloadTranslationDict();
  },
};
