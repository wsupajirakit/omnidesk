import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../../../i18n';

/**
 * [UI-20260825-SENDCONSENT] สิ่งที่ต้องอ่านและติ๊ก ก่อนจะกดบันทึกงานส่งได้
 * ===========================================================================
 * เจ้าของ 25/08: *"ใน modal confirm ต้องมี check box ทุกงาน boardcast ทุกงาน
 * multicast ยืนยันก่อนค่อยกด submit"* และ *"ถ้าพยายามกดโดยไม่ check box เด้ง
 * check box แดง ๆ ให้ยืนยัน"*
 *
 * ── ทำไมต้องมีคำเตือนสีส้ม และทำไมมีสองแบบ ────────────────────────────────
 * งานที่เลือกผู้รับด้วย "ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน" จะไป**เปลี่ยน
 * สถานะของลูกค้า** ไม่ใช่แค่ส่งข้อความ และเปลี่ยนคนละแบบตามช่องติ๊ก:
 *
 *   ติ๊ก "เปิดเคส"    → ฝั่งรันเปิดเคสให้ทุกคนที่ยิงถึง **ทันทีที่ส่ง**
 *                       (`broadcast-follow-up/open-direct-ticket-on-multicast.ts`)
 *   ไม่ติ๊ก           → ฝั่งรันติดธง `abandon_trigger_at` ให้ทุกคนที่ยิงถึง ⇒
 *                       **ข้อความถัดไปที่ลูกค้าทักมา** จะถูกเปิดเคสทันที
 *                       (`broadcast-follow-up/stamp-abandon-on-multicast.ts`)
 *
 * 🔴 คำเตือนนี้จึงไม่ใช่ข้อความสวยงาม มันคือคำอธิบายพฤติกรรมจริงของ BE สองก้อน
 *    นั้น · แก้พฤติกรรมฝั่งนั้นเมื่อไหร่ ต้องมาแก้ข้อความตรงนี้ด้วย ไม่งั้นหน้าจอ
 *    จะโกหก · `test/broadcastSendConsent.test.tsx` ผูกสองฝั่งนี้ไว้ด้วยกัน
 * ⚠️ ไม่เข้าเงื่อนไขการ์ด = **ไม่มีคำเตือน** เหลือแค่ช่องติ๊กยืนยัน ตามที่สั่ง
 *    ("ถ้าไม่ตรงสองเงื่อนไขนี้ไม่ต้องมี warning")
 *
 * revert: ลบไฟล์นี้ + บล็อกที่เรียกมันใน `BroadcastFormModal.tsx` + คีย์ i18n
 */

/** คีย์ตัวกรองที่ทำให้งานใบนี้ไปเปลี่ยนสถานะลูกค้า ไม่ใช่แค่ส่งข้อความ */
export const CARD_RULE_KEY = 'follow_up.customer_helper_at';

export interface BroadcastSendConsentProps {
  /** กฎเลือกผู้รับของงานใบนี้ (อาจไม่มีเลย) */
  readonly rules?: readonly { readonly key?: string }[];
  /** ติ๊ก "เปิดเคสให้ลูกค้าที่ได้รับข้อความนี้" ไว้ไหม */
  readonly directTicket: boolean;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  /** กดยืนยันไปแล้วทั้งที่ยังไม่ติ๊ก ⇒ ต้องแดง */
  readonly missing: boolean;
}

/**
 * งานใบนี้เข้าเงื่อนไข "การ์ดลงทะเบียน" ไหม
 *
 * ⚠️ แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพื่อให้เทสได้โดยไม่ต้อง render และเพื่อให้
 *    ที่เดียวเป็นคนตอบคำถามนี้ · เทียบชื่อคีย์ตรง ๆ กับคีย์เดียวกับที่ BE ใช้
 *    (`stamp-abandon-on-multicast.ts` → TRIGGER_SOURCE_KEYS)
 */
export const usesCardRule = (
  rules?: readonly { readonly key?: string }[],
): boolean => (rules ?? []).some((r) => r?.key === CARD_RULE_KEY);

export const BroadcastSendConsent: React.FC<BroadcastSendConsentProps> = ({
  rules,
  directTicket,
  checked,
  onChange,
  missing,
}) => {
  const { t } = useI18n();
  const showWarning = usesCardRule(rules);

  return (
    <div className="mt-5 space-y-3 text-left">
      {showWarning && (
        <div
          data-testid="send-consent-warning"
          data-warning-kind={directTicket ? 'direct' : 'next-message'}
          className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
          <p className="text-sm leading-relaxed">
            {directTicket
              ? t('broadcast.consent_warn_direct')
              : t('broadcast.consent_warn_next_message')}
          </p>
        </div>
      )}

      <label
        data-testid="send-consent-box"
        data-consent-missing={missing ? 'yes' : 'no'}
        className={`flex cursor-pointer select-none items-start gap-2 rounded-xl border p-3 transition-colors ${
          missing
            ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
            : 'border-slate-200 dark:border-dark-700'
        }`}
      >
        <input
          type="checkbox"
          name="send_consent"
          data-testid="send-consent-input"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary-500"
        />
        <span className="text-sm font-medium">{t('broadcast.consent_label')}</span>
      </label>
    </div>
  );
};

export default BroadcastSendConsent;
