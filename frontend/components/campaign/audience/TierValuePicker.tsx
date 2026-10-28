/**
 * [FEAT-2708-TIERUNLOCK] (งาน 5.5) ช่องค่า tier — ติ๊ก select + search multi
 * ===========================================================================
 * โครงเดียวกับ `TagValuePicker` ข้างไฟล์ แต่**ไม่มี fetch เลย**: ตัวเลือกมาจาก
 * `tierOptions()` (pure กลาง) จึงไม่มี loading/fallback ให้ต้องมี
 * · ติ๊กมากกว่าหนึ่ง = ขอสลับ operator เป็น `in` ผ่าน `onOpChange` — ท่าเดียว
 *   กับ TagValuePicker ([FIX-20260825-TAGSELECTALL]) เพราะ BE registry ของ
 *   `tier.code` เปิด ops ['eq','in'] อยู่แล้ว
 * revert: ลบไฟล์นี้ + branch 'tier' ใน RuleValueInput + entry ใน valueSource.registry
 */
import React from 'react';

import { MultiCheckSelect } from '../pickers/MultiCheckSelect';
import { tierOptions, tierCodesOf } from './tierOptions';
import { valueForOp } from './tagOptions';
import { useI18n } from '../../../i18n';

interface Props {
  value: unknown;
  op: string;
  /** [FIX-20260828-RULEONEUPDATE] `nextOp` rides WITH the value, in one call. */
  onChange: (v: unknown, nextOp?: string) => void;
  disabled?: boolean;
  name: string;
  className?: string;
}

export const TierValuePicker: React.FC<Props> = ({
  value,
  op,
  onChange,
  disabled = false,
  name,
  className = '',
}) => {
  const { t } = useI18n();
  const codes = tierCodesOf(value);

  return (
    <div className="min-w-[8rem] flex-1">
      <MultiCheckSelect
        testId={`${name}-tier`}
        values={codes}
        options={tierOptions()}
        placeholder={t('broadcast.tier_pick_placeholder')}
        disabled={disabled}
        triggerClassName={`w-full rounded-lg border border-primary-500/30 bg-primary-500/10 px-2 py-1 text-sm text-slate-900 ${className}`.trim()}
        onChange={(next) => {
          /* เลือกหลายค่า = สลับ op เป็น in (ดูหัวไฟล์) · ไม่มี onOpChange
             (ตัวเรียกเก่า) = ถอยเก็บตัวสุดท้าย กัน BE ปัดค่า */
          /* [FIX-20260828-RULEONEUPDATE] ONE update carries BOTH the value and the
             operator. Two calls could not: `AudienceRuleBuilder.patch()` rebuilds
             the whole rule list from the `rules` it closed over at render time, so
             `onOpChange('in')` followed by `onChange([...])` in the same event had
             the SECOND call rebuild from the SAME stale list — the operator change
             was overwritten and the rule reached Mongo as `{op:'eq', value:[a,b]}`.
             That is the exact shape that made a real campaign refuse to send on
             stg 28/08, with an error blaming the tag ids (both were valid).
             ⚠️ ห้ามกลับไปเรียกสองครั้ง — React ยังไม่ re-render ระหว่างสองบรรทัด อันหลังทับอันแรก */
          const wantsMany = next.length > 1;
          if (wantsMany && op !== 'in') {
            onChange(valueForOp('in', next), 'in');
            return;
          }
          onChange(valueForOp(op, next));
        }}
      />
    </div>
  );
};
