import React, { useCallback, useEffect, useState } from 'react';
import { Zap, Plus, Pencil, Trash2, Check, X, Loader2, Save, FolderPlus } from 'lucide-react';
/* [UI-20260826-QRCONTROLS] เจ้าของสั่ง 26/08: *"ปุ่ม เลือก / แก้ไข ของตอบด่วน = ใหญ่กว่านี้"*
   เดิม "เลือก" เป็น `text-[10px] px-2 py-1` และไอคอนแก้ไข/ลบเป็น `size={12}` ไม่มี padding
   ⇒ "เลือก" ขึ้นเป็น `text-xs px-3 py-1.5` · ไอคอนขึ้นเป็น 16 พร้อม `p-1.5`
   ⚠️ ปุ่ม "ลบ" ขยับตามด้วยทั้งที่เจ้าของเอ่ยแค่ เลือก/แก้ไข — เพราะมันอยู่ติดกัน
      ในแถวเดียวกัน ถ้าขยายแค่ตัวเดียวสองปุ่มจะสูงไม่เท่ากันและดูพัง
   ⚠️ ไม่แตะ `opacity-0 group-hover:opacity-100` — พฤติกรรม "โผล่ตอน hover" เหมือนเดิม
   revert: คืนค่าคลาสเดิมทั้งสามปุ่มตาม git history */
import { quickReplyService, QuickReplyCategory } from '../../services/chat';
import { ConfirmModal } from '../modals';
import { useI18n } from '../../i18n';
import { withVars } from './i18nVars';

/**
 * QuickReplyManager — the shared quick-reply UI, used in TWO places with the
 * same CRUD (BE is one API):
 *   - variant="panel"  : compact popover in the chat composer. Clicking a reply
 *                        calls onPick(text) → the parent inserts it into the
 *                        draft (NOT sent). CRUD is still available inline.
 *   - variant="modal"  : the big management dialog opened from the ⚙️ gear. Same
 *                        CRUD; onPick is unused there.
 */
export const QuickReplyManager: React.FC<{
  variant: 'panel' | 'modal';
  onPick?: (text: string) => void;
  /* [FIX-20260830-TRAYFULLINNER] แผงเต็มจอ — ต้องส่งเข้ามาถึงชั้นในนี้
     เพราะ cap ความสูงของรายการอยู่ที่นี่ (`max-h-[46vh]`) ไม่ใช่ที่ div ชั้นนอก
     ⇒ การลบ `max-h-*` ที่ชั้นนอกอย่างเดียวไม่พอ แผงยังเล็กเท่าเดิม
     ⚠️ optional และ default false ⇒ `variant="modal"` ในฟันเฟืองไม่กระทบเลย */
  full?: boolean;
}> = ({ variant, onPick, full = false }) => {
  const { t } = useI18n();
  const [cats, setCats] = useState<QuickReplyCategory[]>([]);
  const [activeCat, setActiveCat] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // inline editors
  const [newCatName, setNewCatName] = useState('');
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [newReplyText, setNewReplyText] = useState('');
  const [editReplyId, setEditReplyId] = useState<string | null>(null);
  const [editReplyText, setEditReplyText] = useState('');
  // confirm covers delete AND add (category/reply), so nothing is created/removed
  // without an explicit yes.
  const [confirm, setConfirm] = useState<
    | { act: 'delete'; kind: 'cat' | 'reply'; id: string; label: string }
    | { act: 'addCat'; label: string }
    | { act: 'addReply'; label: string }
    | null
  >(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await quickReplyService.list();
      const list = r.data?.categories || [];
      setCats(list);
      setActiveCat(prev => (prev && list.some(c => c._id === prev)) ? prev : (list[0]?._id || ''));
    } catch (e) { console.error('load quick replies failed', e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const current = cats.find(c => c._id === activeCat);
  const canManage = true; // both variants can CRUD (BE authorizes ticket.manage)

  const addCategory = async () => {
    const name = newCatName.trim();
    if (!name || busy) return;
    setConfirm({ act: 'addCat', label: name });   // confirm first
  };
  const saveCategory = async (id: string) => {
    const name = editCatName.trim();
    if (!name) return;
    try { setBusy(true); await quickReplyService.updateCategory(id, name); setEditCatId(null); await load(); }
    catch (e) { console.error(e); } finally { setBusy(false); }
  };
  const addReply = () => {
    const text = newReplyText.trim();
    if (!text || !activeCat || busy) return;
    setConfirm({ act: 'addReply', label: text.slice(0, 30) });   // confirm first
  };
  const saveReply = async (id: string) => {
    const text = editReplyText.trim();
    if (!text) return;
    try { setBusy(true); await quickReplyService.updateReply(id, text); setEditReplyId(null); await load(); }
    catch (e) { console.error(e); } finally { setBusy(false); }
  };
  // Actual writes — run only after confirm.
  const doAddCategory = async () => {
    const name = newCatName.trim(); if (!name) return;
    try { setBusy(true); const r = await quickReplyService.createCategory(name); setNewCatName(''); await load(); setActiveCat(r.data._id); }
    catch (e) { console.error(e); } finally { setBusy(false); }
  };
  const doAddReply = async () => {
    const text = newReplyText.trim(); if (!text || !activeCat) return;
    try { setBusy(true); await quickReplyService.createReply(activeCat, text); setNewReplyText(''); await load(); }
    catch (e) { console.error(e); } finally { setBusy(false); }
  };
  const doConfirm = async () => {
    if (!confirm) return;
    if (confirm.act === 'delete') {
      try { setBusy(true); if (confirm.kind === 'cat') await quickReplyService.deleteCategory(confirm.id); else await quickReplyService.deleteReply(confirm.id); await load(); }
      catch (e) { console.error(e); } finally { setBusy(false); }
    } else if (confirm.act === 'addCat') { await doAddCategory(); }
    else if (confirm.act === 'addReply') { await doAddReply(); }
    setConfirm(null);
  };

  const compact = variant === 'panel';

  return (
    /* [FIX-20260830-TRAYFULLINNER] ตอนเต็มจอต้องเป็น flex column และสูงเต็มพ่อ
       ไม่งั้น `flex-1` ของรายการข้างในไม่มีอะไรให้ยืด */
    <div className={full ? 'w-full flex flex-col h-full min-h-0' : 'w-full'}>
      {/* category tab strip + add */}
      <div className="flex flex-wrap gap-1.5 items-center mb-2">
        {cats.map(c => {
          const on = c._id === activeCat;
          return editCatId === c._id ? (
            <span key={c._id} className="inline-flex items-center gap-1">
              <input value={editCatName} onChange={e => setEditCatName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveCategory(c._id)}
                className="text-xs px-2 py-1 rounded border bg-transparent outline-none w-24" autoFocus />
              <button onClick={() => saveCategory(c._id)} className="text-emerald-600 p-0.5" title={t('common.save', 'บันทึก')}><Check size={13} /></button>
              <button onClick={() => setEditCatId(null)} className="text-gray-400 p-0.5" title={t('common.cancel', 'ยกเลิก')}><X size={13} /></button>
            </span>
          ) : (
            <span key={c._id} className={`group inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-bold border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-blue-50'}`}>
              <button onClick={() => setActiveCat(c._id)}>{c.name}</button>
              {canManage && (
                <>
                  <button onClick={() => { setEditCatId(c._id); setEditCatName(c.name); }} className={`p-0.5 rounded hover:bg-black/10 ${on ? 'text-white/80' : 'text-gray-400'}`} title={t('ticketui.qr.rename_cat', 'แก้ชื่อหมวด')}><Pencil size={10} /></button>
                  <button onClick={() => setConfirm({ act: 'delete', kind: 'cat', id: c._id, label: c.name })} className={`p-0.5 rounded hover:bg-black/10 ${on ? 'text-white/80' : 'text-gray-400'}`} title={t('ticketui.qr.delete_cat', 'ลบหมวด')}><Trash2 size={10} /></button>
                </>
              )}
            </span>
          );
        })}
        {/* add category */}
        <span className="inline-flex items-center gap-1">
          <input value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCategory()}
            placeholder={t('ticketui.qr.new_cat', '+ หมวดใหม่')} className="text-xs px-2 py-1 rounded border bg-transparent outline-none w-24 focus:border-primary" />
          {newCatName.trim() && <button onClick={addCategory} className="text-primary p-0.5" title={t('ticketui.qr.add_cat', 'เพิ่มหมวด')}><FolderPlus size={14} /></button>}
        </span>
      </div>

      {/* replies of the active category */}
      {/* [FIX-20260830-TRAYFULLINNER] เต็มจอ = ยืดเต็มพื้นที่ที่เหลือ ไม่ใช่ cap เป็น vh
          `flex-1 min-h-0` คือคู่ที่ทำให้กล่องลูกใน flex column ยืดได้และยอมหด
          (ขาด min-h-0 แล้ว overflow จะไม่ทำงานเลยใน flexbox) */}
      {/* ==== [FIX-20260830-QRSINGLESCROLL] one scrollbar, the outer one ====
          Owner, 30/08: *"ตอบด่วน scroll เบิ้ล ข้างในไม่ต้องมี มีตัวนอกพอ"* — plus
          *"แต่ต้อง wrap ข้างนอกให้ดี"*.

          🔴 the cause: in `variant="panel"` this list carried
          `overflow-y-auto` + `max-h-[46vh]` while the tray wrapper around it
          (TicketChat.tsx, the quick-reply panel) carried its own
          `overflow-y-auto`. Two nested scroll regions, one inside the other, so
          the point round drove whichever the pointer happened to be over and the panel
          felt stuck or jumped between them.

          ⇒ in the PANEL variant this list no longer scrolls at all: no
          `overflow-*`, no `max-h-*`. It renders at its natural height and the
          tray wrapper — which already has the ceiling (`tc-tray-cap`, and
          `max-h-[46vh]` before it) and `overflow-y-auto` — is the single scroll
          container. That is the "wrap ข้างนอกให้ดี" half: the outer box has a
          definite bounded height to scroll within, so dropping the inner scroller
          cannot make the tray grow without limit.

          ⚠️ `variant="modal"` is deliberately UNCHANGED and keeps
          `max-h-[60vh] overflow-y-auto`. Its wrapper (the gear dialog in
          TicketChat) is a different box with its own scroll region, and the modal
          is not part of the composer height chain — removing the cap there would
          let the dialog's body grow past its own `max-h-[92vh]` shell.
          The `full` branch is likewise untouched: it is the fullscreen tray,
          where this list IS the intended scroller because the wrapper gives up
          every cap to let the tray own the column. */}
      <div className={`space-y-1.5 ${full ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar' : compact ? '' : 'max-h-[60vh] overflow-y-auto custom-scrollbar'}`}>
        {loading ? (
          <div className="text-center text-xs text-gray-400 py-4"><Loader2 size={16} className="animate-spin inline mr-1" /> {t('webhook_logs.loading', 'กำลังโหลด...')}</div>
        ) : !current ? (
          <div className="text-center text-xs text-gray-400 py-4 italic">{t('ticketui.qr.no_cats', 'ยังไม่มีหมวด — สร้างหมวดใหม่ก่อน')}</div>
        ) : (
          <>
            {current.replies.length === 0 && <div className="text-center text-xs text-gray-400 py-3 italic">{t('ticketui.qr.no_replies', 'ยังไม่มีข้อความในหมวดนี้')}</div>}
            {current.replies.map(r => (
              <div key={r._id} className="group border border-gray-200 rounded-lg p-2 bg-white hover:border-blue-200 transition-colors">
                {editReplyId === r._id ? (
                  <div className="flex flex-col gap-1.5">
                    <textarea value={editReplyText} onChange={e => setEditReplyText(e.target.value)} className="w-full border border-primary rounded p-2 text-xs outline-none resize-none h-16" autoFocus />
                    <div className="flex gap-1.5">
                      <button onClick={() => setEditReplyId(null)} className="flex-1 py-1 text-[11px] font-bold text-gray-600 bg-gray-100 rounded">{t('common.cancel', 'ยกเลิก')}</button>
                      <button onClick={() => saveReply(r._id)} className="flex-1 py-1 text-[11px] font-bold text-white bg-emerald-600 rounded flex items-center justify-center gap-1"><Save size={11} /> {t('common.save', 'บันทึก')}</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    {/* In the composer panel, clicking anywhere on the row text picks
                        it (fills the draft, not sent). The edit/delete buttons stop
                        propagation so they still work. */}
                    <p
                      className={`text-xs text-gray-700 leading-relaxed whitespace-pre-wrap break-words flex-1 ${compact && onPick ? 'cursor-pointer' : ''}`}
                      onClick={compact && onPick ? () => onPick(r.text) : undefined}
                      title={compact && onPick ? t('ticketui.qr.fill_box', 'เติมลงกล่อง (ไม่ส่ง)') : undefined}
                    >{r.text}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      {compact && onPick && (
                        <button onClick={() => onPick(r.text)} className="text-xs font-bold text-primary bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-md active:scale-95 transition-transform" title={t('ticketui.qr.fill_box', 'เติมลงกล่อง (ไม่ส่ง)')}>{t('ticketui.qr.pick', 'เลือก')}</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setEditReplyId(r._id); setEditReplyText(r.text); }} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity" title={t('common.edit', 'แก้ไข')}><Pencil size={16} /></button>
                      <button onClick={(e) => { e.stopPropagation(); setConfirm({ act: 'delete', kind: 'reply', id: r._id, label: r.text.slice(0, 20) }); }} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title={t('ticketui.common.delete', 'ลบ')}><Trash2 size={16} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {/* add reply to active category — nowrap so the เพิ่ม button never wraps
                under the textarea, and pb-2 so it isn't flush against the scroll
                container's bottom edge. */}
            {current && (
              <div className="flex flex-nowrap items-end gap-1.5 pt-1 pb-2">
                <textarea value={newReplyText} onChange={e => setNewReplyText(e.target.value)} placeholder={t('ticketui.qr.add_reply_ph', 'เพิ่มข้อความในหมวดนี้...')}
                  className="flex-1 min-w-0 border border-gray-300 rounded p-2 text-xs outline-none focus:border-primary resize-none h-14 bg-gray-50" />
                <button onClick={addReply} disabled={!newReplyText.trim() || busy} className="shrink-0 bg-gray-800 hover:bg-black text-white text-[11px] font-bold px-3 py-2 rounded flex items-center gap-1 disabled:opacity-40"><Plus size={12} /> {t('ticketui.common.add', 'เพิ่ม')}</button>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={doConfirm}
        closeOnConfirm={false}
        type={confirm?.act === 'delete' ? 'danger' : 'info'}
        title={
          confirm?.act === 'addCat' ? t('ticketui.qr.confirm_add_cat', 'ยืนยันเพิ่มหมวด')
          : confirm?.act === 'addReply' ? t('ticketui.qr.confirm_add_reply', 'ยืนยันเพิ่มข้อความ')
          : confirm?.act === 'delete' && confirm.kind === 'cat' ? t('ticketui.qr.confirm_del_cat', 'ยืนยันลบหมวด')
          : t('ticketui.qr.confirm_del_reply', 'ยืนยันลบข้อความ')
        }
        message={
          confirm?.act === 'addCat' ? withVars(t('ticketui.qr.msg_add_cat', 'เพิ่มหมวด "{label}" ใช่หรือไม่?'), { label: confirm.label })
          : confirm?.act === 'addReply' ? withVars(t('ticketui.qr.msg_add_reply', 'เพิ่มข้อความ "{label}..." ในหมวดนี้ใช่หรือไม่?'), { label: confirm.label })
          : confirm?.act === 'delete' && confirm.kind === 'cat' ? withVars(t('ticketui.qr.msg_del_cat', 'ลบหมวด "{label}" และข้อความทั้งหมดในหมวด (soft delete)?'), { label: confirm.label })
          : confirm?.act === 'delete' ? withVars(t('ticketui.qr.msg_del_reply', 'ลบข้อความ "{label}..." (soft delete)?'), { label: confirm.label })
          : ''
        }
        confirmLabel={busy ? t('ticketui.common.working', 'กำลังทำ…') : confirm?.act === 'delete' ? t('ticketui.common.delete', 'ลบ') : t('ticketui.common.add', 'เพิ่ม')}
      />
    </div>
  );
};
