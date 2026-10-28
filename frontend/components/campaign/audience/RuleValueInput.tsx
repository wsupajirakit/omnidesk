/**
 * [FEAT-20260824-RULEVALUEBYTYPE] The value box matches the field it compares.
 * ===========================================================================
 * Owner, 24/08: *"ถ้าอันไหนเปนเวลา ก็ออกเวลา อันไหน boolean ให้ boolean อันไหน value
 * text ได้ก็ได้ input dynamic ตรงค่าเทียบ + เวลาเราระบุ +7 แต่หลังบ้านทำงานตามระบบ
 * เวลาที่ถูกต้องใน db ห้ามงง"*.
 *
 * 🔴 THE TIMEZONE IS THE WHOLE REASON THIS FILE EXISTS, and it was measured, not
 *    assumed. The backend turns a rule's value into a date with plain
 *    `new Date(value)` (`audience/sources/audience-filter.ts:177`). Handed the
 *    raw string an `<input type="datetime-local">` produces —
 *    `"2026-08-24T15:00"`, which carries NO offset — JavaScript reads it as the
 *    local time OF THE SERVER PROCESS. So the same campaign means 15:00 Bangkok
 *    on a laptop and 15:00 UTC on a container, silently, with no error and no
 *    way to tell from the stored value which one happened.
 *    `datetime-local` ไม่มี timezone ติดมา ⇒ BE ตีความตาม TZ ของเครื่องมันเอง.
 *
 * ⇒ every date leaves here as a FULL ISO string WITH the browser's offset
 *   (`2026-08-24T15:00:00+07:00`). That is unambiguous to `new Date`, stores as
 *   the right instant, and keeps reading correctly if the server's timezone
 *   ever changes. ส่ง offset ไปด้วยเสมอ แล้ว DB จะเก็บ instant ที่ถูกต้องเสมอ.
 *
 * ⚠️ THE BOX SHOWS LOCAL TIME, which is what the admin typed. Only the value on
 *    the wire is absolute. คนกรอกเห็นเวลาบ้านเรา · ค่าที่ส่งเป็น absolute.
 *
 * ⚠️ `boolean` HAS NO KEY IN THE REGISTRY TODAY — the six date keys, three
 *    string keys and one `string[]` are all of it. The branch is here because
 *    the owner asked for the pipe before the day it is used, and because a
 *    registry entry that adds one must not need this file edited.
 *
 * revert: render `<input>` unconditionally, as before.
 */
import React from 'react';
import { useI18n } from '../../../i18n';

import {
  CAMPAIGN_OFFSET,
  fromCampaignIso,
  toCampaignIso,
} from '../campaignTime';

import { TagValuePicker } from './TagValuePicker';
import { TierValuePicker } from './TierValuePicker';
import { widgetForKey , opTakesValue } from './valueSource.registry';

/**
 * [FIX-20260824-ONETIMEZONE] ทั้งสามตัวย้ายไปอยู่ `../campaignTime` แล้ว
 *
 * 🔴 เดิม `localOffset()` อ่าน offset จาก **เบราว์เซอร์** ส่วนช่อง `scheduled_at`
 *    ส่งค่าดิบให้ BE เติม `+07:00` เอง ⇒ ค่า `15:00` ที่พิมพ์ในหน้าเดียวกัน
 *    หมายถึงคนละ instant เมื่อเปิดจากคนละโซน (วัดจริง: ห่างกัน 11 ชม. จาก New York)
 *    ตอนนี้ทั้งสองช่องเรียกประตูเดียวกัน และมันหมายถึงเวลาไทยเสมอ
 *    ดูเหตุผลเต็มที่หัวไฟล์ `campaignTime.ts`
 *
 * ⚠️ ชื่อเดิมถูก re-export ไว้ให้ผู้เรียกเก่าไม่พัง — `toAbsoluteIso` รับพารามิเตอร์
 *    ตัวที่สองได้เหมือนเดิมแต่ **ไม่ใช้แล้ว** เพราะโซนไม่ได้มาจากนาฬิกาอีกต่อไป
 */
export {
  CAMPAIGN_OFFSET,
  CAMPAIGN_OFFSET_MIN,
  campaignDaysAgo,
} from '../campaignTime';

/** @deprecated ใช้ `CAMPAIGN_OFFSET` — โซนไม่ได้มาจากเบราว์เซอร์อีกแล้ว */
export const localOffset = (): string => CAMPAIGN_OFFSET;

/** `"2026-08-24T15:00"` → `"2026-08-24T15:00:00+07:00"` (เวลาไทยเสมอ) */
export const toAbsoluteIso = (localValue: string): string =>
  toCampaignIso(localValue);

/** instant ที่เก็บไว้ → ตัวเลขที่กล่องแสดง ตามเวลาไทย */
export const toLocalInput = (stored: unknown): string => fromCampaignIso(stored);

export interface RuleValueInputProps {
  /** The registry's declared type: `date` | `string` | `string[]` | `boolean`. */
  readonly type?: string;
  /**
   * [FEAT-20260824-BCASTTAGPICK] The rule's KEY, for the few fields whose
   * `type` does not describe what the value must be.
   *
   * ⚠️ Optional, and absent means "decide from `type` as before" — every
   * existing caller keeps working untouched. See `valueSource.registry.ts`.
   */
  readonly ruleKey?: string;
  /** The rule's operator — a picker needs it to know scalar vs list. */
  readonly op?: string;
  readonly value: unknown;
  /** [FIX-20260828-RULEONEUPDATE] a picker may ask for a new operator ALONGSIDE
   *  the value; both reach the parent in ONE update. See TagValuePicker. */
  readonly onChange: (value: unknown, nextOp?: string) => void;
  /** [FIX-20260825-TAGSELECTALL] ให้ตัวเลือกค่าขอสลับ operator ได้ (เช่น eq → in) */
  readonly disabled?: boolean;
  readonly name: string;
  readonly placeholder?: string;
  readonly className?: string;
}

export const RuleValueInput: React.FC<RuleValueInputProps> = ({
  type,
  ruleKey,
  op,
  value,
  onChange,
  disabled = false,
  name,
  placeholder,
  className = '',
}) => {
  const { t } = useI18n();
  const base =
    'min-w-[8rem] flex-1 rounded-lg border border-primary-500/30 bg-primary-500/10 px-2 py-1 text-sm text-slate-900';
  const cls = `${base} ${className}`.trim();

  /* [FEAT-20260825-HASVALUE] ถามก่อนทุกอย่าง — op ที่ไม่ต้องกรอกค่า ไม่มีช่องให้กรอก
     `has_value` / `no_value` ถามว่ามีหรือไม่มี ⇒ ช่องกรอกไม่มีความหมายและจะ
     ชวนให้แอดมินคิดว่าต้องพิมพ์อะไรสักอย่างก่อนถึงจะใช้ได้
     ⚠️ ก่อนหน้านี้ไฟล์นี้ไม่มีเส้นทางไหนคืน null เลย — นี่คือเส้นแรก
     revert: ลบ if นี้ + `opTakesValue` ใน valueSource.registry.ts */
  if (!opTakesValue(op)) return null;

  /**
   * [FEAT-20260824-BCASTTAGPICK] 🔴 ASKED BEFORE `type`, and that order is the
   * point: `customer_tag` declares `type: 'string'` but only ever accepts a
   * `tags._id`. Letting `type` win would render the free-text box that made
   * this field unusable — an admin types "VIP", nothing errors, and the
   * campaign matches nobody. คีย์ที่มี widget เฉพาะ ต้องชนะ type เสมอ.
   */
  /* [FEAT-2708-TIERUNLOCK] tier — เหตุผลเดียวกับ customer-tag ข้างล่างเป๊ะ */
  if (widgetForKey(ruleKey) === 'tier') {
    return (
      <TierValuePicker
        value={value}
        op={op ?? 'eq'}
        onChange={onChange}
        disabled={disabled}
        name={name}
        className={className}
      />
    );
  }

  if (widgetForKey(ruleKey) === 'customer-tag') {
    return (
      <TagValuePicker
        value={value}
        op={op ?? 'eq'}
        onChange={onChange}
        disabled={disabled}
        name={name}
        className={className}
      />
    );
  }

  if (type === 'date') {
    return (
      <input
        type="datetime-local"
        name={name}
        data-testid={`${name}-date`}
        value={toLocalInput(value)}
        disabled={disabled}
        onChange={e => onChange(toAbsoluteIso(e.target.value))}
        className={cls}
      />
    );
  }

  if (type === 'boolean') {
    /* A three-state select, not a checkbox: a checkbox cannot say "no value
       chosen", and a rule with no value must stay refusable by the filter
       builder rather than defaulting to `false`.
       checkbox บอก "ยังไม่เลือก" ไม่ได้ ⇒ ต้องเป็น select สามค่า. */
    return (
      <select
        name={name}
        data-testid={`${name}-boolean`}
        value={value === true ? 'true' : value === false ? 'false' : ''}
        disabled={disabled}
        onChange={e =>
          onChange(
            e.target.value === '' ? '' : e.target.value === 'true',
          )
        }
        className={cls}
      >
        <option value="">—</option>
        <option value="true">{t('pageui.campaign.bool_yes', 'ใช่')}</option>
        <option value="false">{t('pageui.campaign.bool_no', 'ไม่ใช่')}</option>
      </select>
    );
  }

  if (type === 'string[]') {
    /* Comma-separated in, array out. The `in` operator wants a list, and typing
       one value must still produce a one-item list rather than a bare string —
       the filter builder checks the shape. พิมพ์ค่าเดียวก็ต้องได้ list. */
    return (
      <input
        type="text"
        name={name}
        data-testid={`${name}-list`}
        value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
        disabled={disabled}
        onChange={e =>
          onChange(
            e.target.value
              .split(',')
              .map(part => part.trim())
              .filter(Boolean),
          )
        }
        placeholder={placeholder}
        className={cls}
      />
    );
  }

  return (
    <input
      type="text"
      name={name}
      data-testid={`${name}-text`}
      value={String(value ?? '')}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={cls}
    />
  );
};

export default RuleValueInput;
