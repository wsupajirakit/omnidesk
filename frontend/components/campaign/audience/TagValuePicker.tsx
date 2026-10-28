/**
 * [FEAT-20260824-BCASTTAGPICK] Pick a customer tag by name; store its id.
 * ===========================================================================
 * เจ้าของ 24/08: *"select option ต้องเป็นแบบ search ได้ห้ามทำโง่ ๆ"* ⇒ ใช้
 * `MultiCheckSelect` ตัวเดิมที่ทั้งหน้าบรอดแคสต์ใช้อยู่ ไม่เขียน dropdown ใบใหม่
 *
 * 🔴 ทำไมไม่ปล่อยให้พิมพ์เอง — `customer_tag` ต้องการ `tags._id` (hex 24 ตัว)
 *    แอดมินพิมพ์ "VIP" ⇒ ไม่ error แต่ **หาไม่เจอสักคน** แล้ว campaign ก็ยิงไม่ออก
 *    โดยไม่มีอะไรบอกว่าเพราะอะไร (agent ที่ทำฝั่ง BE รายงานข้อนี้ไว้เอง)
 *
 * 🔴 ถ้าโหลดรายชื่อป้ายไม่ได้ ต้อง **ถอยกลับเป็นช่องพิมพ์** ไม่ใช่โชว์เมนูว่าง
 *    เส้น `/api/chat/tags/*` ต้องมีสิทธิ์ `ticket.manage` (`chat.controller.ts:197,209`)
 *    แต่ฟอร์มนี้ใช้สิทธิ์ `broadcast.manage` ⇒ **คนที่ดูแลบรอดแคสต์อย่างเดียวจะโดน 403**
 *    เมนูว่างจะอ่านว่า "ไม่มีป้ายในระบบ" ซึ่งเป็นคนละเรื่องกับ "คุณไม่มีสิทธิ์ดู"
 *    ⇒ ถอยเป็นช่องพิมพ์ + บอกเหตุผล เพื่อให้คนที่มี id อยู่แล้วยังทำงานต่อได้
 *    โหลดไม่ได้ ≠ ไม่มีป้าย — ห้ามยุบสองอย่างนี้เป็นหน้าจอเดียวกัน.
 *
 * ⚠️ ค้นหาในเครื่อง ไม่ยิง `/tags/suggest` ตามที่พิมพ์ — และนี่คือการเลือกโดยตั้งใจ
 *    `MultiCheckSelect` มีช่องค้นหาในตัวอยู่แล้ว และป้ายทั้งฐานข้อมูลนี้มี 3 ใบ
 *    (โหลดมา 50 ใบแรก) ⇒ ค้นในเครื่องเจอครบและตอบทันที ส่วนการยิงตามที่พิมพ์
 *    ต้องมี debounce + กันคำตอบมาช้าสลับกัน + รวมผลกับที่ติ๊กไว้ ซึ่งเป็นโค้ดที่
 *    ยังไม่มีใครได้ประโยชน์ **วันที่ป้ายทะลุ 50 ใบค่อยเสียบ `suggestTags` ที่มีอยู่แล้ว**
 *    ค้นในเครื่องพอ ตราบใดที่ยังโหลดครบ — อย่าเขียนโค้ดกันปัญหาที่ยังไม่มี
 *
 * revert: ลบไฟล์นี้ + entry ใน `valueSource.registry.ts`
 */
import React from 'react';

import { chatService, type PopularTag } from '../../../services/chat';
import { useI18n } from '../../../i18n';
import { MultiCheckSelect } from '../pickers/MultiCheckSelect';

import {
  mergeSelectedIntoOptions,
  selectedIds,
  valueForOp,
  type TagOptionSource,
} from './tagOptions';

/** How many popular tags to offer before the admin types anything. */
export const TAG_PAGE = 50;

export interface TagValuePickerProps {
  readonly value: unknown;
  readonly op: string;
  /** [FIX-20260828-RULEONEUPDATE] `nextOp` rides WITH the value, in one call. */
  readonly onChange: (value: unknown, nextOp?: string) => void;
  readonly disabled?: boolean;
  readonly name: string;
  readonly className?: string;
}

export const TagValuePicker: React.FC<TagValuePickerProps> = ({
  value,
  op,
  onChange,
  disabled = false,
  name,
  className = '',
}) => {
  const { t } = useI18n();
  const [tags, setTags] = React.useState<TagOptionSource[]>([]);
  const [loading, setLoading] = React.useState(true);
  /* `null` = ยังไม่พัง · string = พังพร้อมเหตุผล. absent ≠ empty string. */
  const [failed, setFailed] = React.useState<string | null>(null);

  /* [FEAT-2708-TIERUNLOCK] (งาน 5.5) แยกเป็นฟังก์ชันเพื่อยิงซ้ำได้ —
     เจ้าของ 27/08: *"เก็ทใหม่ทุกครั้งเวลากด"* · ตอน mount ยังยิงหนึ่งครั้ง
     (จำเป็น: resolve label ของค่าที่เซฟไว้ผ่าน mergeSelectedIntoOptions)
     แล้วยิงใหม่ทุกครั้งที่เมนูเปิด (`onOpen` ของ MultiCheckSelect — additive)
     ⇒ ฟอร์มเปิดค้างไว้ก็เห็นแท็กที่เพิ่งสร้าง ไม่ต้องปิดเปิดฟอร์ม */
  const aliveRef = React.useRef(true);
  React.useEffect(() => {
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const fetchTags = React.useCallback(() => {
    chatService
      .popularTags(TAG_PAGE)
      .then(res => {
        if (!aliveRef.current) return;
        setTags(Array.isArray(res?.data) ? (res.data as PopularTag[]) : []);
        setFailed(null);
      })
      .catch((e: unknown) => {
        if (!aliveRef.current) return;
        /* ⚠️ เก็บข้อความจริงไว้ ไม่กลืน — 403 กับ network error ต้องแยกออกจากกันได้ */
        setFailed(e instanceof Error ? e.message : 'load failed');
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
  }, []);
  React.useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const ids = selectedIds(value);
  const options = mergeSelectedIntoOptions(tags, ids);

  /**
   * 🔴 ถอยเป็นช่องพิมพ์เมื่อโหลดไม่ได้ — ดูเหตุผลที่หัวไฟล์
   *    ค่าที่มีอยู่ต้องแก้ต่อได้ ไม่ใช่ถูกล็อกไว้เพราะรายชื่อโหลดไม่ขึ้น
   */
  if (failed !== null) {
    return (
      <div className="flex min-w-[8rem] flex-1 flex-col gap-1">
        <input
          type="text"
          name={name}
          data-testid={`${name}-tag-fallback`}
          value={ids.join(', ')}
          disabled={disabled}
          onChange={e =>
            onChange(
              valueForOp(
                op,
                e.target.value
                  .split(',')
                  .map(p => p.trim())
                  .filter(Boolean),
              ),
            )
          }
          placeholder={t('broadcast.tag_pick_fallback_placeholder')}
          className={`w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-sm text-slate-900 ${className}`.trim()}
        />
        <span
          className="text-[11px] text-amber-600 dark:text-amber-300"
          data-testid={`${name}-tag-fallback-note`}
        >
          {t('broadcast.tag_pick_unavailable')}
        </span>
      </div>
    );
  }

  return (
    <div className="min-w-[8rem] flex-1">
      <MultiCheckSelect
        testId={`${name}-tag`}
        values={ids}
        options={options}
        loading={loading}
        loadingLabel={t('broadcast.tag_pick_loading')}
        emptyLabel={t('broadcast.tag_pick_empty')}
        placeholder={t('broadcast.tag_pick_placeholder')}
        onOpen={fetchTags}

        disabled={disabled}
        triggerClassName={`w-full rounded-lg border border-primary-500/30 bg-primary-500/10 px-2 py-1 text-sm text-slate-900 ${className}`.trim()}
        onChange={next => {
          /* [FIX-20260825-TAGSELECTALL] เดิม: `op === 'in' ? next : next.slice(-1)`
             ⇒ ตอน op เป็น `eq` การเลือกหลายค่า (รวม "เลือกทั้งหมด") ถูกตัดเหลือ
             ตัวสุดท้ายเงียบ ๆ ผู้ใช้เห็นเป็นปุ่มเสีย — เจ้าของแจ้ง 25/08
             ⇒ เลือกมากกว่าหนึ่ง = **ขอสลับ operator เป็น `in`** ซึ่ง registry ฝั่ง BE
               รองรับอยู่แล้ว (`customer_tag` → ops: ['eq','in']) แล้วเก็บค่าครบ
             ⚠️ ยังรองรับกรณีไม่มี `onOpChange` (ตัวเรียกเก่า) — ถอยไปพฤติกรรมเดิม
                เพื่อไม่ให้ค่าที่ BE รับไม่ได้หลุดขึ้นไป */
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
          onChange(valueForOp(op, op === 'in' ? next : next.slice(-1)));
        }}
      />
    </div>
  );
};

export default TagValuePicker;
