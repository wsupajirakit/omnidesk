import React from 'react';
import { Info } from 'lucide-react';
import { useI18n } from '../../../i18n';

/**
 * [UI-20260903-BCASTTAGFAMILIES] ตัวแปรตัวไหนใช้ได้บนวิธีส่งที่เลือกอยู่
 * ===========================================================================
 * เจ้าของ 03/09: *"ต้องอธิบายให้ broadcast ใช้ site rule ได้ (ไม่ใช่ profile)"*
 *
 * ── ทำไมต้องมีบล็อกนี้ ────────────────────────────────────────────────────
 * ข้อความเดิมใต้ช่อง "วิธีส่ง" เขียนว่า *"เงื่อนไขและตัวแปรรายคนใช้ได้เฉพาะ Multicast"*
 * ซึ่ง **จริง แต่ไม่ครบ** และคนอ่านเข้าใจว่า Broadcast ใช้ตัวแปรไม่ได้เลย
 * ⇒ ความจริงคือ Broadcast เติม `{{site_rules.*}}` และ `{{hook_*}}` ได้เต็ม ๆ
 *   (`send-profile.registry.ts:43` `PLAIN_TAGS`) แค่เติมค่ารายคนไม่ได้
 *
 * 🔴 บล็อกนี้ **ไม่ได้บังคับอะไรเลย** — ตัวบังคับจริงอยู่ฝั่ง BE ทั้งหมด:
 *    · การ์ดที่มี `{{profile.*}}`/`{{member.*}}` บนงาน plain ถูกปฏิเสธ 400
 *      (`broadcasts.service.ts` `[FIX-20260831-BCASTPROFILEGATE]`)
 *    · คู่ broadcast + การ์ดรายคน เป็นไปไม่ได้ตั้งแต่ตาราง
 *      (`send-matrix.registry.ts` `broadcast:personal` `allowed: false`)
 *    ⇒ แก้ไฟล์นี้ไม่ทำให้ส่งอะไรที่ BE ไม่ยอมได้ · แต่ถ้ากติกาฝั่งโน้นเปลี่ยน
 *      ต้องมาแก้ที่นี่ด้วย ไม่งั้นหน้าจอจะโกหก
 *
 * ⚠️ อ่านค่าเดียว (`sendKind`) ไม่มี state ไม่มี effect ไม่แตะ formData
 *    ⇒ แยกไฟล์ได้ตรง ๆ ตาม §6.1 และ `BroadcastFormModal.tsx` ไม่โตขึ้นเลย
 *
 * revert: ลบไฟล์นี้ + บรรทัดที่เรียกมันใน `BroadcastFormModal.tsx` + คีย์ i18n
 *   `broadcast.tag_families_*`
 */
export interface BroadcastTagFamiliesProps {
  /** `'broadcast'` | `'multicast'` | null — ค่าที่ผู้ใช้เลือกอยู่ตอนนี้ */
  readonly sendKind: string | null;
  /** `'personal'` | null — มีความหมายเฉพาะตอน multicast */
  readonly cardType: string | null;
}

export const BroadcastTagFamilies: React.FC<BroadcastTagFamiliesProps> = ({
  sendKind,
  cardType,
}) => {
  const { t } = useI18n();

  /* ยังไม่ได้เลือกวิธีส่ง = ยังไม่มีอะไรจะบอก */
  if (sendKind !== 'broadcast' && sendKind !== 'multicast') return null;

  const isBroadcast = sendKind === 'broadcast';
  /* 🔴 ค่ารายคนได้ก็ต่อเมื่อ **multicast + การ์ดรายคน** เท่านั้น — สองอย่าง
     ไม่ใช่อย่างเดียว · multicast + การ์ดธรรมดา ยังเติมค่ารายคนไม่ได้ */
  const perPerson = !isBroadcast && cardType === 'personal';

  return (
    <div
      className="mt-2 rounded-xl border border-dark-700 p-3"
      data-testid="broadcast-tag-families"
    >
      <div className="flex items-start gap-2">
        <Info size={14} className="mt-0.5 shrink-0 text-slate-700" />
        <div className="text-[11px] leading-relaxed text-slate-700">
          <p className="font-semibold">
            {t('broadcast.tag_families_title')}
          </p>
          <p data-testid="tag-families-available">
            ✅ {t('broadcast.tag_families_oa')}
          </p>
          {perPerson ? (
            <p data-testid="tag-families-person-on">
              ✅ {t('broadcast.tag_families_person_on')}
            </p>
          ) : (
            <p
              className="text-amber-700"
              data-testid="tag-families-person-off"
            >
              ✕{' '}
              {isBroadcast
                ? t('broadcast.tag_families_person_off_broadcast')
                : t('broadcast.tag_families_person_off_plain')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
