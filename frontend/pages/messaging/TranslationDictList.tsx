import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Search, Trash2, Edit2, X, Save, Loader2, Languages, Info } from 'lucide-react';
import { translationDictService, TranslationRow, UsageMap } from '../../services/chat';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { useI18n } from '../../i18n';

/**
 * ==== [FEAT-20260803-TRANSDICT] หน้าจัดการคำแปล (offline dictionary)
 * 🔒 สาย AUTO — to_dev_auto / to_prod_auto
 *
 * เมนู "translation-dict" ในหมวด จัดการทั่วไป · สิทธิ์ translation_dict.manage
 *
 * ⭐ ทำไมต้องมีหน้านี้: คำแปลเคย hard-code อยู่ 2 repo (BE siteRulesVarSpec 39 คำ /
 *    FE PersonalPanel 91 คำ) แล้วเพี้ยนกัน 34 ตัว · ย้ายลง DB แล้วแอดมินแก้เองได้
 *    ไม่ต้อง deploy · แก้เสร็จ BE invalidate cache ให้ทุก instance ทันที
 *
 * ⚠️ ลบแถวที่มาจาก seed = กลับไปใช้ค่าตั้งต้นในไฟล์ ไม่ใช่คำแปลหายไป
 *    (translationDictSeed.js เป็นตาข่ายชั้นสุดท้าย) — บอกผู้ใช้ไว้ในกล่องยืนยัน
 *
 * revert: ลบไฟล์นี้ + route ใน App.tsx + รายการใน MegaMenu + seedTranslationMenu
 */

/* [REFACTOR-20260803-DICTIDENTITY] รายชื่อหมวดมาจาก usage (= FORMAT_RULES ฝั่ง BE)
 * ⚠️ เดิมเป็นลิสต์พิมพ์มือแล้วล้าสมัยทันทีที่เพิ่ม/เปลี่ยนชื่อหมวด
 *    (ตอนพบมี tx_status / withdraw_mode ที่ไม่มีจริงแล้ว และขาด transaction_type)
 *    กฎในโค้ดคือแหล่งความจริง — ให้ dropdown เดินตามกฎ ไม่ต้องมาคอย sync มือ */

const EMPTY: Partial<TranslationRow> = {
  dict_name: '', key: '', value_th: '', value_en: '', desc_th: '', scope: null,
};

const SIDE_LABEL: Record<string, string> = {
  profile: 'โปรไฟล์ลูกค้า', site_rules: 'ข้อมูลเว็บ', both: 'ทุกแหล่ง', unknown: 'ไม่ทราบ',
};

export const TranslationDictList: React.FC = () => {
  /* [FEAT-20261022-I18NPAGESEN] `tr`, because `t` already names a tool in this file's maps */
  const { t: tr } = useI18n();
  const [rows, setRows] = useState<TranslationRow[]>([]);
  const [total, setTotal] = useState(0);
  // [FEAT-20260803-TRANSDICT] dict ไหนใช้กับ path ไหน — BE ส่งมาพร้อม rows
  const [usage, setUsage] = useState<UsageMap>({});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [dict, setDict] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<TranslationRow> | null>(null);
  // [FEAT-20260803-TRANSDICT] จำคีย์เดิมไว้ — ถ้าแอดมินเปลี่ยนหมวด/คีย์ ต้อง "ย้าย" ไม่ใช่ทิ้งแถวเก่าค้าง
  const [origKey, setOrigKey] = useState<{ id?: string; dict_name?: string; key?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // [FEAT-20260803-TRANSDICT] ในฟอร์ม: เลือก "ประเภท" ก่อน แล้ว path ค่อยกรองตามประเภท
  const [formSide, setFormSide] = useState<string>('profile');
  const [deleteRow, setDeleteRow] = useState<TranslationRow | null>(null);
  const [alert, setAlert] = useState<{ open: boolean; title: string; msg: string; type: 'success' | 'error' }>(
    { open: false, title: '', msg: '', type: 'success' });
  // [FEAT-20260803-TRANSDICT] เลือกจำนวนต่อหน้าได้
  const [limit, setLimit] = useState(25);
  /* [REFACTOR-20260803-DICTIDENTITY] รายชื่อ custom tool สำหรับ dropdown ในฟอร์ม
     custom tool = คลังคำของ vendor · 1 tool ผูกได้หลาย OA -> OA เหล่านั้นแชร์คำกัน */
  const [tools, setTools] = useState<{ _id: string; name: string }[]>([]);
  useEffect(() => {
    translationDictService.listTools()
      .then(setTools)
      .catch(() => setTools([]));   // ไม่มีสิทธิ์/ยิงไม่ได้ = เหลือแค่ "ค่ากลาง" ไม่พังทั้งหน้า
  }, []);

  // ยิงทุกตัวอักษร = ถล่ม BE ด้วย regex — หน่วงให้พิมพ์จบคำก่อน (สูตรเดียวกับหน้า contacts)
  useEffect(() => {
    const id = setTimeout(() => { setQ(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await translationDictService.listRows({ page, limit, dict: dict || undefined, q: q || undefined });
      setRows(res.data);
      setTotal(res.meta.total || 0);
      setUsage(res.usage || {});
    } catch (e: any) {
      setAlert({ open: true, title: tr('pageui.messaging.dict_load_failed', 'โหลดคำแปลไม่สำเร็จ'), msg: e?.message || '', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [page, dict, q, limit]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const save = async () => {
    if (!editing?.dict_name || !editing?.key) {
      setAlert({ open: true, title: tr('pageui.messaging.dict_incomplete', 'กรอกไม่ครบ'), msg: tr('pageui.messaging.dict_need_dict_key', 'ต้องมีหมวดและคีย์'), type: 'error' });
      return;
    }
    /* [REFACTOR-20260803-DICTIDENTITY] ทุกแถวต้องมีเจ้าของ
       แต่ละ custom tool คนละ json คนละ path -> คำแปลที่ไม่ผูก tool
       จะไม่รู้ว่ากำลังพูดถึงข้อมูลของใคร */
    if (!editing?.custom_tool_id) {
      setAlert({ open: true, title: tr('pageui.messaging.dict_no_tool_title', 'ยังไม่ได้เลือก Custom Tool'),
        msg: tr('pageui.messaging.dict_no_tool_msg', 'ต้องเลือกก่อนว่าคำแปลนี้เป็นของ json ตัวไหน — แต่ละ tool คนละ path'), type: 'error' });
      return;
    }
    setSaving(true);
    try {
      await translationDictService.upsert(editing);
      // ⭐ เปลี่ยนหมวด/คีย์ = ย้ายแถว → ลบแถวเดิมทิ้ง ไม่งั้นจะเหลือคำแปลผีค้างใน DB
      const moved = origKey?.id && (origKey.dict_name !== editing.dict_name || origKey.key !== editing.key);
      if (moved) {
        try { await translationDictService.remove(origKey.id!); }
        catch (e) { console.error('ลบแถวเดิมหลังย้ายไม่สำเร็จ', e); }
      }
      setEditing(null);
      setOrigKey(null);
      setAlert({ open: true, title: tr('pageui.messaging.dict_saved', 'บันทึกแล้ว'), msg: moved ? tr('pageui.messaging.dict_moved', 'ย้ายไปคีย์ใหม่แล้ว · ทุกเครื่องเห็นทันที') : tr('pageui.messaging.dict_saved_msg', 'ทุกเครื่องเห็นคำแปลใหม่ทันที'), type: 'success' });
      fetchRows();
    } catch (e: any) {
      setAlert({ open: true, title: tr('pageui.messaging.dict_save_failed', 'บันทึกไม่สำเร็จ'), msg: e?.message || '', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    try {
      await translationDictService.remove(deleteRow._id);
      setAlert({ open: true, title: tr('pageui.messaging.dict_deleted', 'ลบแล้ว'), msg: tr('pageui.messaging.dict_deleted_msg', 'ค่าจะกลับไปใช้ค่าตั้งต้นในระบบ'), type: 'success' });
      fetchRows();
    } catch (e: any) {
      setAlert({ open: true, title: tr('pageui.messaging.dict_delete_failed', 'ลบไม่สำเร็จ'), msg: e?.message || '', type: 'error' });
    } finally {
      setDeleteRow(null);
    }
  };

  /* [FEAT-20260803-TRANSDICT] กลับด้าน usage (หมวด→path) ให้เป็น path→หมวด
     เพราะในฟอร์ม แอดมินเลือก "ข้อมูลตัวไหน" ก่อน แล้วหมวดตามมาเอง
     ⚠️ 1 path มีได้หมวดเดียวเสมอ (กฎในโค้ดบังคับไว้) จึงกลับด้านได้ตรง ๆ */
  const dictOptions = React.useMemo(() => {
    const names = [...new Set(Object.keys(usage))].sort();
    return [{ value: '', label: tr('pageui.messaging.dict_all_categories', 'ทุกหมวด') }, ...names.map((n) => ({ value: n, label: n }))];
  }, [usage]);

  const pathOptions = React.useMemo(() => {
    const out: { path: string; side: string; dict: string; tag: string | null }[] = [];
    for (const [dictName, list] of Object.entries(usage)) {
      for (const u of list) out.push({ path: u.path, side: u.side, dict: dictName, tag: u.tag });
    }
    const rank = (s: string) => (s === 'profile' ? 0 : s === 'site_rules' ? 1 : 2);
    return out.sort((a, b) => rank(a.side) - rank(b.side) || a.path.localeCompare(b.path));
  }, [usage]);

  /* [FEAT-20260803-TRANSDICT] ยุบ path ที่ต่างกันแค่ index ให้เหลือบรรทัดเดียว
     ⚠️ path ผูกกับ "หมวด" ไม่ใช่ "คีย์" → ทุกแถวของหมวดเดียวกันได้ path ชุดเดียวกัน
        (คีย์ประเภทสินค้าของปลายทาง ใช้ได้กับทุกตำแหน่งใน recent_products) — ถ้าไม่ยุบจะเห็น
        5 บรรทัดซ้ำกันทุกแถวจนอ่านไม่ออก
     แสดงเป็น recent_products[0..4] + จำนวนตำแหน่ง · hover เห็นรายการเต็ม */
  const compactUsage = React.useCallback((list: typeof usage[string] = []) => {
    const groups = new Map<string, { side: string; idx: number[]; tags: string[]; sample: string }>();
    for (const u of list) {
      const base = u.path.replace(/\[(\d+)\]/g, '[#]');
      const g = groups.get(base) || { side: u.side, idx: [], tags: [], sample: u.path };
      const m = u.path.match(/\[(\d+)\]/);
      if (m) g.idx.push(Number(m[1]));
      if (u.tag) g.tags.push(u.tag);
      groups.set(base, g);
    }
    return [...groups.entries()].map(([base, g]) => {
      const label = g.idx.length > 1
        ? base.replace('[#]', `[${Math.min(...g.idx)}..${Math.max(...g.idx)}]`)
        : g.sample;
      return { label, side: g.side, count: g.idx.length, tags: g.tags };
    });
  }, []);

  const pages = Math.max(Math.ceil(total / limit), 1);
  const input = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-primary-500';

  return (
    <div className="flex flex-col gap-5">
      {/* หัวข้อ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary-50 text-primary-600"><Languages size={22} /></div>
          <div>
            {/* ต้องตรงกับ label เมนู (nav.translation_dict) เสมอ ไม่งั้นผู้ใช้งง */}
            <h1 className="text-xl font-black text-slate-900">translation-dict</h1>
            <p className="text-xs text-slate-700">{tr('pageui.messaging.dict_subtitle', 'พจนานุกรมกลาง — ใช้ทั้งการ์ด flex, dynamic tag และแผงข้อมูลเว็บ')}</p>
          </div>
        </div>
        <button
          onClick={() => { setFormSide('profile'); setOrigKey(null); setEditing({ ...EMPTY }); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white text-sm font-bold hover:bg-primary-600 transition-colors"
        ><Plus size={16} /> {tr('pageui.messaging.dict_add', 'เพิ่มคำแปล')}</button>
      </div>

      {/* คำอธิบายสั้น ๆ กันเข้าใจผิดเรื่องการลบ */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100 text-[12px] text-blue-800">
        <Info size={15} className="shrink-0 mt-0.5" />
        <span>
          {tr('pageui.messaging.dict_info_a', 'แก้แล้วมีผลทันทีทุกเครื่อง ไม่ต้อง deploy · แถวที่มาจากระบบ (seed) ถ้าลบจะ')}
          <b> {tr('pageui.messaging.dict_info_b', 'กลับไปใช้ค่าตั้งต้น')}</b> {tr('pageui.messaging.dict_info_c', 'ไม่ใช่คำแปลหายไป · ค่าที่ไม่มีในพจนานุกรมจะแสดงตามที่ปลายทางส่งมา')}
        </span>
      </div>

      {/* ตัวกรอง */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={dict} onChange={(e) => { setDict(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold min-w-[220px]">
          {dictOptions.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-700" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder={tr('pageui.messaging.dict_search_ph', 'ค้นหาคีย์ / คำแปลไทย / อังกฤษ...')}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm" />
        </div>
        <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold" title={tr('pageui.messaging.dict_per_page_title', 'จำนวนต่อหน้า')}>
          {[25, 50, 75, 100].map((n) => <option key={n} value={n}>{tr('pageui.messaging.dict_per_page', '{n} / หน้า', { n })}</option>)}
        </select>
        <button onClick={fetchRows} className="p-2 rounded-lg border border-slate-300 text-slate-700 hover:text-primary-600" title={tr('pageui.messaging.dict_reload', 'โหลดใหม่')}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ตาราง */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left">
              {[tr('pageui.messaging.dict_col_key', 'คำ [key]'), 'Custom Tool', tr('pageui.messaging.dict_col_th', 'คำแปลไทย'), tr('pageui.messaging.dict_col_en', 'อังกฤษ'), tr('pageui.messaging.dict_col_desc', 'คำอธิบาย'), tr('pageui.messaging.dict_col_used', 'ใช้ที่ไหน'), tr('pageui.messaging.dict_col_layer', 'ชั้น'), tr('pageui.messaging.dict_col_source', 'ที่มา'), ''].map((h, i) => (
                <th key={i} className="px-3 py-2.5 text-[11px] font-bold text-slate-700 uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={9} className="py-10 text-center"><Loader2 className="animate-spin mx-auto text-primary-500" size={22} /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="py-10 text-center text-sm text-slate-700">{tr('pageui.messaging.dict_empty', 'ไม่พบคำแปลที่ตรงกับเงื่อนไข')}</td></tr>
            ) : rows.map((r) => (
              <tr key={r._id} className="hover:bg-slate-50 transition-colors">
                {/* ⭐ [REFACTOR-20260803-DICTIDENTITY] 1 แถว = 1 "คำ" ไม่ใช่ 1 ตำแหน่ง
                    เดิมโชว์ 1 บรรทัดต่อ 1 path → promo_status/open มี 6 บรรทัดเหมือนกันเป๊ะ
                    ซึ่งหลอกตา: ดูเหมือนแก้ทีละตำแหน่งได้ แต่จริง ๆ ต้องแก้ให้ตรงกันเองทั้ง 6
                    ตอนนี้บอกความจริง: คำเดียว ใช้ N ที่ · กดดูรายการได้ · ทับเฉพาะที่ก็ได้ */}
                <td className="px-3 py-2">
                  <span className="text-[13px] font-mono text-slate-700">
                    {r.dict_name}<span className="text-primary-600 font-bold"> [{r.key}]</span>
                  </span>
                </td>
                {/* [REFACTOR-20260803-DICTIDENTITY] เจ้าของแถว — ชื่อ ไม่ใช่ ObjectId */}
                <td className="px-3 py-2">
                  {r.custom_tool_name
                    ? <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-violet-100 text-violet-700">{r.custom_tool_name}</span>
                    : <span className="text-[11px] text-slate-800">—</span>}
                </td>
                <td className="px-3 py-2 text-[13px] font-semibold text-slate-900">{r.value_th || <span className="text-slate-800">—</span>}</td>
                <td className="px-3 py-2 text-[12px] text-slate-700">{r.value_en || <span className="text-slate-800">—</span>}</td>
                <td className="px-3 py-2 text-[12px] text-slate-700 max-w-[240px] truncate" title={r.desc_th}>{r.desc_th || <span className="text-slate-800">—</span>}</td>
                {/* ใช้ที่ไหน — BE คำนวณสดจาก FORMAT_RULES ไม่ได้เก็บใน DB */}
                <td className="px-3 py-2">
                  {r.used_count ? (
                    <details className="group">
                      <summary className="cursor-pointer list-none text-[11px] text-slate-700 hover:text-primary-600 select-none">
                        <span className="font-bold text-slate-700">{r.used_count}</span> {tr('pageui.messaging.dict_places', 'ตำแหน่ง')}
                        <span className="ml-1 text-[9px] text-slate-700 group-open:hidden">▸ {tr('pageui.messaging.dict_view', 'ดู')}</span>
                      </summary>
                      <div className="mt-1.5 max-h-40 overflow-y-auto space-y-0.5 pr-1">
                        {(r.used_at || []).map((u, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <span className={`shrink-0 text-[8px] font-bold px-1 py-px rounded ${
                              u.side === 'profile' ? 'bg-indigo-100 text-indigo-700'
                              : u.side === 'site_rules' ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-700'}`}>
                              {u.side === 'profile' ? tr('pageui.messaging.dict_side_profile_short', 'โปรไฟล์') : u.side === 'site_rules' ? tr('pageui.messaging.dict_side_site', 'ข้อมูลเว็บ') : tr('pageui.messaging.dict_side_both', 'ทุกแหล่ง')}
                            </span>
                            <span className="text-[10px] font-mono text-slate-700 break-all">{u.path}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : <span className="text-[11px] text-slate-800">—</span>}
                </td>
                {/* ชั้นของแถว — แอดมินต้องรู้ว่ากำลังแก้ "ค่ากลาง" หรือ "ของทับ" */}
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    r.layer === 'base' ? 'bg-slate-100 text-slate-700'
                    : r.layer === 'tool' ? 'bg-violet-100 text-violet-700'
                    : r.layer === 'web' ? 'bg-sky-100 text-sky-700'
                    : 'bg-orange-100 text-orange-700'}`}
                    title={r.layer === 'base' ? tr('pageui.messaging.dict_layer_base_tip', 'ค่ากลาง ใช้ทุก custom tool ทุกเว็บ ทุกตำแหน่ง')
                      : r.layer === 'tool' ? tr('pageui.messaging.dict_layer_tool_tip', 'ทับเฉพาะ custom tool นี้')
                      : r.layer === 'web' ? tr('pageui.messaging.dict_layer_web_tip', 'ทับเฉพาะเว็บ {scope}', { scope: r.scope }) : tr('pageui.messaging.dict_layer_path_tip', 'ทับเฉพาะตำแหน่ง {path}', { path: r.path_canon })}>
                    {r.layer === 'base' ? tr('pageui.messaging.dict_layer_base', 'ค่ากลาง') : r.layer === 'tool' ? tr('pageui.messaging.dict_layer_tool', 'เฉพาะ tool') : r.layer === 'web' ? tr('pageui.messaging.dict_layer_web', 'เฉพาะ {scope}', { scope: r.scope }) : tr('pageui.messaging.dict_layer_path', 'เฉพาะตำแหน่ง')}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.source === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                    {r.source === 'admin' ? tr('pageui.messaging.dict_source_admin', 'แก้เอง') : tr('pageui.messaging.dict_source_system', 'ระบบ')}
                  </span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => { setFormSide(pathOptions.find((o) => o.dict === r.dict_name)?.side || 'profile'); setOrigKey({ id: r._id, dict_name: r.dict_name, key: r.key }); setEditing(r); }} className="p-1.5 rounded-lg text-slate-700 hover:text-primary-600 hover:bg-primary-50" title={tr('pageui.messaging.dict_edit', 'แก้ไข')}><Edit2 size={15} /></button>
                  <button onClick={() => setDeleteRow(r)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-red-50" title={tr('pageui.messaging.dict_delete', 'ลบ')}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
          <span className="text-xs text-slate-700">{tr('pageui.messaging.dict_total', 'ทั้งหมด {n} คำ', { n: total })}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 rounded-lg border border-slate-300 text-xs font-bold disabled:opacity-40">{tr('pageui.messaging.dict_prev', 'ก่อนหน้า')}</button>
            <span className="text-xs text-slate-700">{page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded-lg border border-slate-300 text-xs font-bold disabled:opacity-40">{tr('pageui.messaging.dict_next', 'ถัดไป')}</button>
          </div>
        </div>
      </div>

      {/* ฟอร์มเพิ่ม/แก้ */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-black text-slate-900">{editing._id ? tr('pageui.messaging.dict_edit_title', 'แก้ไขคำแปล') : tr('pageui.messaging.dict_add', 'เพิ่มคำแปล')}</h2>
              <button onClick={() => { setEditing(null); setOrigKey(null); }} className="p-1.5 rounded-lg text-slate-700 hover:text-slate-700"><X size={20} /></button>
            </div>
            <div className="p-5 flex flex-col gap-3">
              {/* ⭐ ลำดับ: ประเภท → custom tool → path → คีย์
                  1) custom tool ไหน      ← json ของใคร · มี path อะไร ชุดค่าอะไร
                  2) ข้อมูลฝั่งไหน (โปรไฟล์ / ข้อมูลเว็บ)
                  3) path ไหน             ← หมวดเป็นผลลัพธ์ ไม่ต้องเลือกเอง
                  4) key value + คำแปล */}
              {/* ⭐ [REFACTOR-20260803-DICTIDENTITY] บนสุด — ต้องรู้ก่อนทุกอย่างว่านี่คือ json ของ tool ไหน
                  custom tool = ตัวกำหนด endpoint ปลายทาง = ตัวกำหนดว่า json หน้าตายังไง
                  และมี path/ชุดค่า enum อะไรบ้าง  `data.profile.status` อาจเป็น
                  enable|disable ที่ vendor หนึ่ง และ active|banned ที่อีกเจ้า
                  ⇒ tool มาก่อนทุกช่อง · ทุกแถวต้องมีเจ้าของ ไม่มี "ค่ากลางลอย ๆ"
                  ⚠️ 1 custom tool ผูกได้หลาย OA -> OA เหล่านั้นแชร์คำแปลกันเองอัตโนมัติ */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Custom Tool <span className="text-red-500">*</span>
                </label>
                <select value={editing.custom_tool_id || ''}
                  onChange={(e) => setEditing({ ...editing, custom_tool_id: e.target.value || null })}
                  className={input}>
                  <option value="">{tr('pageui.messaging.dict_pick_tool', '— เลือก custom tool —')}</option>
                  {tools.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-slate-700">
                  {editing.custom_tool_id
                    ? <>{tr('pageui.messaging.dict_owner_a', 'path และคำแปลด้านล่างนับเป็นของ')} <b className="text-violet-700">{tools.find((t) => t._id === editing.custom_tool_id)?.name || tr('pageui.messaging.dict_this_tool', 'tool นี้')}</b> {tr('pageui.messaging.dict_owner_b', '· OA ทุกตัวที่ผูก tool นี้เห็นเหมือนกัน')}</>
                    : <span className="text-red-500">{tr('pageui.messaging.dict_owner_required', 'ต้องเลือกก่อน — แต่ละ tool คนละ json คนละ path คำแปลจึงต้องมีเจ้าของ')}</span>}
                </p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{tr('pageui.messaging.dict_data_type', 'ประเภทข้อมูล *')}</label>
                <div className="flex gap-2">
                  {[['profile', 'โปรไฟล์ลูกค้า'], ['site_rules', 'ข้อมูลเว็บ'], ['both', 'ทุกแหล่ง']].map(([v, label]) => {
                    const n = pathOptions.filter((o) => o.side === v).length;
                    const on = formSide === v;
                    return (
                      <button key={v} type="button" disabled={n === 0}
                        onClick={() => { setFormSide(v); setEditing({ ...editing, dict_name: '' }); }}
                        className={`flex-1 px-3 py-2 rounded-lg border text-xs font-bold transition-all disabled:opacity-40 ${
                          on ? 'bg-primary-500 text-white border-primary-500 shadow-sm' : 'bg-white text-slate-700 border-slate-300 hover:border-primary-400'}`}>
                        {tr(`pageui.messaging.dict_side_${v}`, label)} <span className="opacity-70">({n})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Path *</label>
                <select
                  value={pathOptions.find((o) => o.dict === editing.dict_name && o.side === formSide)?.path || ''}
                  onChange={(e) => {
                    const hit = pathOptions.find((o) => o.path === e.target.value && o.side === formSide);
                    setEditing({ ...editing, dict_name: hit ? hit.dict : '' });
                  }}
                  className={`${input} font-mono text-[12px]`}>
                  <option value="">{tr('pageui.messaging.dict_pick_path', '— เลือก path ใน{side} —', { side: formSide === 'profile' ? tr('pageui.messaging.dict_side_profile', 'โปรไฟล์ลูกค้า') : formSide === 'site_rules' ? tr('pageui.messaging.dict_side_site_rules', 'ข้อมูลเว็บ') : tr('pageui.messaging.dict_side_both', 'ทุกแหล่ง') })}</option>
                  {pathOptions.filter((o) => o.side === formSide).map((o) => (
                    <option key={o.path + o.dict} value={o.path}>{o.path}</option>
                  ))}
                </select>
                {editing.dict_name && (
                  <p className="mt-1 text-[10px] text-slate-700">
                    {tr('pageui.messaging.dict_save_category', 'หมวดที่จะบันทึก:')} <span className="font-mono text-slate-600">{editing.dict_name}</span>
                    {' '}{tr('pageui.messaging.dict_category_all_paths', '· คำแปลนี้จะใช้กับทุก path ในหมวดนี้')}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">key value *</label>
                <input value={editing.key || ''}
                  onChange={(e) => setEditing({ ...editing, key: e.target.value })}
                  placeholder={tr('pageui.messaging.dict_key_ph', 'เช่น wait-approve')} className={`${input} font-mono`} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{tr('pageui.messaging.dict_col_th', 'คำแปลไทย')}</label>
                <input value={editing.value_th || ''} onChange={(e) => setEditing({ ...editing, value_th: e.target.value })}
                  placeholder={tr('pageui.messaging.dict_th_ph', 'เช่น รออนุมัติ')} className={input} />
                <p className="mt-1 text-[10px] text-slate-700">{tr('pageui.messaging.dict_th_blank_hint', 'เว้นว่าง = ไม่แปล (แสดงตามที่ปลายทางส่งมา)')}</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{tr('pageui.messaging.dict_col_en', 'อังกฤษ')}</label>
                <input value={editing.value_en || ''} onChange={(e) => setEditing({ ...editing, value_en: e.target.value })} className={input} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{tr('pageui.messaging.dict_col_desc', 'คำอธิบาย')}</label>
                <input value={editing.desc_th || ''} onChange={(e) => setEditing({ ...editing, desc_th: e.target.value })}
                  placeholder={tr('pageui.messaging.dict_desc_ph', 'ใช้ในตารางแนะนำตัวแปร (ไม่ใส่ = ใช้คำแปลไทย)')} className={input} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{tr('pageui.messaging.dict_web_only', 'เฉพาะเว็บ (web_code)')}</label>
                <input value={editing.scope || ''} onChange={(e) => setEditing({ ...editing, scope: e.target.value || null })}
                  placeholder={tr('pageui.messaging.dict_web_ph', 'เว้นว่าง = ใช้ทุกเว็บ')} className={input} />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
              <button onClick={() => { setEditing(null); setOrigKey(null); }} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-bold text-slate-600">{tr('pageui.messaging.dict_cancel', 'ยกเลิก')}</button>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white text-sm font-bold disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {tr('pageui.messaging.dict_save', 'บันทึก')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteRow}
        onClose={() => setDeleteRow(null)}
        onConfirm={confirmDelete}
        title={tr('pageui.messaging.dict_delete_title', 'ลบคำแปลนี้?')}
        message={tr('pageui.messaging.dict_delete_msg', '"{key}" จะกลับไปใช้ค่าตั้งต้นของระบบ (ถ้ามี) หรือแสดงตามที่ปลายทางส่งมา', { key: deleteRow?.key })}
      />
      <AlertModal
        isOpen={alert.open}
        onClose={() => setAlert({ ...alert, open: false })}
        title={alert.title}
        message={alert.msg}
        type={alert.type}
      />
    </div>
  );
};

export default TranslationDictList;
