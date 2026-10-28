/**
 * ==== [FEAT-20260830-CHATFONT] modal ปรับขนาดตัวอักษรในแชท ====
 *
 * เจ้าของสั่ง 30/08/2026: กดปุ่มบนหัวแชทแล้วเปิด modal ที่มี seekbar 6 ขั้น
 * **ลากไปตรงไหนเซฟตรงนั้นทันที** พร้อม toast บอก
 *
 * ── ทำไมแยกเป็นไฟล์ ไม่เขียนใน TicketChat.tsx ──────────────────────────────
 * `TicketChat.tsx` มีกว่า 6,000 บรรทัดและติด eslint max-lines waiver อยู่แล้ว
 * ซึ่ง skill dev-local §6.1 บอกว่า waiver **ลดได้อย่างเดียว ห้ามเพิ่ม** ⇒ UI ใหม่
 * ที่เป็นก้อนของตัวเองต้องแยกไฟล์ตั้งแต่แรก ไม่ใช่ยัดเข้าไปก่อนแล้วค่อยแยกทีหลัง
 *
 * ── ทำไมไม่ใช้ ConfirmModal ────────────────────────────────────────────────
 * `ConfirmModal` มีไว้ให้ "อ่านแล้วกดยืนยัน" แต่ตัวนี้ **เซฟทันทีที่ลาก** ไม่มี
 * ขั้นยืนยัน (เจ้าของสั่ง "ลากไปตรงจุดไหนเซฟให้เลย") ⇒ ปุ่มยืนยันจะเป็นของหลอก
 * จึงใช้ overlay ของตัวเองแบบเดียวกับ modal อื่นในหน้านี้
 *
 * ⚠️ z-index: `ConfirmModal` ใช้ z-[100] และ toast ของหน้านี้ใช้ z-[110]
 * ตัวนี้จึงอยู่ที่ z-[100] เท่ากับ modal อื่น และ toast จะลอยอยู่เหนือได้ถูกต้อง
 *
 * revert: ลบไฟล์นี้ + ปุ่มที่เรียกใน TicketChat.tsx
 */
import React from 'react';
import { X, ALargeSmall } from 'lucide-react';
import { useI18n } from '../../i18n';
import {
  CHAT_FONT_SCALE_STEPS,
  chatFontScaleIndex,
  chatFontScaleAt,
  chatFontScaleLabelKey,
} from '../../hooks/chatFontScale';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** ค่าปัจจุบัน — ค่าพังหรือไม่มีจะถูกบีบเป็นขั้นที่ใช้ได้เองใน helper */
  value: unknown;
  /** เรียกทุกครั้งที่ลาก — ผู้เรียกเป็นคนเซฟและเด้ง toast */
  onChange: (scale: number) => void;
}

export const ChatFontScaleModal: React.FC<Props> = ({
  isOpen,
  onClose,
  value,
  onChange,
}) => {
  const { t } = useI18n();
  if (!isOpen) return null;

  const index = chatFontScaleIndex(value);
  const maxIndex = CHAT_FONT_SCALE_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl"
        /* กันคลิกข้างในแล้วปิด — overlay เป็นตัวปิด */
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <ALargeSmall size={18} className="text-primary-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-800">
              {t('ticket.chat_font_title')}
            </div>
            <div className="text-[11px] text-slate-400">
              {t('ticket.chat_font_hint')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5">
          {/* ตัวอย่างข้อความ — ให้เห็นผลก่อนตัดสินใจ ไม่ต้องปิด modal ไปดู */}
          <div className="mb-4 rounded-xl bg-slate-50 px-4 py-3">
            <div
              className="text-slate-700"
              style={{ fontSize: `${14 * chatFontScaleAt(index)}px` }}
            >
              {t('ticket.chat_font_title')}
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={maxIndex}
            step={1}
            value={index}
            onChange={(e) => onChange(chatFontScaleAt(Number(e.target.value)))}
            className="range-slider w-full"
            aria-label={t('ticket.chat_font_title')}
          />

          <div className="mt-2 flex justify-between text-[10px] text-slate-400">
            {CHAT_FONT_SCALE_STEPS.map((_, i) => (
              <span key={i} className={i === index ? 'font-bold text-primary-600' : ''}>
                {i + 1}
              </span>
            ))}
          </div>

          <div className="mt-3 text-center text-xs font-bold text-slate-600">
            {t(chatFontScaleLabelKey(chatFontScaleAt(index)))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatFontScaleModal;
