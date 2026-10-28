import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { StickyNote, ChevronDown, Loader2, Plus, Pencil, Trash2, Save, Tags, X, AlertTriangle, User as UserIcon } from 'lucide-react';
import { chatService, ChatRoom, CustomerNote, CustomerTag } from '../../services/chat';
import { getStoredAuth } from '../../services/authStorage';
import { useI18n, translateNow } from '../../i18n';
import { ConfirmModal } from '../modals';

/**
 * ==== [FEAT-20260731-CONTACTS] START — ไฟล์ใหม่ (ย้ายโค้ดมา ไม่ได้เขียนใหม่)
 * 🔒 งานสาย AUTO — to_dev_auto / to_prod_auto เท่านั้น
 *
 * การ์ดข้อมูลลูกค้าที่ใช้ร่วมกันระหว่างหน้า Ticket Chat และหน้า Contacts
 *
 * WHY THIS FILE EXISTS:
 * โค้ดพวกนี้เคยอยู่ใน `pages/TicketChat.tsx` (5,365 บรรทัด) และไม่ได้ export
 * หน้า Contacts ต้องแสดงข้อมูลชุดเดียวกันเป๊ะ ทางเลือกมีสองทาง
 *   (ก) ก็อปโค้ดไปไว้อีกที่  → มีสองชุด แก้ทีต้องแก้สองที่ ลืมที่ใดที่หนึ่ง
 *                              = สองหน้าแสดงไม่ตรงกัน (tech debt)
 *   (ข) ย้ายออกมาเป็นไฟล์กลาง แล้วให้ทั้งสองหน้า import  ← เลือกทางนี้
 * ผลคือ TicketChat.tsx **สั้นลง** ไม่ใช่ยาวขึ้น และมีโค้ดชุดเดียวในระบบ
 *
 * MOVED VERBATIM — ยกมาทั้งก้อนไม่แก้ตรรกะแม้แต่บรรทัดเดียว
 * ที่ต่างจากเดิมมีแค่ (1) เติม `export` (2) แก้ path ของ import ให้ชี้ถูก
 * (3) `CurrentAdminCard` รับ prop เป็นค่าที่ต้องใช้จริงแทนทั้ง ticket object
 *     เพราะหน้า Contacts ไม่มี ticket — ดูคอมเมนต์ตรงตัวมันเอง
 *
 * ทั้งสองการ์ดผูกกับ `room._id` อย่างเดียว ไม่แตะ ticket เลยตั้งแต่แรก
 * จึงย้ายได้ตรงๆ โดยไม่ต้องดัดแปลงอะไร
 *
 * revert: ย้ายเนื้อไฟล์นี้กลับเข้า TicketChat.tsx ตำแหน่งเดิม (ดู git show ของ
 *         commit ที่มี marker นี้) แล้วลบ import + โฟลเดอร์ components/member
 * ==== [FEAT-20260731-CONTACTS] END
 */

// Dynamic Tag Palette Generator — 24 distinct high-contrast vibrant color palettes with PURE WHITE text (text-white).
// Every tag label hashes to one of these 24 distinct colors so no custom tags repeat colors and text is always white.
const DYNAMIC_TAG_PALETTES = [
  { style: 'bg-purple-600/80 text-white border-purple-400 dark:bg-purple-900/80 dark:text-white dark:border-purple-400/80', dot: 'bg-purple-400' },
  { style: 'bg-sky-600/80 text-white border-sky-400 dark:bg-sky-900/80 dark:text-white dark:border-sky-400/80', dot: 'bg-sky-400' },
  { style: 'bg-emerald-600/80 text-white border-emerald-400 dark:bg-emerald-900/80 dark:text-white dark:border-emerald-400/80', dot: 'bg-emerald-400' },
  { style: 'bg-amber-600/80 text-white border-amber-400 dark:bg-amber-900/80 dark:text-white dark:border-amber-400/80', dot: 'bg-amber-400' },
  { style: 'bg-rose-600/80 text-white border-rose-400 dark:bg-rose-900/80 dark:text-white dark:border-rose-400/80', dot: 'bg-rose-400' },
  { style: 'bg-cyan-600/80 text-white border-cyan-400 dark:bg-cyan-900/80 dark:text-white dark:border-cyan-400/80', dot: 'bg-cyan-400' },
  { style: 'bg-orange-600/80 text-white border-orange-400 dark:bg-orange-900/80 dark:text-white dark:border-orange-400/80', dot: 'bg-orange-400' },
  { style: 'bg-indigo-600/80 text-white border-indigo-400 dark:bg-indigo-900/80 dark:text-white dark:border-indigo-400/80', dot: 'bg-indigo-400' },
  { style: 'bg-pink-600/80 text-white border-pink-400 dark:bg-pink-900/80 dark:text-white dark:border-pink-400/80', dot: 'bg-pink-400' },
  { style: 'bg-teal-600/80 text-white border-teal-400 dark:bg-teal-900/80 dark:text-white dark:border-teal-400/80', dot: 'bg-teal-400' },
  { style: 'bg-fuchsia-600/80 text-white border-fuchsia-400 dark:bg-fuchsia-900/80 dark:text-white dark:border-fuchsia-400/80', dot: 'bg-fuchsia-400' },
  { style: 'bg-lime-700/80 text-white border-lime-500 dark:bg-lime-900/80 dark:text-white dark:border-lime-400/80', dot: 'bg-lime-400' },
  { style: 'bg-violet-600/80 text-white border-violet-400 dark:bg-violet-900/80 dark:text-white dark:border-violet-400/80', dot: 'bg-violet-400' },
  { style: 'bg-blue-600/80 text-white border-blue-400 dark:bg-blue-900/80 dark:text-white dark:border-blue-400/80', dot: 'bg-blue-400' },
  { style: 'bg-cyan-700/80 text-white border-cyan-400 dark:bg-cyan-950/90 dark:text-white dark:border-cyan-400/80', dot: 'bg-cyan-300' },
  { style: 'bg-emerald-700/80 text-white border-emerald-400 dark:bg-emerald-950/90 dark:text-white dark:border-emerald-400/80', dot: 'bg-emerald-300' },
  { style: 'bg-purple-700/80 text-white border-purple-400 dark:bg-purple-950/90 dark:text-white dark:border-purple-400/80', dot: 'bg-purple-300' },
  { style: 'bg-orange-700/80 text-white border-orange-400 dark:bg-orange-950/90 dark:text-white dark:border-orange-400/80', dot: 'bg-orange-300' },
  { style: 'bg-pink-700/80 text-white border-pink-400 dark:bg-pink-950/90 dark:text-white dark:border-pink-400/80', dot: 'bg-pink-300' },
  { style: 'bg-indigo-700/80 text-white border-indigo-400 dark:bg-indigo-950/90 dark:text-white dark:border-indigo-400/80', dot: 'bg-indigo-300' },
  { style: 'bg-teal-700/80 text-white border-teal-400 dark:bg-teal-950/90 dark:text-white dark:border-teal-400/80', dot: 'bg-teal-300' },
  { style: 'bg-rose-700/80 text-white border-rose-400 dark:bg-rose-950/90 dark:text-white dark:border-rose-400/80', dot: 'bg-rose-300' },
  { style: 'bg-amber-700/80 text-white border-amber-400 dark:bg-amber-950/90 dark:text-white dark:border-amber-400/80', dot: 'bg-amber-300' },
  { style: 'bg-slate-700/80 text-white border-slate-400 dark:bg-slate-800 dark:text-white dark:border-slate-400/80', dot: 'bg-slate-400' },
];

function hashTagLabel(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

export const getDynamicTagColor = (label?: string | null, _customColor?: string | null): string => {
  const l = (label || 'tag').trim();
  const idx = hashTagLabel(l) % DYNAMIC_TAG_PALETTES.length;
  return DYNAMIC_TAG_PALETTES[idx].style;
};

export const getDynamicTagDotColor = (label?: string | null, _customColor?: string | null): string => {
  const l = (label || 'tag').trim();
  const idx = hashTagLabel(l) % DYNAMIC_TAG_PALETTES.length;
  return DYNAMIC_TAG_PALETTES[idx].dot;
};

// Thai fallback for raw English tag/category values that may come from the DB.
// Known labels (already Thai) pass through unchanged. Extend as needed.
const TH_LABEL: Record<string, string> = {
  vip: 'VIP', collection: 'ทวงถาม', it: 'อุปกรณ์', payment: 'ชำระค่างวด',
  loan: 'สินเชื่อ', other: 'อื่นๆ', deposit: 'แจ้งฝาก', complaint: 'ร้องเรียน',
  'slow-withdraw': 'ถอนช้า', 'wait-slip': 'รอสลิป', 'new-register': 'สมัครใหม่',
  fraud: 'ตรวจสอบทุจริต', promo: 'สอบถามโปร',
};
/* [FEAT-20261022-I18NTICKETEN] a known raw value reads in the UI language (th = the map
   above, unchanged); anything else is a label an admin typed — shown as typed. */
export const thLabel = (raw?: string | null) => {
  const s = (raw || '').trim();
  const k = s.toLowerCase();
  return TH_LABEL[k] ? translateNow(`ticketui.member.tag.${k.replace(/-/g, '_')}`, TH_LABEL[k]) : s;
};

// ── Current admin card — shown on BOTH right-pane tabs. Avatar + name when
// assigned, otherwise an unassigned/bot state so it never disappears. ─────────
// username, with the display_name (ชื่อเล่น) in parentheses when it differs.
export const adminLabel = (admin?: { username?: string; display_name?: string } | null) => {
  if (!admin) return '';
  const u = admin.username || '';
  const d = admin.display_name || '';
  if (u && d && d !== u) return `${u} (${d})`;
  return u || d || '';
};
// [FEAT-20260731-CONTACTS] เดิมรับ `ticket: TicketEntry` ทั้งก้อน แต่ใช้จริงแค่ 3 ค่า
// หน้า Contacts ไม่มี ticket (มีแต่ห้องแชท) จึงเปลี่ยนเป็นรับ 3 ค่านั้นตรงๆ
// ตรรกะข้างในไม่แก้แม้แต่บรรทัดเดียว ฝั่ง TicketChat ส่งค่าจาก ticket เข้ามาแทน
// revert: เปลี่ยน props กลับเป็น { ticket } แล้วอ่าน field จาก ticket เหมือนเดิม
export const CurrentAdminCard: React.FC<{
  jobStatus?: number | string | null;
  chatStatus?: string | null;
  adminUser?: { username?: string; display_name?: string } | null;
}> = ({ jobStatus, chatStatus, adminUser }) => {
  const { t } = useI18n(); // [FEAT-20261022-I18NTICKETEN]
  const isClosed = Number(jobStatus) === 2;
  const isBot = chatStatus === 'bot' || isClosed;
  const admin = isClosed ? null : adminUser;
  const name = isClosed ? 'bot' : adminLabel(admin);

  return (
    <div className={`rounded-lg p-2.5 flex items-center justify-between shadow-sm border ${admin ? 'bg-blue-50 border-blue-200' : 'bg-amber-500/10 border-amber-500/30'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white text-xs font-bold ${admin ? 'bg-blue-700' : 'bg-amber-500'}`}>
          {isClosed ? 'B' : (name ? name.charAt(0).toUpperCase() : <UserIcon size={15} />)}
        </span>
        <div className="min-w-0">
          <p className={`text-[10px] mb-0.5 leading-none ${admin ? 'text-blue-600' : 'text-amber-600 dark:text-amber-400'}`}>{t('ticketui.member.current_admin', 'ผู้ดูแลปัจจุบัน')}</p>
          <p className={`text-sm font-bold leading-none truncate ${admin ? 'text-blue-900' : 'text-gray-800 dark:text-gray-100'}`}>
            {isClosed ? 'bot' : (name || (isBot ? t('ticketui.member.bot_care', 'บอทดูแล') : t('ticketui.member.no_admin', 'ยังไม่มีผู้ดูแล')))}
          </p>
        </div>
      </div>
      {admin ? (
        <span className="flex items-center gap-1.5 bg-white border border-blue-100 text-blue-600 px-2 py-1 rounded text-[10px] font-bold shadow-sm shrink-0">
          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" /> {t('ticketui.member.replying', 'กำลังตอบ')}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 bg-white border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-2 py-1 rounded text-[10px] font-bold shrink-0">
          {isClosed ? 'bot' : (isBot ? t('ticketui.member.bot', 'บอท') : t('ticketui.member.waiting', 'รอรับเคส'))}
        </span>
      )}
    </div>
  );
};

export const CustomerNotes: React.FC<{ room: ChatRoom | null }> = ({ room }) => {
  const { t } = useI18n();
  const [notes, setNotes] = useState<CustomerNote[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  // [FIX-20260731-PANELCOLLAPSE] เดิมเปิดอยู่ ผู้ใช้สั่ง "panel ขวา default = ย่อเก็บ"
  // [FIX-20260801-CARDEXPAND] ผู้ใช้กลับคำสั่ง: "card ทั้งหมด default expand ไว้ไม่ใช่ย่อ"
  // (การ์ดในแท็บ "ดำเนินการ" = โน้ตภายใน + ป้าย อยู่ในไฟล์นี้)
  // ⚠️ ไฟล์นี้ใช้ร่วมกับหน้า Contacts ด้วย — การ์ดจึงกางทั้งสองหน้าเหมือนกัน
  // ซึ่งสอดคล้องกัน (เป็นการ์ดชุดเดียวกัน ควรมีพฤติกรรมเดียวกัน)
  // revert: กลับเป็น useState(false) ทั้ง 2 จุดในไฟล์นี้
  const [open, setOpen] = useState(true); // collapsible
  // Confirm dialog for add / delete (delete is a soft delete on the server).
  const [confirm, setConfirm] = useState<{ action: 'add' | 'delete'; id?: string } | null>(null);
  // Current admin — for the "delete only your own (unless superadmin)" rule.
  const me = useMemo(() => {
    const a = getStoredAuth();
    return {
      id: a?.user?.id || '',
      name: a?.user?.display_name || a?.user?.username || 'แอดมิน',
      isSuper: (a?.role?.name || '').toLowerCase() === 'superadmin',
    };
  }, []);
  const canDelete = (n: CustomerNote) => me.isSuper || (!!me.id && String((n as any).created_by || '') === String(me.id));

  const load = useCallback(async () => {
    if (!room?._id) { setNotes([]); return; }
    try {
      setLoading(true);
      const res = await chatService.listNotes(room._id);
      setNotes(res.data || []);
    } catch (e) { console.error('load notes failed', e); }
    finally { setLoading(false); }
  }, [room?._id]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!room?._id || !draft.trim()) return;
    try {
      setSaving(true);
      const res = await chatService.createNote(room._id, draft.trim());
      setNotes(prev => [res.data, ...prev]);
      setDraft('');
    } catch (e) { console.error('add note failed', e); }
    finally { setSaving(false); }
  };

  const saveEdit = async (id: string) => {
    if (!editText.trim()) return;
    try {
      const res = await chatService.updateNote(id, editText.trim());
      setNotes(prev => prev.map(n => n._id === id ? res.data : n));
      setEditingId(null);
    } catch (e) { console.error('edit note failed', e); }
  };

  // Soft delete: the server returns the tombstoned note (content replaced); patch
  // it in place rather than removing the row.
  const remove = async (id: string) => {
    try {
      const res = await chatService.deleteNote(id);
      const updated = (res as any)?.data;
      setNotes(prev => prev.map(n => n._id === id ? (updated || { ...n, deleted_at: new Date().toISOString() }) : n));
    } catch (e) { console.error('delete note failed', e); }
  };
  const doConfirm = async () => {
    if (!confirm) return;
    if (confirm.action === 'add') { await add(); }
    else if (confirm.action === 'delete' && confirm.id) { await remove(confirm.id); }
    setConfirm(null);
  };

  // Gregorian (ค.ศ.) date "@" time — matches the card format (e.g. 24 ก.ค. 2026 @ 00:07).
  const fmt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const date = d.toLocaleDateString('th-TH-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date} @ ${time}`;
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm flex flex-col">
      {/* ==== [FIX-20260731-CARDHEADER] START
           (1) พื้นเทาที่หัวการ์ด: <button> ไม่ได้ตั้งพื้นหลัง จึงได้สี default
               ของเบราว์เซอร์ (ButtonFace = เทา) → ใส่ bg-transparent
           (2) ผู้ใช้สั่ง "คลิกที่ตัว header card = expand/collapse เหมือนกัน"
               → ย้าย onClick ขึ้นมาที่ทั้งแถบ ปุ่มข้างในเป็นแค่ป้ายชื่อ
               ตัวนับ/เมนูด้านขวายัง stopPropagation ไว้ ไม่ให้พาลกดโดนย่อ
           revert: คืน onClick กลับไปที่ <button> แล้วลบ bg-transparent */}
      <div
        onClick={() => setOpen(o => !o)}
        className="p-3 border-b border-gray-100 flex justify-between items-center bg-yellow-50/50 rounded-t-lg cursor-pointer select-none"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-gray-700 min-w-0 bg-transparent">
          <StickyNote size={16} className="text-yellow-600 shrink-0" /> {t('ticketui.member.notes_title', 'โน๊ตภายใน')}
          <ChevronDown size={15} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
        {/* [FIX-20260731-CARDHEADER] ตัวนับเป็นแค่ป้าย ไม่ใช่ปุ่ม — ปล่อยให้คลิก
            ทะลุไปย่อ/ขยายได้ตามปกติ (ไม่ต้อง stopPropagation) */}
        <span className="text-[11px] font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{notes.length} {t('ticketui.member.notes_unit', 'โน๊ต')}</span>
      </div>
      {open && (<>
      {/* composer */}
      <div className="p-3 border-b border-gray-100">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={t('ticketui.member.note_ph', 'พิมพ์โน๊ตถึงทีมงาน...')}
          className="w-full border border-gray-300 rounded-md p-2 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none h-16 bg-gray-50 placeholder-gray-400"
          disabled={!room?._id}
        />
        <button
          onClick={() => setConfirm({ action: 'add' })}
          disabled={saving || !room?._id || !draft.trim()}
          className="mt-2 w-full bg-gray-800 hover:bg-black text-white font-medium text-xs py-2 rounded transition-colors shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} {t('ticketui.member.add_note', 'เพิ่มโน๊ต')}
        </button>
      </div>
      {/* thread — height-capped, scrolls when long */}
      <div className="bg-gray-50/30">
        <div className="p-3 space-y-2.5 max-h-[300px] overflow-y-auto custom-scrollbar">
          {loading ? (
            <p className="text-[11px] text-gray-400 text-center py-2"><Loader2 size={14} className="animate-spin inline mr-1" /> {t('ticketui.member.loading', 'กำลังโหลด...')}</p>
          ) : notes.length === 0 ? (
            <p className="text-[11px] text-gray-400 italic text-center py-2">{t('ticketui.member.no_notes', 'ยังไม่มีโน๊ต')}</p>
          ) : (
            notes.map(n => {
              const author = n.created_by_data?.display_name || n.created_by_name || t('ticketui.member.team', 'ทีมงาน');
              const isDeleted = !!(n as any).deleted_at;
              return (
                <div key={n._id} className={`p-2.5 rounded border shadow-sm group ${isDeleted ? 'bg-gray-50 border-gray-100 opacity-70' : 'bg-white border-gray-200'}`}>
                  <div className="flex justify-between items-start mb-1.5">
                    <span className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-blue-700 text-white text-[8px] font-bold flex items-center justify-center">{author.charAt(0).toUpperCase()}</span>
                      {author}
                    </span>
                    {/* deleted notes carry no actions; live notes: edit (author) +
                        delete (author or superadmin, with confirm) */}
                    {!isDeleted && editingId !== n._id && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => { setEditingId(n._id); setEditText(n.content); }} className="text-gray-300 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity" title={t('ticketui.member.edit', 'แก้ไข')}><Pencil size={11} /></button>
                        {canDelete(n) && (
                          <button onClick={() => setConfirm({ action: 'delete', id: n._id })} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title={t('ticketui.member.delete', 'ลบ')}><Trash2 size={11} /></button>
                        )}
                      </div>
                    )}
                  </div>
                  {editingId === n._id ? (
                    <div className="flex flex-col gap-1.5">
                      <textarea value={editText} onChange={e => setEditText(e.target.value)} className="w-full border border-primary rounded p-2 text-xs focus:outline-none resize-none h-16 bg-white" autoFocus />
                      <div className="flex gap-1.5">
                        <button onClick={() => setEditingId(null)} className="flex-1 py-1 text-[11px] font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded">{t('ticketui.member.cancel', 'ยกเลิก')}</button>
                        <button onClick={() => saveEdit(n._id)} className="flex-1 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded flex items-center justify-center gap-1"><Save size={11} /> {t('ticketui.member.save', 'บันทึก')}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* content wraps and, when long, scrolls inside its own box */}
                      <p className={`text-xs leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto custom-scrollbar ${isDeleted ? 'text-gray-400 italic' : 'text-gray-600'}`}>{n.content}</p>
                      {/* last-updated timestamp (falls back to created) */}
                      <div className="mt-1.5 text-[9px] text-gray-400 text-right">
                        {t('ticket.note.updated_at')}: {fmt(n.updated_at || n.created_at)}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      </>)}

      {/* confirm add / delete (delete is a soft delete — the note stays as a
          tombstone). Backdrop does not close (ConfirmModal has no backdrop). */}
      <ConfirmModal
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={doConfirm}
        closeOnConfirm={false}
        type={confirm?.action === 'delete' ? 'danger' : 'info'}
        confirmLabel={confirm?.action === 'delete' ? t('ticketui.member.delete_note', 'ลบโน๊ต') : t('ticketui.member.add_note', 'เพิ่มโน๊ต')}
        title={confirm?.action === 'delete' ? t('ticketui.member.confirm_delete_note', 'ยืนยันลบโน๊ต') : t('ticketui.member.confirm_add_note', 'ยืนยันเพิ่มโน๊ต')}
        message={confirm?.action === 'delete'
          ? t('ticketui.member.delete_note_msg', 'โน๊ตจะถูกทำเครื่องหมายว่าลบ (soft delete) — ข้อความจะเปลี่ยนเป็น “ลบโดย {name}” และกู้คืนไม่ได้', { name: me.name })
          : t('ticketui.member.add_note_msg', 'เพิ่มโน๊ตนี้ให้ทีมงานเห็นใช่หรือไม่?')}
      />
    </div>
  );
};

// [FEAT-20260731-CONTACTS] เดิมมี TAG_PRESETS (ป้ายสำเร็จรูป 7 อัน) ตรงนี้
// ไม่ได้ถูกอ้างถึงจากที่ไหนเลยแม้แต่จุดเดียว (ของตายที่ค้างมาแต่เดิม)
// จงใจไม่ย้ายตามมา — ย้ายของที่ไม่มีใครใช้ = ยกหนี้มาไว้ที่ใหม่


// ── Customer tags (1:many) — add/remove labels, with a confirm on both. ──────
export const CustomerTags: React.FC<{ room: ChatRoom | null }> = ({ room }) => {
  const { locale, t: tr } = useI18n(); // `tr` — `t` is the tag variable in this component's maps
  const [tags, setTags] = useState<CustomerTag[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  // [FIX-20260801-CARDEXPAND] กางเป็นค่าเริ่มต้น (ดูเหตุผลที่ CustomerNotes)
  const [open, setOpen] = useState(true); // collapsible section
  const menuRef = useRef<HTMLDivElement | null>(null);
  // confirm dialog: who + which tag + which action
  const [confirm, setConfirm] = useState<{ action: 'add' | 'remove'; label: string; color?: string; id?: string } | null>(null);
  // warning modal for duplicate tags
  const [duplicateWarningTag, setDuplicateWarningTag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Global most-used labels (all admins) for the picker preview, + a type-to-
  // create/autocomplete box. popular refreshes whenever the menu opens or a tag
  // is applied, so a newly-used label appears without a reload.
  const [popular, setPopular] = useState<{ label: string; color: string | null; use_count: number }[]>([]);
  const [tagQuery, setTagQuery] = useState('');
  const [suggests, setSuggests] = useState<{ label: string; color: string | null; use_count: number }[]>([]);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const actorName = useMemo(() => {
    const a = getStoredAuth();
    return a?.user?.display_name || a?.user?.username || 'แอดมิน';
  }, []);
  const loadPopular = useCallback(async () => {
    try { const r = await chatService.popularTags(10); setPopular(r.data || []); } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    if (!room?._id) { setTags([]); return; }
    try {
      const res = await chatService.listTags(room._id);
      setTags(res.data || []);
    } catch (e) { console.error('load tags failed', e); }
  }, [room?._id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Refresh the popular list each time the picker opens (append newly-used labels).
  useEffect(() => { if (menuOpen) { loadPopular(); setTimeout(() => tagInputRef.current?.focus(), 30); } }, [menuOpen, loadPopular]);
  // Debounced autocomplete against the global stats.
  useEffect(() => {
    const q = tagQuery.trim();
    if (!q) { setSuggests([]); return; }
    const t = setTimeout(async () => {
      try { const r = await chatService.suggestTags(q); setSuggests(r.data || []); } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [tagQuery]);

  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      // Compute the authoritative next tag list here so we can both update local
      // state AND ship it in the event payload (setTags is async — `tags` is stale
      // at dispatch time).
      let nextTags = tags;
      if (confirm.action === 'add' && room?._id) {
        if (!tags.some(t => t.label.trim().toLowerCase() === confirm.label.trim().toLowerCase())) {
          const res = await chatService.createTag(room._id, confirm.label, confirm.color || '');
          nextTags = tags.some(t => t._id === res.data._id) ? tags : [res.data, ...tags];
          setTags(nextTags);
        }
      } else if (confirm.action === 'remove' && confirm.id) {
        await chatService.deleteTag(confirm.id);
        nextTags = tags.filter(t => t._id !== confirm.id);
        setTags(nextTags);
      }
      // Patch the ticket-list card chips in place (no refetch). Carry the room +
      // the new tags (reduced to {_id,label,color}) so the listener can update the
      // matching cards for this customer.
      window.dispatchEvent(new CustomEvent('tc:tags-changed', {
        detail: { roomId: room?._id, tags: nextTags.map(t => ({ _id: t._id, label: t.label, color: t.color })) },
      }));
      if (confirm.action === 'add') loadPopular();   // newly-used label climbs the popular list
      setConfirm(null);
    } catch (e) { console.error('tag action failed', e); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm relative">
      {/* [FIX-20260731-CARDHEADER] เหตุผลเดียวกับการ์ดโน๊ตด้านบน */}
      <div
        onClick={() => setOpen(o => !o)}
        className="flex justify-between items-center px-3 py-2.5 cursor-pointer select-none"
      >
        <span className="flex items-center gap-1.5 text-sm font-bold text-gray-700 min-w-0 bg-transparent">
          <Tags size={14} className="text-gray-400 shrink-0" /> {tr('ticketui.member.tags_title', 'ป้ายกำกับลูกค้า')}
          <ChevronDown size={15} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
        {/* [FIX-20260731-CARDHEADER] เมนูเพิ่มป้าย — กันไม่ให้คลิกทะลุไปย่อการ์ด */}
        <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            disabled={!room?._id}
            className="text-primary text-[11px] font-bold hover:underline flex items-center gap-1 bg-blue-50 px-2 py-1 rounded disabled:opacity-50"
          >
            <Plus size={10} /> {tr('ticketui.member.add', 'เพิ่ม')}
          </button>
          {menuOpen && (() => {
            // What shows in the list: while typing → autocomplete matches (from the
            // global stats); empty → the 10 most-used labels. A typed value that
            // matches nothing can still be created via Enter / the "+ สร้าง" row.
            const q = tagQuery.trim();
            // Combined autocomplete list: merges local popular tags, customer tags, and server suggests
            // so typing existing tags like "www" finds them immediately without depending solely on API responses.
            const list = (() => {
              if (!q) return popular;
              const map = new Map<string, { label: string; color: string | null; use_count: number }>();
              // 1. Local filter from popular tags
              popular.filter(p => p.label.toLowerCase().includes(q.toLowerCase()))
                .forEach(item => map.set(item.label.toLowerCase(), item));
              // 2. Local filter from customer's current tags
              tags.filter(t => t.label.toLowerCase().includes(q.toLowerCase()))
                .forEach(t => {
                  if (!map.has(t.label.toLowerCase())) {
                    map.set(t.label.toLowerCase(), { label: t.label, color: t.color, use_count: 1 });
                  }
                });
              // 3. Server suggestions from API
              suggests.forEach(item => {
                if (!map.has(item.label.toLowerCase())) {
                  map.set(item.label.toLowerCase(), item);
                }
              });
              return Array.from(map.values());
            })();
            const exactExists = !!q && list.some(t => t.label.trim().toLowerCase() === q.toLowerCase());
            const pick = (label: string, color?: string | null) => {
              setMenuOpen(false); setTagQuery('');
              const trimmed = label.trim();
              if (!trimmed) return;
              // Check if tag already exists on this customer (case-insensitive)
              if (tags.some(t => t.label.trim().toLowerCase() === trimmed.toLowerCase())) {
                setDuplicateWarningTag(trimmed);
                return;
              }
              setConfirm({ action: 'add', label: trimmed, color: getDynamicTagColor(trimmed, color) });
            };
            return (
              <div className="tc-select-menu absolute right-0 top-9 z-[60] w-60 rounded-md border shadow-lg p-1.5">
                {/* type-to-create + autocomplete */}
                <div className="px-1 pb-1.5">
                  <input
                    ref={tagInputRef}
                    value={tagQuery}
                    onChange={e => setTagQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && tagQuery.trim()) { e.preventDefault(); pick(tagQuery.trim()); }
                      else if (e.key === 'Escape') setMenuOpen(false);
                    }}
                    placeholder={tr('ticketui.member.tag_ph', 'พิมพ์ป้ายแล้วกด Enter เพื่อสร้าง…')}
                    title={tr('ticketui.member.tag_input_title', 'พิมพ์ชื่อป้ายแล้วกด Enter เพื่อสร้างใหม่ หรือเลือกจากรายการยอดนิยมด้านล่าง')}
                    className="w-full text-xs px-2 py-1.5 rounded border bg-transparent outline-none focus:border-primary"
                  />
                </div>
                <div className="text-[10px] font-bold opacity-60 px-2 py-1 mb-1 border-b border-black/5 flex items-center justify-between">
                  <span>{q ? tr('ticketui.member.search_results', 'ผลการค้นหา') : tr('ticketui.member.popular', 'ยอดนิยม (ทุกแอดมิน)')}</span>
                  {!q && <span className="opacity-70">{popular.length}</span>}
                </div>
                {/* create-new row when the typed value isn't an existing label */}
                {q && !exactExists && (
                  <button
                    onClick={() => pick(q)}
                    className="tc-select-opt w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs font-bold text-primary"
                  >
                    <Plus size={12} /> {tr('ticketui.member.create_tag', 'สร้าง “{q}”', { q })}
                  </button>
                )}
                {/* popular / suggestion list — capped height with scroll after 5 items */}
                <div className="max-h-[160px] overflow-y-auto custom-scrollbar">
                  {list.length === 0 && !q ? (
                    <div className="px-2 py-2 text-[11px] opacity-50">{tr('ticketui.member.no_popular', 'ยังไม่มีป้ายยอดนิยม — พิมพ์เพื่อสร้าง')}</div>
                  ) : (
                    list.map(p => {
                      const isAlreadyAdded = tags.some(t => t.label.trim().toLowerCase() === p.label.trim().toLowerCase());
                      return (
                        <button
                          key={p.label}
                          onClick={() => pick(p.label, p.color)}
                          title={isAlreadyAdded ? (locale === 'en' ? `Tag "${p.label}" is already in use (click to view warning)` : `ป้าย "${p.label}" ถูกใช้งานแล้ว (กดเพื่อดูคำเตือน)`) : tr('ticketui.member.used_times', 'ใช้แล้ว {n} ครั้ง', { n: p.use_count })}
                          className={`tc-select-opt w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-xs ${isAlreadyAdded ? 'bg-amber-500/10 dark:bg-amber-950/30' : ''}`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${getDynamicTagDotColor(p.label, p.color)}`} />
                            <span className="truncate">{thLabel(p.label)}</span>
                          </span>
                          {isAlreadyAdded ? (
                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 shrink-0">
                              {locale === 'en' ? 'In Use' : 'ใช้งานแล้ว'}
                            </span>
                          ) : (
                            <span className="text-[9px] opacity-50 shrink-0">{p.use_count}</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
      {open && (
        <div className="px-3 pb-3">
          <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-gray-50 dark:bg-slate-800/60 rounded-lg border border-gray-100 dark:border-slate-700/60 max-h-[110px] overflow-y-auto custom-scrollbar">
            {tags.length === 0 ? (
              <span className="text-[11px] text-gray-400 italic self-center">{tr('ticketui.member.no_tags', 'ยังไม่มีป้ายกำกับ')}</span>
            ) : (
              tags.map(t => (
                <span key={t._id} className={`tag-item inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-1 rounded-lg border ${getDynamicTagColor(t.label, t.color)}`} title={t.created_by_name ? tr('ticketui.member.by', 'โดย {name}', { name: t.created_by_name }) : undefined}>
                  {thLabel(t.label)}
                  <button
                    onClick={() => setConfirm({ action: 'remove', label: t.label, id: t._id })}
                    className="hover:bg-black/15 rounded-full w-5 h-5 flex items-center justify-center transition-colors -mr-1 cursor-pointer"
                    title={tr('ticketui.member.remove_tag', 'ลบป้าย')}
                  ><X size={13} /></button>
                </span>
              ))
            )}
          </div>
        </div>
      )}

      {/* confirm add / remove — names the actor, the tag, and the action */}
      <ConfirmModal
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={doConfirm}
        closeOnConfirm={false}
        type={confirm?.action === 'remove' ? 'danger' : 'info'}
        confirmLabel={busy ? tr('ticketui.member.working', 'กำลังทำ…') : (confirm?.action === 'remove' ? tr('ticketui.member.remove_tag', 'ลบป้าย') : tr('ticketui.member.add_tag', 'เพิ่มป้าย'))}
        title={confirm?.action === 'remove' ? tr('ticketui.member.confirm_remove_tag', 'ยืนยันลบป้ายกำกับ') : tr('ticketui.member.confirm_add_tag', 'ยืนยันเพิ่มป้ายกำกับ')}
        message={confirm?.action === 'remove'
          ? tr('ticketui.member.remove_tag_msg', '{actor} ต้องการลบป้าย "{label}" ออกจากลูกค้ารายนี้ — ยืนยันหรือไม่?', { actor: actorName, label: confirm?.label || '' })
          : tr('ticketui.member.add_tag_msg', '{actor} ต้องการเพิ่มป้าย "{label}" ให้ลูกค้ารายนี้ — ยืนยันหรือไม่?', { actor: actorName, label: confirm?.label || '' })}
      />

      {/* Duplicate Tag Warning Modal — displays according to user's preference language */}
      {duplicateWarningTag && (() => {
        const isEng = locale === 'en';
        const title = isEng ? 'Duplicate Tag Notice' : 'แจ้งเตือนป้ายกำกับซ้ำ';
        const subtitle = isEng ? 'Tag already assigned to this customer' : 'ป้ายกำกับถูกใช้งานให้กับลูกค้ารายนี้แล้ว';
        const message = isEng
          ? `Tag "${duplicateWarningTag}" has already been selected.`
          : `ได้เลือกป้ายกำกับ "${duplicateWarningTag}" ไปแล้ว`;
        const buttonText = isEng ? 'OK' : 'ตกลง';

        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700/60 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700/60 shrink-0">
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                    {title}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {subtitle}
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-700/60 rounded-xl text-xs font-bold text-gray-900 dark:text-white">
                <span>{message}</span>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setDuplicateWarningTag(null)}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition-colors shadow-sm cursor-pointer"
                >
                  {buttonText}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
