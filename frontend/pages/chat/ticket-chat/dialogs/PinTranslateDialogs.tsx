/**
 * [REFACTOR-20261027-TCSPLIT] Pin-cap alert, translate-failed alert and the unpin confirm.
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * revert: paste the body back where `<PinTranslateDialogs />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
import { AlertModal, ConfirmModal } from '../../../../components/modals';
import { PIN_MAX } from '../../../../services/chat';
import type { TFn } from '../types';

export type PinTranslateDialogsProps = {
  pinLimitAlert: boolean;
  setPinLimitAlert: React.Dispatch<React.SetStateAction<boolean>>;
  t: TFn;
  translateAlert: string;
  setTranslateAlert: React.Dispatch<React.SetStateAction<string>>;
  unpinTarget: { key: string; name: string; when: string; };
  setUnpinTarget: React.Dispatch<React.SetStateAction<{ key: string; name: string; when: string; }>>;
  confirmUnpin: () => void;
};

export const PinTranslateDialogs: React.FC<PinTranslateDialogsProps> = ({
  pinLimitAlert,
  setPinLimitAlert,
  t,
  translateAlert,
  setTranslateAlert,
  unpinTarget,
  setUnpinTarget,
  confirmUnpin,
}) => (
  <>
    {/* [FEAT-20260811-CHATPIN] เตือนตอนหมุดเต็มเพดาน — เจ้าของสั่ง "max 20 ต้องเตือน"
        ใช้ `AlertModal` ตัวเดียวกับที่หน้านี้ใช้อยู่แล้ว (ห้ามถอยไปใช้ `alert()` ดิบ —
        มีคอมเมนต์บันทึกไว้ว่าเคยเปลี่ยนมาเพราะ alert อ่านไม่รู้เรื่อง)
        ข้อความบอก **ทางออก** ไม่ใช่แค่บอกว่าเต็ม
        ⚠️ ต้องอยู่ใน component นี้ ไม่ใช่ `ChatInputBox` — state `pinLimitAlert`
           ประกาศที่ `:651` ถ้าวางผิด component จะ compile ไม่ผ่าน (เจอมาแล้ว) */}
    <AlertModal
      isOpen={pinLimitAlert}
      onClose={() => setPinLimitAlert(false)}
      title={t('ticketui.pin.full_title', 'ปักหมุดเต็มแล้ว')}
      type="warning"
      message={t('ticketui.pin.full_msg', 'ปักหมุดได้สูงสุด {max} ห้อง — เอาหมุดที่ไม่ใช้แล้วออกก่อนถ้าจะปักเพิ่ม', { max: PIN_MAX })}
    />

    {/* [FEAT-20260908-AITRANSLATE] แปลข้อความไม่สำเร็จ.
        🔴 `message` is the SERVER's sentence, printed as it arrived. A 429
        says how many presses are left and when the window turns over; a 502
        says this OA has no usable key. Replacing either with a friendlier
        in-house string hides the only actionable part of the message — §4C
        says so for the composer and the same reasoning holds here.
        ⚠️ Closing it does NOT retry. There is no auto-retry anywhere in this
           feature: the next request happens only because a human pressed the
           chip again. */}
    <AlertModal
      isOpen={!!translateAlert}
      onClose={() => setTranslateAlert(null)}
      title={t('ticketui.translate_failed', 'แปลข้อความไม่สำเร็จ')}
      type="warning"
      message={translateAlert || ''}
    />

    {/* [FEAT-20260811-CHATPIN] ยืนยันก่อนเอาหมุดออก — เจ้าของสั่ง "ขอ remove pin confirm
        + modal บอกชื่อ วันเวลา ticket"
        บอก **ชื่อลูกค้า + วันเวลาเคส** เพื่อให้รู้ว่ากำลังปลดอันไหน ไม่ใช่ถามลอย ๆ
        ใช้ `ConfirmModal` ตัวเดียวกับยืนยันรับ/ปิดเคส (`:2915`) ⇒ หน้าตาเข้าชุดกัน
        ⚠️ ยืนยันเฉพาะการเอาออก · การปักไม่ถาม (กดผิดก็กดออกได้ ไม่เสียอะไร) */}
    <ConfirmModal
      isOpen={!!unpinTarget}
      onClose={() => setUnpinTarget(null)}
      onConfirm={confirmUnpin}
      title={t('ticketui.pin.remove', 'เอาหมุดออก')}
      type="warning"
      confirmLabel={t('ticketui.pin.remove', 'เอาหมุดออก')}
      message={t('ticketui.pin.unpin_msg', 'เอาหมุดของ {name} ออกจากด้านบนใช่หรือไม่?\nเคสล่าสุด: {when}', { name: unpinTarget?.name || '-', when: unpinTarget?.when || '-' })}
    />
  </>
);
