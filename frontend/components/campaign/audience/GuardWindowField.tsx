/**
 * [FEAT-2708-GUARDWINDOW] ช่อง "stamp ต้องสดใน N ชั่วโมง" ของ job (งาน 4.1)
 * ===========================================================================
 * โผล่เฉพาะเมื่อ rules ของ job มีคีย์ที่ endpoint sources ติดธง
 * `guard_window: true` — FE **ไม่มี list ของตัวเอง**: BE
 * (`guard-window.policy.ts`) เป็นเจ้าของชุดคีย์คนเดียว เพิ่ม/ถอดที่นั่น
 * ช่องนี้ตามเองไม่ต้อง deploy FE (doctrine เดียวกับตัวเลือกเงื่อนไขทั้งหมด)
 *
 * ค่า: ว่าง = ไม่มี guard (งานเก่าทุกใบ) · กรอกแล้ว 1-72 ชั่วโมงเต็ม —
 * validate จริงอยู่ที่ฟอร์ม (`validate()`) และ BE ย้ำอีกสองชั้น (DTO + ensure)
 *
 * แยกไฟล์ตาม dev-local §6 — self-contained: fetch ของตัวเอง อ่าน props อย่างเดียว
 * ไม่ผูก formData (BroadcastFormModal อยู่ waiver ห้ามโตเกินจำเป็น)
 * revert: ลบไฟล์นี้ + จุด mount ใน BroadcastFormModal + 3 คีย์ i18n ×4 ไฟล์
 */
import React, { useEffect, useState } from 'react';
import { broadcastService } from '../../../services/messaging/broadcastService';
import { useI18n } from '../../../i18n';

interface Props {
  rules: ReadonlyArray<{ key: string }> | undefined;
  value: number | null | undefined;
  disabled?: boolean;
  error?: string;
  onChange: (v: number | null) => void;
}

export const GuardWindowField: React.FC<Props> = ({
  rules,
  value,
  disabled,
  error,
  onChange,
}) => {
  const { t } = useI18n();
  /* null = ยังไม่รู้ (อย่าเพิ่งวาด) · Set ว่าง = รู้แล้วว่าไม่มีคีย์ไหนถูกครอบ */
  const [guardKeys, setGuardKeys] = useState<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    broadcastService
      .getAudienceSources()
      .then((list) => {
        if (!alive) return;
        setGuardKeys(
          new Set(
            list.filter((s) => s.guard_window === true).map((s) => s.key),
          ),
        );
      })
      /* อ่านธงไม่ได้ = ไม่โชว์ช่อง — ค่าเดิมของ job ไม่หาย (state ฟอร์มถืออยู่
         และ validate ไม่บังคับช่องที่มองไม่เห็น) ดีกว่าเดา list เอง */
      .catch(() => {
        if (alive) setGuardKeys(new Set());
      });
    return () => {
      alive = false;
    };
  }, []);

  const show =
    guardKeys !== null && (rules ?? []).some((r) => guardKeys.has(r.key));
  if (!show) return null;

  return (
    <div className="mt-3 rounded-xl border border-dark-700 p-3">
      {/* [UI-20260828-GUARDORDER] คำถาม → ช่องกรอก → คำอธิบาย → ตัวอย่าง
          🔴 เดิมคำอธิบายยาวคั่นอยู่ระหว่างหัวข้อกับช่องกรอก ⇒ ต้องอ่านจบทั้งประโยค
             ก่อนถึงจะเห็นว่ากรอกตรงไหน · คนที่รู้อยู่แล้วว่าจะใส่เลขอะไรต้องอ่านผ่าน
             ทุกครั้ง ⇒ ย้ายช่องขึ้นมาต่อจากหัวข้อ แล้วให้คำอธิบายทำหน้าที่ของมันคือ
             อธิบายสิ่งที่เพิ่งกรอกไป
          ⚠️ ลำดับ DOM เปลี่ยน แต่ `<label>` ยังห่อทั้งก้อนเหมือนเดิม ⇒ คลิกหัวข้อ
             แล้วโฟกัสลงช่องได้เหมือนเดิม และตัวอ่านหน้าจอยังผูกป้ายกับช่องถูกตัว */}
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">
          {t('broadcast.guard_window_label')}
        </span>
        <input
          type="number"
          name="guard_window_hours"
          /* 🔴 `min={1}` ไม่ใช่ 0 — 0 ชั่วโมงแปลว่า "ต้อง stamp ในวินาทีที่รอบเริ่ม"
             ซึ่งไม่มีทางจริง ⇒ จะกลายเป็นแคมเปญที่ไม่ถึงใคร โดยดูเหมือนตั้งค่าถูก
             ⚠️ นี่เป็นแค่ด่านของเบราว์เซอร์ · ด่านจริงคือ `validate()` ใน
                `BroadcastFormModal` (1 ถึง 72 จำนวนเต็ม) และ DTO ฝั่ง BE
                (`@Min(1) @Max(72)`) — ต้องตรงกันทั้งสามชั้น ไม่งั้นจะเซฟไม่ได้
                โดยไม่มีคำอธิบาย หรือหลุดค่าที่ BE ไม่รับขึ้นไป */
          min={1}
          max={72}
          step={1}
          disabled={disabled}
          value={value ?? ''}
          onChange={(e) =>
            onChange(e.target.value === '' ? null : Number(e.target.value))
          }
          className="mt-2 w-28 rounded-lg border border-dark-600 bg-white px-3 py-1.5 text-sm text-slate-800"
        />
        <span className="mt-2 block text-xs text-slate-700">
          {t('broadcast.guard_window_hint')}
        </span>
        {/* ตัวอย่างเป็นตัวเลขจริง — ประโยคอธิบายข้างบนพูดถึง "N" ซึ่งอ่านแล้วยัง
            ต้องแปลงเป็นเลขในหัวอยู่ดี */}
        <span
          className="mt-1 block text-xs text-slate-500"
          data-testid="guard-window-example"
        >
          {t('broadcast.guard_window_example')}
        </span>
      </label>
      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
    </div>
  );
};
