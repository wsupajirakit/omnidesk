/**
 * [FEAT-20260918-LANGSUMMARY] What step 4 will ACTUALLY send in — spelled out.
 * ============================================================================
 * Owner, 18/09: *"ตรงสีฟ้าให้แสดงออกมาเลยว่าตั้งภาษาอะไรไว้พร้อมธงด้วย ทั้งระดับห้องและ
 * ระดับ OA ถ้าไม่ตั้งหรือตั้งตาม OA ก็บอกให้ครบ"*.
 *
 * The box used to read "ใช้ภาษาของห้องแชท หรือ ภาษาหลัก OA (ตามลำดับ)" — true, and
 * useless: it describes the RULE while saying nothing about this room. An
 * operator about to switch step 4 on has one question, "what language will my
 * replies leave in", and the old text answered it with a policy.
 *
 * So all three facts are on screen, each with its flag:
 *   · ห้องแชท     — this room's own choice, or "ยังไม่ได้ตั้ง (ใช้ตาม OA)"
 *   · ภาษาหลัก OA — the OA default, or "ยังไม่ได้ตั้ง"
 *   · จะส่งเป็น    — the resolved answer, or the warning that replies go out as typed
 *
 * ⚠️ The third line is `outboundTargetLang`, the SAME function the send path
 * calls — not a re-derivation. A summary that computes its own answer is a
 * summary that can be wrong about the thing it is summarising.
 * บรรทัดสุดท้ายต้องมาจากตัวตัดสินจริง ไม่ใช่คำนวณเองซ้ำ
 *
 * Its own file because `RoomTranslateWizardSteps.tsx` is already past the
 * 400-line warn line.
 *
 * revert: delete this file and put the single `step4_lang_order_label` span back
 * in the blue box.
 */
import React from 'react';

import { useI18n } from '../../../../../i18n';
import { TRANSLATE_LANGUAGES } from '../../../../../config/translateLanguages';
import {
  outboundTargetLang,
  type OutboundTargetSource,
} from '../../../../../services/chat/outboundTranslateTarget';

export interface Step4LangSummaryProps {
  room: (OutboundTargetSource & Record<string, unknown>) | null | undefined;
}

export const Step4LangSummary: React.FC<Step4LangSummaryProps> = ({ room }) => {
  const { t } = useI18n();

  /** flag + human name, resolved through i18n like every other language label. */
  const show = (code?: string | null): string | null => {
    if (!code) return null;
    const entry = TRANSLATE_LANGUAGES.find((l) => l.code === code);
    return entry
      ? `${entry.flag} ${t(entry.labelKey, entry.fallbackLabel)}`
      : code; // unknown code: show it rather than hide it
  };

  const roomLang = show(room?.translate_lang);
  const hookLang = show(room?.hook_translate_lang);
  const detected = show(room?.detected_source_lang);
  const target = show(outboundTargetLang(room));

  const Row = ({
    label,
    value,
    muted,
    testId,
  }: {
    label: string;
    value: string;
    muted?: boolean;
    testId: string;
  }) => (
    <div className="flex items-baseline justify-between gap-2" data-testid={testId}>
      <span className="text-[11px] text-sky-700/80 dark:text-sky-300/70">{label}</span>
      <span
        className={`text-xs font-semibold ${
          muted
            ? 'text-gray-400 dark:text-gray-500'
            : 'text-sky-900 dark:text-sky-100'
        }`}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div
      className="rounded-lg bg-sky-50/70 dark:bg-sky-950/30 p-2.5 border border-sky-100 dark:border-sky-900/50 space-y-1.5"
      data-testid="step4-lang-summary"
    >
      <Row
        testId="step4-lang-room"
        label={t('room_translate_modal.step4_room_lang', 'ภาษาของห้องแชท')}
        value={
          roomLang ??
          t('room_translate_modal.step4_room_lang_unset', 'ยังไม่ได้ตั้ง (ใช้ตาม OA)')
        }
        muted={!roomLang}
      />
      <Row
        testId="step4-lang-hook"
        label={t('room_translate_modal.step4_hook_lang', 'ภาษาหลัก OA')}
        value={
          hookLang ?? t('room_translate_modal.step4_hook_lang_unset', 'ยังไม่ได้ตั้ง')
        }
        muted={!hookLang}
      />
      {/* Only worth a line when it is actually carrying the answer — otherwise it
          is noise beside two fields that already decided. */}
      {!roomLang && !hookLang && detected ? (
        <Row
          testId="step4-lang-detected"
          label={t('room_translate_modal.step4_detected_lang', 'ภาษาที่ระบบตรวจพบ')}
          value={detected}
        />
      ) : null}

      <div className="pt-1.5 mt-0.5 border-t border-sky-100 dark:border-sky-900/50">
        <Row
          testId="step4-lang-target"
          label={t('room_translate_modal.step4_will_send_in', 'จะส่งเป็นภาษา')}
          value={
            target ??
            t(
              'room_translate_modal.step4_will_send_untranslated',
              'ไม่มีภาษา — จะส่งตามที่พิมพ์',
            )
          }
          muted={!target}
        />
      </div>
    </div>
  );
};
