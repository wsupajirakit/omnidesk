/**
 * ==== [FEAT-20260830-TRAYFULL] modal เลือกโหมดแผงเครื่องมือ ====
 *
 * เจ้าของสั่ง 30/08/2026: กดปุ่มข้าง `ตอบ | โน้ตในแชท` แล้วเลือกสองแบบ —
 * **ค่าเริ่มต้น** หรือ **เปิดเต็มจอ** · เลือกแล้วเซฟทันที + toast ·
 * มีผลกับแผงทั้ง 3: อิโมจิ · ข้อความตอบด่วน · สติกเกอร์
 *
 * ── ทำไมเป็นรายการแนวตั้ง ไม่ใช่ปุ่มสลับซ้าย-ขวา ───────────────────────────
 * แต่ละโหมดต้องมีคำอธิบายกำกับ (ไม่งั้นชื่อโหมดอย่างเดียวเดาไม่ออกว่าต่างกันยังไง)
 * รูปแบบนี้ลอกจากการ์ด "การแสดงกลุ่ม" ที่หน้านี้ portal เข้าฟันเฟืองอยู่แล้ว
 * (TicketChat.tsx) ⇒ แอดมินเห็นรูปแบบเดียวกันทั้งหน้า
 *
 * ⚠️ ไม่ใช้ class `tc-mode-*` ของปุ่ม `ตอบ|โน้ตในแชท` ถึงแม้หน้าตาคล้ายกัน
 * เพราะ CSS ชุดนั้น scope ใต้ `.tc` (index.html) — modal นี้เป็น overlay ที่
 * ลอยอยู่ระดับหน้าจอ ถ้ายืมคลาสมาใช้จะไม่มีสไตล์เลยสักอย่าง
 *
 * revert: ลบไฟล์นี้ + ปุ่มที่เรียกใน TicketChat.tsx
 */
import React from 'react';
import { X, Check, Maximize2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import {
  CHAT_TRAY_MODES,
  normalizeChatTrayMode,
  type ChatTrayMode,
} from '../../hooks/chatTrayMode';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** ค่าปัจจุบัน — ค่าพังถูกบีบเป็น default ใน helper */
  value: unknown;
  /** เลือกแล้วเซฟทันที ผู้เรียกเด้ง toast เอง */
  onChange: (mode: ChatTrayMode) => void;
}

export const ChatTrayModeModal: React.FC<Props> = ({
  isOpen,
  onClose,
  value,
  onChange,
}) => {
  const { t } = useI18n();
  if (!isOpen) return null;

  const current = normalizeChatTrayMode(value);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Maximize2 size={18} className="text-primary-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-800">
              {t('ticket.tray_mode_title')}
            </div>
            <div className="text-[11px] text-slate-400">
              {t('ticket.tray_mode_hint')}
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

        <div className="space-y-1 p-3">
          {CHAT_TRAY_MODES.map((mode) => {
            const active = current === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onChange(mode)}
                className={`flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  active ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <span
                  className={`mt-0.5 shrink-0 ${active ? 'text-primary-600' : 'text-transparent'}`}
                >
                  <Check size={15} />
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-bold ${active ? 'text-primary-600' : 'text-slate-700'}`}
                  >
                    {t(`ticket.tray_mode_${mode}`)}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {t(`ticket.tray_mode_${mode}_desc`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ChatTrayModeModal;
