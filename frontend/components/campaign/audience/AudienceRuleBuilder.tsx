import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useI18n } from '../../../i18n';
import { SearchableSelect } from '../../common/SearchableSelect';
import { isVisibleSource } from './visibleSources';
import { broadcastService } from '../../../services/messaging/broadcastService';
import type { AudienceRule, AudienceSourceInfo } from '../../../types';
import { RuleValueInput } from './RuleValueInput';

/**
 * [FEAT-20260823-BCASTAUDUI] Choosing who receives a broadcast.
 * ===========================================================================
 * 🔴 THE FIELD LIST IS READ AT RUNTIME, NEVER HARD-CODED HERE. The backend adds
 *    a selectable field by adding ONE entry to its registry and changing
 *    nothing else (`audience-source.registry.ts`). A list copied into this
 *    repo goes stale the first time that happens — the form would hide a new
 *    field, or keep offering a retired one. `audienceSeamDrift.value.test.ts`
 *    fails if a key ever appears in this repo's source.
 *    รายการต้องดึงตอนรัน ห้ามเขียนตาย.
 *
 * 🔴 A RULE THE BACKEND CANNOT BUILD REFUSES THE WHOLE JOB — it does not get
 *    dropped. That is deliberate on their side: dropping a condition would make
 *    the audience WIDER than the admin asked for, which is the one mistake that
 *    cannot be undone once the messages are out. So this component only ever
 *    offers keys and operators that came back from the registry.
 *    ส่งเงื่อนไขที่ BE ไม่รู้จัก = ทั้งงานถูกปฏิเสธ ไม่ใช่ตัดเงื่อนไขนั้นทิ้ง.
 *
 * ⚠️ `indexed: false` MEANS SLOW, NOT BROKEN. The registry declares it rather
 *    than assuming, and the warning is shown so an admin can decide — hiding
 *    those fields would be deciding for them.
 *
 * revert: delete this folder and the `mode === 'rules'` block in the form.
 */
/**
 * 🔴 THE SAME CEILING THE BACKEND ENFORCES (`MAX_AUDIENCE_RULES`).
 *
 * Not a second opinion: the backend REFUSES a job past it — it does not trim —
 * so a form that let an admin add a ninth condition would let them save a
 * campaign that can never send, and the error would arrive far from the button
 * that caused it. Mirrored here so the button simply stops.
 * ⚠️ CHANGE ONE, CHANGE BOTH — `audience-filter.ts` is the authority.
 */
/* ⚠️ 8 → 20 เมื่อ 25/08/2026 ตามที่เจ้าของสั่งหลังยิงจริงแล้วชนเพดาน
      ("อนุญาติแล้วปลดสิ") · ฝั่ง BE แก้ที่ `audience-filter.ts:100`
   🔴 ที่จับได้ว่าลืมแก้ฝั่งนี้คือ `test/audienceSeamDrift.value.test.ts` ซึ่งอ่าน
      เลขจากไฟล์ BE จริงมาเทียบ — หมุดข้ามรีโปตัวนั้นทำงานถูกต้องเป๊ะ ห้ามลบ
      มันคือสิ่งเดียวที่กันสองฝั่งไม่ให้เพี้ยนกัน */
const MAX_RULES = 20;

interface Props {
  disabled?: boolean;
  match: 'and' | 'or';
  rules: AudienceRule[];
  onChange: (next: { match: 'and' | 'or'; rules: AudienceRule[] }) => void;
}

export const AudienceRuleBuilder: React.FC<Props> = ({
  disabled,
  match,
  rules,
  onChange,
}) => {
  const { t } = useI18n();
  const [sources, setSources] = useState<AudienceSourceInfo[]>([]);
  const [loadError, setLoadError] = useState(false);

  /* 🔴 THE OPERATOR MOVES WITH THE FIELD. Each source declares its own `ops`;
     keeping the previous one would build a rule the backend refuses, and the
     whole job would stop sending. เปลี่ยน field ต้องรีเซ็ต op ด้วย.
     [UI-20260826-AUDIENCESEARCH] ยกออกมาเป็นฟังก์ชันเดียว เพราะตอนนี้มีสองทางเข้า
     (`<select>` ที่ซ่อนไว้ กับ `SearchableSelect` ที่คนเห็น) — ถ้าเขียนซ้ำสองที่
     วันหลังแก้ที่เดียวจะได้พฤติกรรมคนละแบบ */
  const pickKey = (i: number, key: string): void => {
    const next = sources.find(s => s.key === key);
    patch(i, { key, op: (next?.ops[0] ?? 'eq') as AudienceRule['op'] });
  };

  useEffect(() => {
    let alive = true;
    broadcastService
      .getAudienceSources()
      .then(list => {
        /* [UI-20260826-AUDIENCE3] กรอง ณ จุดรับ ไม่ใช่ตอน render
           ⇒ ทุกที่ที่อ่าน `sources` (ตัวเลือก · ค่าเริ่มต้นของแถวใหม่ · ปุ่มเพิ่ม)
             เห็นชุดเดียวกันหมด ไม่มีทางเพี้ยนกันเอง */
        if (alive) setSources(list.filter(s => isVisibleSource(s.key)));
      })
      .catch(() => {
        /* 🔴 An empty picker with a REASON, never a silent empty picker. An
           admin who sees no fields and no message concludes the feature is
           broken and files a bug against the wrong half. */
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const sourceOf = (key: string): AudienceSourceInfo | undefined =>
    sources.find(s => s.key === key);

  const addRule = () => {
    const first = sources[0];
    if (!first || rules.length >= MAX_RULES) return;
    onChange({
      match,
      rules: [...rules, { key: first.key, op: first.ops[0] as AudienceRule['op'], value: '' }],
    });
  };

  const patch = (i: number, next: Partial<AudienceRule>) => {
    onChange({
      match,
      rules: rules.map((r, idx) => (idx === i ? { ...r, ...next } : r)),
    });
  };

  const removeRule = (i: number) =>
    onChange({ match, rules: rules.filter((_, idx) => idx !== i) });

  if (loadError) {
    return (
      <p className="text-sm text-red-500" role="alert" data-testid="audience-load-error">
        {t('broadcast.audience_load_failed')}
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="audience-rule-builder">
      <div className="flex items-center gap-2 text-xs text-slate-700">
        <span>{t('broadcast.audience_match_label')}</span>
        <select
          name="audience_match"
          value={match}
          disabled={disabled}
          onChange={e => onChange({ match: e.target.value as 'and' | 'or', rules })}
          className="rounded-lg border border-primary-500/30 bg-primary-500/10 px-2 py-1 text-slate-900"
        >
          <option value="and">{t('broadcast.audience_match_and')}</option>
          <option value="or">{t('broadcast.audience_match_or')}</option>
        </select>
      </div>

      {rules.length === 0 && (
        <p className="text-xs text-slate-700" data-testid="audience-no-rules">
          {t('broadcast.audience_none')}
        </p>
      )}

      {rules.map((rule, i) => {
        const source = sourceOf(rule.key);
        return (
          <div key={`${rule.key}-${i}`} className="flex flex-wrap items-center gap-2">
            {/* [UI-20260826-AUDIENCESEARCH] เจ้าของสั่ง: "select แสดงแบบ search ด้วย
                (ใช้ตัว select ของคนอื่น reuse สิ ไม่ใช่สร้างใหม่ แก้หลายรอบแล้ว)"
                ⇒ ใช้ `components/common/SearchableSelect` ตัวเดียวกับที่หน้าอื่นใช้
                  ไม่ได้เขียนคอมโพเนนต์ใหม่

                ⚠️ **`<select>` จริงยังอยู่ ซ่อนไว้** — แบบเดียวกับ `DirectionalSelect`
                   เพราะเทสอ่าน `HTMLSelectElement.options` และยิง `fireEvent.change`
                   ถ้าถอดออก เทสที่พิสูจน์ว่า "ตัวเลือกมาจากทะเบียนเท่านั้น" จะพังทั้งชุด
                   ทั้งที่ของไม่ผลสุทธิ · และฟอร์มบนมือถือ/เครื่องอ่านหน้าจอยังใช้ได้เหมือนเดิม
                   ⇒ ทั้งสองตัวเรียก `pickKey` ตัวเดียวกัน ไม่มีสถานะซ้อน */}
            <select
              name={`audience_key_${i}`}
              data-testid={`audience_key_${i}`}
              value={rule.key}
              disabled={disabled}
              onChange={e => pickKey(i, e.target.value)}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
            >
              {sources.map(s => (
                <option key={s.key} value={s.key}>
                  {s.label_th || s.label_en}
                </option>
              ))}
            </select>
            {/* [UI-20260826-DROPDIR] `dropUp` — ตัวนี้อยู่ในฟอร์มที่มี `overflow-y-auto`
                (`BroadcastFormModal.tsx:859`) และแถวเงื่อนไขงอกลงล่างเรื่อย ๆ
                ⚠️ มันเกิด **หลัง** กฎขึ้นบน (`021a8ac`) จึงไม่เคยกางลงเลยสักครั้ง
                   การเปลี่ยนเป็นลงล่างตอนนี้ = เปลี่ยนของที่ไม่มีใครสั่ง จึงคงไว้ */}
            <SearchableSelect
              dropUp
              className="min-w-[16rem] flex-1"
              size="sm"
              value={rule.key}
              disabled={disabled}
              onChange={v => pickKey(i, v)}
              options={sources.map(s => ({ value: s.key, label: s.label_th || s.label_en }))}
              placeholder={t('broadcast.audience_add')}
            />

            <select
              name={`audience_op_${i}`}
              value={rule.op}
              disabled={disabled}
              onChange={e => patch(i, { op: e.target.value as AudienceRule['op'] })}
              className="rounded-lg border border-primary-500/30 bg-primary-500/10 px-2 py-1 text-sm text-slate-900"
            >
              {(source?.ops ?? []).map(op => (
                <option key={op} value={op}>
                  {t(`broadcast.audience_op_${op}`)}
                </option>
              ))}
            </select>

            {/* [FIX-20260824-VALUEINPUTUNWIRED] 🔴 เดิมตรงนี้เป็น `<input type="text">`
                ธรรมดา และ `RuleValueInput.tsx` **ไม่เคยถูกเรียกจากที่ไหนเลย**
                (grep ทั้ง repo 24/08 เจอแค่ตัวมันเองกับ mint ที่ยืม `toAbsoluteIso`)
                ⇒ งาน [FEAT-20260824-RULEVALUEBYTYPE] ทั้งก้อนไม่เคยมีผลบนจอ:
                  · ฟิลด์ประเภทวันที่ยังเป็นช่องพิมพ์เปล่า ไม่ใช่ตัวเลือกวันเวลา
                  · และที่หนักกว่านั้น — ค่าที่ส่งไม่มี `+07:00` ติดไปด้วย ⇒ BE ตีความ
                    ตาม TZ ของเครื่องมันเอง ซึ่งเป็นบั๊กเงียบที่ไฟล์นั้นสร้างมาเพื่อแก้
                เขียนคอมโพเนนต์ไว้แล้วไม่ต่อสาย = เทสเขียว หน้าจอยังพัง.
                ⚠️ `type` ปล่อย undefined ได้ — `RuleValueInput` จะถอยเป็นช่อง text
                   เหมือนเดิม ⇒ ฟิลด์ที่ยังโหลด source ไม่เสร็จไม่พัง */}
            <RuleValueInput
              name={`audience_value_${i}`}
              type={source?.type}
              ruleKey={rule.key}
              op={rule.op}
              value={rule.value}
              disabled={disabled}
              /* [FIX-20260828-RULEONEUPDATE] value + operator in ONE patch.
                 `patch` rebuilds the rule list from the `rules` it closed over,
                 so two patches in one event make the second overwrite the first
                 — which is how `{op:'eq', value:[a,b]}` reached Mongo and made a
                 campaign refuse to send (stg 28/08). One call, one update. */
              onChange={(v, nextOp) =>
                patch(
                  i,
                  nextOp
                    ? {
                        value: v as AudienceRule['value'],
                        op: nextOp as AudienceRule['op'],
                      }
                    : { value: v as AudienceRule['value'] },
                )
              }
              placeholder={t('broadcast.audience_value_placeholder')}
            />

            <button
              type="button"
              name={`audience_remove_${i}`}
              onClick={() => removeRule(i)}
              disabled={disabled}
              className="rounded-lg border border-dark-700 p-1 text-slate-700 hover:border-red-500/50 hover:text-red-400"
              aria-label={t('broadcast.audience_remove')}
            >
              <X size={14} />
            </button>

            {source && !source.indexed && (
              /* Declared by the backend, never assumed. Slow is a decision the
                 admin gets to make; hiding it would be making it for them. */
              /* [UI-20260828-AMBERLIGHT] เจ้าของ 28/08: "สีเหลืองมองไม่เห็นใน light"
                 🔴 `amber-300` (#FCD34D) เขียนไว้สำหรับพื้นมืด · พื้นฟอร์มธีมสว่างคือ
                    #EDF1F6 ⇒ contrast ต่ำมาก · คำเตือนที่อ่านไม่ออกเท่ากับไม่มีคำเตือน
                 ⇒ `amber-600` (#D97706) ในธีมสว่าง ธีมมืดคงค่าเดิมไว้ผ่าน `dark:`
                 ⚠️ แก้พร้อมกัน 10 จุดที่ใช้ `text-amber-300` เดี่ยว ๆ ทั้ง repo — ปัญหาเดียวกัน
                    ทุกที่ ปล่อยไว้บางจุดจะเพี้ยนกันเองภายหลัง */
              <span className="w-full text-[11px] text-amber-600 dark:text-amber-300" data-testid={`audience-slow-${i}`}>
                {t('broadcast.audience_slow')}
              </span>
            )}
          </div>
        );
      })}

      <button
        type="button"
        name="audience_add"
        onClick={addRule}
        disabled={disabled || sources.length === 0 || rules.length >= MAX_RULES}
        /* [UI-20260826-ADDBIG] เจ้าของสั่ง: "+ปุ่มเพิ่มเงื่อนไข ใหญ่ขึ้น + border"
           เดิม `text-xs px-3 py-1.5` + เส้นจาง `border-primary-500/40`
           ⇒ `text-sm px-4 py-2.5 border-2` เส้นทึบ · ไอคอน 14 → 16
           ⚠️ ไม่แตะเงื่อนไข `disabled` — ยังกดไม่ได้ตอนไม่มี source หรือชนเพดาน MAX_RULES */
        className="inline-flex items-center gap-2 rounded-xl border-2 border-primary-500/60 bg-white px-4 py-2.5 text-sm font-bold text-primary-600 shadow-sm transition-all hover:border-primary-500 hover:bg-primary-500/5 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Plus size={16} /> {t('broadcast.audience_add')}
      </button>
      {rules.length >= MAX_RULES && (
        <p className="text-[11px] text-amber-600 dark:text-amber-300" data-testid="audience-at-limit">
          {t('broadcast.audience_limit', { n: MAX_RULES })}
        </p>
      )}
    </div>
  );
};
