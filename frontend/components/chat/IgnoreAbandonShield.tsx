/**
 * ==== [FEAT-20260821-ABANDONSHIELD] โล่บน avatar — ปิด/เปิดระบบช่วยเหลือลงทะเบียน ====
 *
 * เจ้าของสั่ง (20/08/2026) คำต่อคำ:
 *   `ignore_abandon_assist = false` = default ของทุกคน > **โล่สีเงินขอบสีเขียวทุกคน
 *   ขวาล่าง มีเฉพาะ avatar ฝั่งขวาของ panel ticket support สามารถคลิกแล้วเลือกได้**
 *   // ถ้า `true` เป็น**รูปโล่สีเทาจาง ๆ** แทน
 *   // กดแล้วมี **modal ถาม (แปล eng/th)** ข้อความสลับตามสถานะ
 *   > **audit log เซฟด้วย** + โล่อัปเดตตามสถานะในหน้าจอที่กด
 *
 * ## ⚠️ โล่แสดง "ทุกคน" ไม่ใช่เฉพาะตอนปิด
 * รอบแรกทำเป็น badge ที่โผล่เฉพาะตอน `true` ⇒ สถานะปกติไม่เห็นอะไรเลย และ
 * แอดมินไม่มีทางกดเปลี่ยนได้เพราะไม่มีอะไรให้กด **ผิดโจทย์** · เจ้าของทัก 21/08
 * ว่า *"โล่หายไปไหน"* ⇒ ตัวนี้แสดงเสมอ เขียว = ตามปกติ · เทาจาง = ปิดอยู่
 *
 * ## ⚠️ อ่านค่าด้วย `=== true` เท่านั้น
 * แถว member ที่มีก่อน column นี้อ่านได้ `undefined` ⇒ `!== false` จะทำให้ทุกคน
 * กลายเป็น "ปิดอยู่" ทันที · ตรรกะอยู่ใน `isAbandonShieldOff` ที่เดียว
 *
 * ## ⚠️ ห้ามแตะ ring ของ avatar
 * `avatarRingClass` เข้ารหัส orphan-room อยู่แล้ว และ
 * `test/orphanRooms.value.test.ts:200-207` assert สตริงนั้นแบบเป๊ะ
 * ⇒ โล่เป็น element แยกวางทับด้วย `absolute` ใน `<div className="relative">`
 * ที่ครอบ `<img>` อยู่แล้ว **ไม่แตะบรรทัด `<img>` สักตัวอักษร**
 *
 * ## ⚠️ realtime = หน้าจอตัวเองเท่านั้น
 * เจ้าของยืนยัน 21/08: *"realtime ในหน้าตัวเองนั่นแหละ"* ⇒ `onChanged` หลัง 200
 * **ไม่มี WebSocket event ใหม่** ⇒ ไม่แตะ `useTicketWS` และจออื่นไม่รู้จนกว่าจะรีเฟรช
 *
 * ## audit เขียนที่ BE
 * `member-abandon-audit.helper.ts` บันทึกทุกครั้งที่ค่าเปลี่ยน ไม่ว่าใครเรียก route
 * ⇒ **ที่นี่ไม่ต้องยิง audit เอง** (ต่างจาก precedent `TicketSupport.tsx:1625`)
 *
 * revert: ลบไฟล์นี้ + `services/chat/ignoreAbandonService.ts` + จุดเรียกใน
 *         `TicketChat.tsx` + 6 คีย์ i18n
 */
import React, { useState } from 'react';
import { Shield, ShieldCheck, Loader2 } from 'lucide-react';

import { ConfirmModal } from '../modals';
import { ignoreAbandonService, isAbandonShieldOff } from '../../services/chat/ignoreAbandonService';

interface IgnoreAbandonShieldProps {
  /** member row ที่พาเนลถืออยู่ (`ticket.line_user_data`) */
  userData: unknown;
  /** `_id` ของ member — ไม่มี = ไม่แสดงโล่ (ห้องที่ยังไม่มี member) */
  memberId?: string | null;
  /* [D4 · ตัดสิน 21/08] ไม่มี prop `canEdit` โดยเจตนา — ทั้งหน้า `/ticket-support`
     ถูก guard ด้วย `ticket.manage` อยู่แล้วที่ `App.tsx:1202` ⇒ คนที่เห็นโล่ตัวนี้
     มีสิทธิ์แน่นอน · ส่ง flag เข้ามาอีกชั้นคือความซับซ้อนที่ไม่ได้กันอะไรเพิ่ม
     และ BE ก็เช็คซ้ำอยู่แล้ว (route ใช้ `@RequirePermissions('ticket.manage')`
     + scope ห้อง) ⇒ UI ไม่ใช่ด่าน */
  /** แจ้งหน้าจอให้อัปเดตค่าหลังเขียนสำเร็จ */
  onChanged: (next: boolean) => void;
  t: (key: string) => string;
}

export const IgnoreAbandonShield: React.FC<IgnoreAbandonShieldProps> = ({
  userData, memberId, onChanged, t,
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // D6 — ไม่มี member ก็ไม่มีอะไรให้ตั้งค่า
  if (!memberId) return null;

  const isOff = isAbandonShieldOff(userData);
  const next = !isOff;

  /* ข้อความสลับตามสถานะ ตามที่สั่ง: ปิดอยู่ → ถามว่าจะเปิดไหม · ตามอยู่ → ถามว่าจะปิดไหม */
  const title = isOff ? t('ticket.abandon_shield_confirm_on_title')
                      : t('ticket.abandon_shield_confirm_off_title');
  const message = isOff ? t('ticket.abandon_shield_confirm_on_message')
                        : t('ticket.abandon_shield_confirm_off_message');

  const apply = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      await ignoreAbandonService.setIgnoreAbandon(memberId, next);
      onChanged(next);
    } catch {
      /* ล้มแล้วคงสถานะเดิมไว้ — ห้ามเปลี่ยนหน้าจอก่อนรู้ผล
         ไม่ปิด modal เองเพราะ ConfirmModal ปิดให้อยู่แล้วผ่าน closeOnConfirm */
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={saving}
        onClick={() => setConfirmOpen(true)}
        title={isOff ? t('ticket.abandon_shield_off') : t('ticket.abandon_shield_on')}
        aria-label={isOff ? t('ticket.abandon_shield_off') : t('ticket.abandon_shield_on')}
        data-testid="abandon-shield"
        data-state={isOff ? 'off' : 'on'}
        /* [FIX-20260830-SHIELDREACH] owner 30/08: "เยื้องขวาออกมานิดนึง มันกดยาก".
           `-right-0.5` (2px) left the badge sitting on the avatar's edge, so
           half of an already 20px target overlapped the image and the easy
           pixels were the ones that did nothing. `-right-1.5` clears the rim,
           and `w-6 h-6` brings the hit area to 24px — the smallest comfortable
           touch target — without changing the ICON size (still 11px), so it
           reads the same and only the reachable area grows. */
        className={`absolute -bottom-1 -right-1.5 w-6 h-6 rounded-full flex items-center justify-center
          border shadow-sm transition-colors
          ${isOff
            ? 'bg-slate-100 border-slate-200 text-slate-400'
            : 'bg-slate-50 border-emerald-400 text-emerald-500'}
          cursor-pointer hover:brightness-95`}
      >
        {saving
          ? <Loader2 size={11} className="animate-spin" />
          : isOff
            ? <Shield size={11} />
            : <ShieldCheck size={11} />}
      </button>

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { void apply(); }}
        title={title}
        message={message}
      />
    </>
  );
};
