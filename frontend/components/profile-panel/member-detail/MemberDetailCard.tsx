/**
 * [FEAT-20260729-MEMBERDETAIL] The panel's hand-typed customer card ("ข้อมูลชั่วคราว").
 *
 * Moved verbatim from `ProfilePanel.tsx` on 15/10/2026 (commit "the hand-typed customer card
 * moves to its own module"), then given the provider's rule ([FEAT-20261015-MEMBERDETAIL]):
 * `rule` null (shop-api) ⇒ today's card byte for byte (snapshot-pinned); a rule (loan) ⇒
 * nickname for everyone + name/phone/contract while unregistered — see `memberDetailLayout.ts`.
 * The "when to render" decision lives in `showMemberDetailCard`, called by `PersonalPanelNarrow`.
 *
 * revert (rule only): drop `rule`/`registered` and the nickname lines tagged MEMBERDETAIL-2026;
 * revert (move): paste the block back into ProfilePanel.tsx above `[FEAT-20260729-OANAME]`.
 */
import React, { useEffect, useState } from 'react';
import { ChevronDown, Pencil, X } from 'lucide-react';

import { ticketService } from '../../../services/chat';
import { parseCustomerDetail } from '../../common';
import type { MemberDetailRule } from '../../../services/chat/providerMemberDetail';
import type { MemberPanelSource } from '../ProfilePanel';
import { LAYOUT_COPY_KEYS, memberDetailLayout, NICKNAME_EMPTY, NICKNAME_FIELD } from './memberDetailLayout';
import { useI18n } from '../../../i18n';

// ==== [FEAT-20260729-MEMBERDETAIL] START — กล่อง "ข้อมูลทั่วไป" (แก้เองได้)
// 🔒 สาย AUTO — to_dev_auto เท่านั้น
//
// เก็บลง `Member.detail` เป็นสตริงคั่น "|" 3 ช่อง — รูปแบบเดียวกับเส้น acme
// ที่ใช้อยู่แล้ว (ดู parseCustomerDetail ด้านบน + getCustomerDisplayName ที่อ่าน
// parts[0]/parts[1] เป็น fallback) → กรอกที่นี่แล้วชื่อ/เบอร์ไปโผล่ในลิสต์ตั๋วด้วย
//
// ใช้ endpoint เดิม PATCH /api/line-users/:id/detail (ticketService.patchDetail)
// ไม่เพิ่ม schema · ไม่เพิ่ม route · ไม่แตะ BE เลย
//
// revert: ลบคอมโพเนนต์นี้ + จุดเรียกใน PersonalPanelNarrow
export const MemberDetailCard: React.FC<{
  source: MemberPanelSource;
  /* [FEAT-20261015-MEMBERDETAIL] the provider's rule (null = today's card) and its
     "the partner knows this customer" verdict (`has_member_data`) */
  rule?: MemberDetailRule | null;
  registered?: boolean;
}> = ({ source, rule = null, registered = false }) => {
  // [FEAT-20260801-CONTACTTABS] ชื่อเดิมที่โค้ดข้างล่างใช้ — ตั้ง alias บรรทัดเดียว
  // แทนการไล่แก้ทุกจุด เพื่อให้เนื้อในเป็น "ของเดิมเป๊ะ" ตรวจ diff ได้ง่าย
  const ticket = source;
  const memberId = ticket.line_user_data?._id || null;
  const initial = parseCustomerDetail(ticket.line_user_data?.detail);
  const layout = memberDetailLayout(rule, registered);
  const { t } = useI18n();
  /* the layout's fixed Thai copy → the UI language (LAYOUT_COPY_KEYS) */
  const tr = (s: string): string => (LAYOUT_COPY_KEYS[s] ? t(LAYOUT_COPY_KEYS[s], s) : s);
  /* [FEAT-20261015-MEMBERDETAIL] nickname — its own field and route (PATCH …/nickname) */
  const initialNick: string = ticket.line_user_data?.nickname || '';

  const [form, setForm] = useState(initial);
  const [nick, setNick] = useState(initialNick);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // [FEAT-20260729-TMPEDIT] second step before writing — the value also shows up
  // in the ticket list, so an accidental save is visible well beyond this card
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');
  // ==== [FEAT-20260729-TMPEDIT2] START — ต้องกดดินสอก่อนถึงจะพิมพ์ได้
  // เดิมช่องเปิดให้พิมพ์ตลอดเวลา — เผลอคลิกโดนแล้วพิมพ์ทับได้ทันที
  // ตอนนี้เป็น read-only จนกว่าจะกดดินสอข้างหัวข้อ แล้วค่อยกดบันทึก (+ confirm)
  // revert: ลบ state นี้ + ปุ่มดินสอ + `readOnly={!editing}` และเงื่อนไข disabled
  const [editing, setEditing] = useState(false);
  // ยกเลิก = คืนค่าเดิม ไม่ทิ้งค่าที่พิมพ์ค้างไว้ให้สับสน
  const cancelEdit = () => { setForm(initial); setNick(initialNick); setEditing(false); setConfirming(false); setErr(''); };
  // พับ/กางการ์ด — panel ขวายาวมาก การ์ดนี้กินที่ 3 ช่อง พับเก็บได้เมื่อไม่ใช้
  // [FIX-20260801-CARDCOLLAPSE] แท็บ "ข้อมูลส่วนตัว" ย่อทุกใบเป็นค่าเริ่มต้น
  //   (เหลือ "รอทำรายการ" กางใบเดียว) — การ์ดนี้จึงเริ่มแบบย่อ
  // revert: useState(true)
  const [open, setOpen] = useState(false);
  // ==== [FEAT-20260729-TMPEDIT2] END

  // เปลี่ยนตั๋ว/ลูกค้า → โหลดค่าของคนใหม่ (ไม่งั้นค้างค่าเดิมของคนก่อนหน้า)
  useEffect(() => {
    setForm(parseCustomerDetail(ticket.line_user_data?.detail));
    setNick(ticket.line_user_data?.nickname || '');
    setSaved(false);
    setErr('');
    // [FEAT-20260729-TMPEDIT] drop a half-finished confirm when the customer
    // changes — otherwise the prompt carries over and the next click would save
    // the new customer's form against a decision made about someone else
    setConfirming(false);
    // [FEAT-20260729-TMPEDIT2] ปิดโหมดแก้ไขด้วย — ไม่งั้นสลับลูกค้าแล้วช่องยัง
    // เปิดค้าง เสี่ยงพิมพ์ทับข้อมูลคนใหม่โดยไม่ตั้งใจ
    setEditing(false);
    // [FEAT-20261015-MEMBERDETAIL] the nickname joins the deps only where the card shows it —
    // shop-api's card resets on exactly what it reset on before
  }, [memberId, ticket.line_user_data?.detail, layout.nickname ? initialNick : null]);

  /* [FEAT-20261015-MEMBERDETAIL] each half is written only when it is on the card AND changed —
     shop-api: detail only, as before · loan registered: nickname only (the partner's data is
     never overwritten from here) */
  const detailDirty = layout.detailFields.length > 0 &&
    (form.name !== initial.name || form.phone !== initial.phone || form.contract !== initial.contract);
  const nickDirty = layout.nickname && nick !== initialNick;
  const dirty = detailDirty || nickDirty;

  const save = async () => {
    if (!memberId || saving) return;
    const nickname = nick.trim();
    // the back end refuses an empty nickname — say so here instead of a 400
    if (nickDirty && !nickname) { setErr(tr(NICKNAME_EMPTY)); return; }
    setSaving(true); setErr(''); setSaved(false);
    try {
      if (nickDirty) {
        await ticketService.patchNickname(memberId, nickname);
        if (ticket.line_user_data) (ticket.line_user_data as any).nickname = nickname;
        setNick(nickname);
      }
      if (detailDirty) {
        // เก็บรูปเดิมเป๊ะ: "ชื่อ|เบอร์|เลขสัญญา" (ช่องว่างก็ยังคงตำแหน่งไว้)
        await ticketService.patchDetail(memberId, `${form.name}|${form.phone}|${form.contract}`);
        if (ticket.line_user_data) {
          (ticket.line_user_data as any).detail = `${form.name}|${form.phone}|${form.contract}`;
        }
      }
      setSaved(true);
      // [FEAT-20260729-TMPEDIT2] บันทึกแล้วกลับไปโหมดอ่านอย่างเดียว
      setEditing(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setErr(e?.message || t('common.save_error', 'บันทึกไม่สำเร็จ'));
    } finally {
      setSaving(false);
    }
  };

  /* [FEAT-20261015-MEMBERDETAIL] the fields come from the layout (shop-api: today's three, the
     `[FEAT-20260729-TMPEDIT2]` labels now live in memberDetailLayout.ts); the nickname, when
     on, goes first — one markup for every field */
  const fields = [
    ...(layout.nickname ? [{ key: 'nickname' as const, ...NICKNAME_FIELD }] : []),
    ...layout.detailFields,
  ];
  const valueOf = (k: (typeof fields)[number]['key']) => (k === 'nickname' ? nick : form[k]);
  const setValue = (k: (typeof fields)[number]['key'], v: string) =>
    k === 'nickname' ? setNick(v) : setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      {/* [FEAT-20260729-TMPEDIT2] หัวการ์ด: ตัดข้อความ "แก้ไขข้อมูลชั่วคราว" ออก
          ทั้งหมดตามที่สั่ง เหลือไอคอนล้วน — ดินสอ = เปิดให้พิมพ์, ลูกศร = พับ/กาง
          คลิกที่หัวข้อก็พับได้ (พื้นที่กดใหญ่กว่าไอคอน)
          revert: คืน <span>แก้ไขข้อมูลชั่วคราว</span> แล้วลบปุ่มทั้งสอง */}
      {/* [FIX-20260802-PANELHEADER] กดตรงไหนของ header ก็พับ/กางได้ (เดิมกดได้แค่ตัวหนังสือ)
          + select-none กันไฮไลต์เทาตอนกดซ้ำ ๆ · ปุ่มข้างในต้อง stopPropagation ไม่งั้นพับตาม
          revert: ย้าย onClick กลับไปที่ <button> รอบ label แล้วลบ select-none/stopPropagation */}
      <div
        onClick={() => setOpen(o => !o)}
        className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2 cursor-pointer select-none hover:bg-gray-50 transition-colors"
        title={open ? t('common.collapse', 'ย่อ') : t('common.expand', 'ขยาย')}
      >
        <div className="flex items-center gap-1 min-w-0 text-left">
          <ChevronDown
            size={13}
            className={`shrink-0 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`}
          />
          {/* [FEAT-20260729-TMPEDIT2] "ข้อมูลทั่วไป" → "ข้อมูลชั่วคราว" — ชื่อการ์ด
              บอกไปเลยว่าข้อมูลชุดนี้เป็นของชั่วคราว (ไม่ใช่ของจริงจากปลายทาง)
              จึงไม่ต้องมีข้อความกำกับซ้ำอีกฝั่ง */}
          <span className="text-xs font-bold text-gray-700 truncate">{tr(layout.title)}</span>
        </div>
        {open && (!editing ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEditing(true); setSaved(false); setErr(''); }}
            disabled={!memberId}
            title={t('common.edit', 'แก้ไข')}
            className="shrink-0 p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Pencil size={13} />
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
            disabled={saving}
            title={t('common.cancel', 'ยกเลิก')}
            className="shrink-0 p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
          >
            <X size={13} />
          </button>
        ))}
      </div>
      {open && (
      <div className="p-3 space-y-2">
        {fields.map(f => (
          <div key={f.key}>
            <label className="block text-[11px] text-gray-500 mb-1">{tr(f.label)}</label>
            {/* [FEAT-20260729-TMPEDIT2] readOnly จนกว่าจะกดดินสอ — พื้นเทาจาง ๆ
                ตอนอ่านอย่างเดียว ให้ต่างจากตอนแก้ไขได้อย่างชัดเจน
                revert: ลบ readOnly + คลาสเงื่อนไข เหลือคลาสเดิมบรรทัดเดียว */}
            <input
              type="text"
              value={valueOf(f.key)}
              placeholder={tr(f.ph)}
              // readOnly กัน "พิมพ์ทับ" · disabled กัน focus/คลิกเข้าไปได้เลย
              // (readOnly อย่างเดียวยังโฟกัสได้ ทำให้ดูเหมือนพิมพ์ได้)
              readOnly={!editing}
              disabled={!editing}
              tabIndex={editing ? 0 : -1}
              onChange={e => editing && setValue(f.key, e.target.value)}
              className={`w-full px-2 py-1.5 text-[13px] border rounded focus:outline-none transition-colors ${
                editing
                  ? 'border-blue-300 bg-white focus:border-primary'
                  : 'border-gray-200 bg-gray-50 text-gray-600 cursor-default select-text'
              }`}
            />
          </div>
        ))}
        {layout.note && <p className="text-[11px] text-gray-500 italic">{tr(layout.note)}</p>}

        {err && <p className="text-[11px] text-red-500">{err}</p>}
        {saved && !editing && <p className="text-[11px] text-emerald-600 font-semibold">✓ {t('ticketui.panel.saved', 'บันทึกแล้ว')}</p>}

        {/* [FEAT-20260729-TMPEDIT] ปุ่มเดิมเป็น bg-primary (เขียว LINE) บนพื้นขาว
            บวก opacity-40 ตอน disabled → แทบมองไม่เห็นว่ามีปุ่มอยู่ เปลี่ยนเป็นน้ำเงิน
            แบบเดียวกับปุ่มส่ง และตอนแก้แล้วให้ ring เรืองขึ้นมาว่ากดได้
            + ยืนยันอีกชั้นก่อนเขียนทับ เพราะค่านี้ไปโผล่ในลิสต์ตั๋วด้วย
            [FEAT-20260729-TMPEDIT2] ปุ่มโผล่เฉพาะตอนกดดินสอแล้ว (โหมดอ่านอย่างเดียว
            ไม่ต้องมีปุ่มบันทึกให้เกะกะ) + สีทึบขึ้นตอนกดได้จริง / เทาชัดตอนกดไม่ได้
            แทน opacity ที่ทำให้ตัวหนังสือเบลอ
            revert: คืนปุ่มเดิม + ลบ confirm state + ลบ `editing &&` */}
        {editing && (confirming ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-amber-600">{tr(layout.confirmText)}</p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={saving}
                className="flex-1 py-1.5 text-xs font-bold rounded border border-gray-200 text-gray-600 disabled:opacity-50"
              >
                {t('common.cancel', 'ยกเลิก')}
              </button>
              <button
                type="button"
                onClick={() => { setConfirming(false); save(); }}
                disabled={saving}
                className="flex-1 py-1.5 text-xs font-bold rounded bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50"
              >
                {saving ? t('ticketui.panel.saving', 'กำลังบันทึก…') : t('common.confirm', 'ยืนยัน')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!memberId || saving || !dirty}
            className={`w-full py-1.5 text-xs font-bold rounded transition-colors ${
              dirty && memberId && !saving
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            }`}
          >
            {dirty ? t('common.save', 'บันทึก') : t('ticketui.panel.no_changes', 'ยังไม่มีการแก้ไข')}
          </button>
        ))}
      </div>
      )}
    </div>
  );
};
// ==== [FEAT-20260729-MEMBERDETAIL] END
