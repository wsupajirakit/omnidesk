/**
 * ComposerSendErrorModal.tsx — the dialog shown when a send fails: the reason
 * in words, the HTTP status and LINE reqId in their own boxes, and the raw
 * error folded away for the dev who has to chase it.
 *
 * WHAT: moved verbatim from `ChatInputBox` in `pages/chat/TicketChat.tsx`.
 *
 * WHY this is a real seam: the author drew the boundary themselves — the block
 * is bracketed `[FIX-20260728-SENDERR] START … END` and carries its own revert
 * instruction ("ลบบล็อกนี้ทั้งก้อน"). Both markers travel with it.
 *
 * ⚠️ NO STATE MOVED. `sendError` is still `useState` inside `ChatInputBox`;
 * this file receives the value and the setter under their original names, so
 * `onClose={() => setSendError(null)}` is byte-identical to what it replaced.
 *
 * Why a modal and not `alert()`: a browser alert renders as "<domain> says …",
 * cannot be copied out, and never says what actually broke. The reqId here is
 * LINE's own `x-line-request-id`, which is what you quote to LINE when their
 * side is down.
 *
 * revert: paste the block back where `<ComposerSendErrorModal …/>` is rendered
 *   in `./ChatInputBox.tsx`, drop this file and its line in `./index.ts`.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import { AlertModal } from '../../modals';
import type { SendErrorState } from './ChatInputBox.types';

export const ComposerSendErrorModal: React.FC<{
  sendError: SendErrorState | null;
  setSendError: React.Dispatch<React.SetStateAction<SendErrorState | null>>;
}> = ({ sendError, setSendError }) => {
  const { t } = useI18n(); // [FEAT-20261022-I18NTICKETEN]
  return (
  <>
      {/* ==== [FIX-20260728-SENDERR] START — modal นี้เพิ่มใหม่ทั้งหมด
           เดิมใช้ browser alert() ซึ่งขึ้นเป็น "<โดเมน> says ..." อ่านยาก
           คัดลอกไม่ได้ และไม่บอกว่าอะไรพัง · ใช้ AlertModal ของระบบแทน
           (ตัวเดียวกับที่หน้าอื่นใช้อยู่แล้ว จึงหน้าตาเข้าชุดกัน)
           revert: ลบบล็อกนี้ทั้งก้อน + เปลี่ยน showSendError กลับเป็น alert
      ==== */}
      <AlertModal
        isOpen={!!sendError}
        onClose={() => setSendError(null)}
        title={sendError?.title || t('ticketui.composer.send_failed', 'ส่งไม่สำเร็จ')}
        type="error"
        message={
          <div className="space-y-3 text-left">
            <p className="text-sm">
              {sendError?.reason || t('ticketui.composer.unknown_error', 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ')}
            </p>
            {(sendError?.status || sendError?.reqId) && (
              <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 space-y-1.5">
                {sendError?.status && (
                  <div className="flex items-start gap-2 text-xs">
                    <span className="font-semibold text-red-700 shrink-0 w-20">HTTP</span>
                    <span className="font-mono text-red-900">{sendError.status}</span>
                  </div>
                )}
                {sendError?.reqId && (
                  <div className="flex items-start gap-2 text-xs">
                    {/* reqId = x-line-request-id ของ LINE เอง ใช้แจ้ง LINE ได้ตรง ๆ */}
                    <span className="font-semibold text-red-700 shrink-0 w-20">LINE reqId</span>
                    <span className="font-mono text-red-900 break-all">{sendError.reqId}</span>
                  </div>
                )}
              </div>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700 select-none">
                {t('ticketui.composer.raw_error', 'ข้อความ error ดิบ (สำหรับส่งให้ทีมพัฒนา)')}
              </summary>
              <pre className="mt-2 p-2 rounded bg-gray-100 text-gray-700 whitespace-pre-wrap break-all font-mono text-[11px]">
                {sendError?.raw}
              </pre>
            </details>
          </div>
        }
      />
      {/* ==== [FIX-20260728-SENDERR] END */}
  </>
  );
};
