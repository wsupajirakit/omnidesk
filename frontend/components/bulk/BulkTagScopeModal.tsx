/**
 * ==== [FEAT-20260801-BULKTAGSCOPE] START — new file
 * 🔒 สาย AUTO — to_dev_auto / to_prod_auto
 *
 * แก้ "ขอบเขตการใช้ TAG" (กลุ่ม + OA) ของ dynamic tag หลายใบพร้อมกัน
 *
 * ── ทำไมเป็นไฟล์แยก ─────────────────────────────────────────────────────────
 * ผู้ใช้สั่ง "ทำเหมือน bulk edit user perm (ตัวอย่าง ห้ามไปแก้นะ)"
 * → ลอก **โครง** จาก components/BulkPermissionsModal.tsx มา ไม่ได้ import ซ้ำ
 *   และ **ไม่ได้แตะไฟล์ต้นฉบับแม้แต่บรรทัดเดียว**
 * เหตุผลเดียวกับที่ไฟล์นั้นแยกจาก UserFormModal: DynamicTagFormModal มีทั้ง
 * tag/value/detail/sub_type/primary credential ซึ่งไม่เกี่ยวกับงานนี้เลย
 * การยัด flag bulk เข้าไปในฟอร์มนั้น = เอาทุกฟิลด์มาเสี่ยงเพื่อกล่องที่เขียนแค่ scope
 * ลบไฟล์นี้กับจุดเรียกใน DynamicTagList.tsx = ฟีเจอร์หายหมด
 *
 * ── สิ่งที่ผู้ใช้เห็น ────────────────────────────────────────────────────────
 * รายชื่อ tag ที่กำลังจะถูกแก้ (เลื่อนดูได้ — 20 ชื่อต้องไม่ดันปุ่มตกจอ)
 * → เลือกกลุ่ม → เลือก OA → ยืนยัน 2 ชั้น
 * ชั้นที่สองทวนจำนวนและขอบเขตอีกรอบ เพราะ "แก้ 14 รายการ" เป็นการกดที่คนกดผ่านๆ
 *
 * ── สิ่งที่มันไม่ทำ ──────────────────────────────────────────────────────────
 * ไม่ได้รวมกับขอบเขตเดิมของแต่ละใบ · ติ๊กอะไรไว้ = ค่าใหม่ทั้งหมด ตรงกับที่ API ทำ
 * กล่องเตือนเรื่องนี้ไว้ก่อนถึงช่องเลือก เพราะ "เพิ่ม" กับ "แทนที่" หน้าตาเหมือนกัน
 * จนกว่าจะมีคนเสียสิทธิ์ที่เคยมี
 * ==== [FEAT-20260801-BULKTAGSCOPE] END
 */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Users, Bot } from 'lucide-react';
// [FEAT-20260810-MODALSHELL] shared dialog chrome — content below is unchanged
import { Modal } from '../common/Modal';
import { useI18n } from '../../i18n';

export interface ScopeOption {
  id: string;
  label: string;
  /** ชื่อกลุ่มของ OA — ใช้โชว์เป็นป้ายเล็กหลังชื่อ (เฉพาะรายการ OA) */
  groupLabel?: string;
  /** id กลุ่มของ OA — ใช้ "กรอง" ว่า OA ตัวไหนควรโผล่ (เฉพาะรายการ OA)
   *  ต้องเป็น id ไม่ใช่ชื่อ เพราะชื่อกลุ่มซ้ำกันได้ */
  groupId?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** ชื่อ tag ที่กำลังแก้ — แสดงอย่างเดียว id เดินทางแยก */
  tagNames: string[];
  groups: ScopeOption[];
  hooks: ScopeOption[];
  groupIds: string[];
  hookIds: string[];
  onChangeGroups: (next: string[]) => void;
  onChangeHooks: (next: string[]) => void;
  onConfirm: () => void;
  saving: boolean;
}

export const BulkTagScopeModal: React.FC<Props> = ({
  isOpen, onClose, tagNames, groups, hooks, groupIds, hookIds,
  onChangeGroups, onChangeHooks, onConfirm, saving,
}) => {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);

  // ⚠️ ผู้ใช้สั่ง: "ต้องติ๊ก group ก่อน OA ภายใต้ group นั้นจึงแสดงออกมา"
  //    → ไม่ติ๊กกลุ่มไหนเลย = ไม่มี OA ให้เลือก (ขึ้นข้อความบอกแทนช่องว่างเปล่า)
  //    กรองด้วย groupId ไม่ใช่ชื่อกลุ่ม เพราะชื่อซ้ำกันได้
  // เรียงตามกลุ่มให้หาง่ายเวลามีเยอะ (ระบบจริงมี 100+ ตัว)
  const hooksSorted = useMemo(
    () => hooks
      .filter((h) => h.groupId && groupIds.includes(h.groupId))
      .sort((a, b) =>
        (a.groupLabel || '').localeCompare(b.groupLabel || '') || a.label.localeCompare(b.label)),
    [hooks, groupIds]);

  /** ติ๊ก/ยกเลิกกลุ่ม แล้ว "ตัด OA ที่หลุดขอบเขต" ออกจากที่เลือกไว้ด้วย
   *  ⚠️ ถ้าไม่ตัด จะส่ง OA ที่ไม่ได้อยู่ในกลุ่มที่เลือกขึ้นไป — ผู้ใช้มองไม่เห็นแล้ว
   *     แต่ค่ายังค้างอยู่ = แก้ไปโดยไม่รู้ตัว */
  const changeGroups = (next: string[]) => {
    onChangeGroups(next);
    const stillVisible = new Set(hooks.filter((h) => h.groupId && next.includes(h.groupId)).map((h) => h.id));
    const pruned = hookIds.filter((id) => stillVisible.has(id));
    if (pruned.length !== hookIds.length) onChangeHooks(pruned);
  };

  if (!isOpen) return null;

  const toggle = (list: string[], id: string, set: (n: string[]) => void) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  /** ปุ่มเลือกทั้งหมด/ล้าง — แยกของใครของมัน ไม่ใช่ปุ่มเดียวคุมทั้งสองฝั่ง
   *  (ผู้ใช้สั่ง "แยกกันระหว่าง group / oa") */
  const SelectAll: React.FC<{ all: ScopeOption[]; picked: string[]; set: (n: string[]) => void }> =
    ({ all, picked, set }) => (
      <span className="ml-auto flex items-center gap-2 text-[11px] font-bold normal-case">
        <button type="button" onClick={() => set(all.map((x) => x.id))}
          disabled={picked.length === all.length || all.length === 0}
          className="text-sky-600 dark:text-sky-400 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">
          {t('dyn_tag.bulk_select_all')}
        </button>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <button type="button" onClick={() => set([])} disabled={picked.length === 0}
          className="text-slate-500 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">
          {t('dyn_tag.bulk_clear_all')}
        </button>
      </span>
    );

  // ⚠️ ผู้ใช้สั่ง: ต้องติ๊ก **อย่างน้อย 1 กลุ่ม และ 1 OA** — ห้ามฝั่งใดฝั่งหนึ่งเป็น 0
  //    (เดิมเป็น "อย่างน้อยฝั่งใดฝั่งหนึ่ง" เปลี่ยนตามคำสั่ง 2026-08-01)
  //    BE ตรวจกติกาเดียวกัน — กันตั้งแต่ปุ่มเพื่อไม่ให้ผู้ใช้กดแล้วเจอ error ทีหลัง
  const nothingPicked = groupIds.length === 0 || hookIds.length === 0;

  return (
    <Modal isOpen={isOpen} maxWidth="max-w-2xl">
        <Modal.Header title={t('dyn_tag.bulk_modal_title')} onClose={onClose} />

        <Modal.Body>
          {/* กำลังแก้ใบไหนบ้าง — จำกัดความสูงและเลื่อนได้ ปุ่มยืนยันต้องไม่หลุดจอ */}
          <div>
            <div className="text-[13px] font-bold text-slate-600 dark:text-slate-300 mb-1">
              {t('dyn_tag.bulk_modal_targets', { count: String(tagNames.length) })}
            </div>
            <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex flex-wrap gap-1.5">
                {tagNames.map((n) => (
                  <span key={n} className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-200 text-[12px] font-medium break-all">
                    {n}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* แทนที่ ไม่ใช่เพิ่ม — บอกก่อนถึงช่องเลือก ไม่ใช่หลัง */}
          <div className="flex items-start gap-2 text-[12px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-2.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{t('dyn_tag.bulk_modal_replace_warning')}</span>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
              <Users size={12} /> {t('dyn_tag.bulk_groups')} ({groupIds.length})
              <SelectAll all={groups} picked={groupIds} set={changeGroups} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
              {groups.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input type="checkbox" checked={groupIds.includes(g.id)}
                    onChange={() => toggle(groupIds, g.id, changeGroups)} className="accent-primary-500" />
                  <span className="truncate">{g.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
              <Bot size={12} /> {t('dyn_tag.bulk_hooks')} ({hookIds.length})
              <SelectAll all={hooksSorted} picked={hookIds} set={onChangeHooks} />
            </div>
            {groupIds.length === 0 ? (
              /* ⚠️ บอกเหตุผลว่าทำไมว่าง ไม่ใช่ปล่อยกล่องเปล่าให้เดาเอง */
              <p className="text-[12px] text-slate-400 py-2">{t('dyn_tag.bulk_pick_group_first')}</p>
            ) : hooksSorted.length === 0 ? (
              <p className="text-[12px] text-slate-400 py-2">{t('dyn_tag.bulk_no_oa_in_group')}</p>
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
              {hooksSorted.map((h) => (
                <label key={h.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input type="checkbox" checked={hookIds.includes(h.id)}
                    onChange={() => toggle(hookIds, h.id, onChangeHooks)} className="accent-primary-500" />
                  <span className="truncate">{h.label}</span>
                  {h.groupLabel && (
                    <span /* [FIX-20260801-TAGSCOPEUI] ธีม dark ใช้ตัวหนังสือสีขาว — ม่วงบนพื้นเข้มอ่านยาก */
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-white">
                      {h.groupLabel}
                    </span>
                  )}
                </label>
              ))}
            </div>
            )}
          </div>
        </Modal.Body>

        <Modal.Footer>
          {/* ยืนยันชั้นที่สอง — ทวนจำนวนและขอบเขตอีกครั้ง */}
          {confirming ? (
            <div className="space-y-3">
              <div className="text-[13px] text-slate-700 dark:text-slate-200">
                {t('dyn_tag.bulk_confirm_question', { count: String(tagNames.length) })}
                <div className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                  {t('dyn_tag.bulk_confirm_scope', {
                    groups: String(groupIds.length), hooks: String(hookIds.length),
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirming(false)} disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                  {t('common.back')}
                </button>
                <button onClick={onConfirm} disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 inline-flex items-center gap-2">
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {t('dyn_tag.bulk_confirm_apply')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                {t('common.cancel')}
              </button>
              <button onClick={() => setConfirming(true)} disabled={nothingPicked}
                title={nothingPicked ? t('dyn_tag.bulk_pick_something') : undefined}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                {t('common.next')}
              </button>
            </div>
          )}
        </Modal.Footer>
    </Modal>
  );
};
