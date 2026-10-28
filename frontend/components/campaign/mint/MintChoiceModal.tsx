/**
 * [FEAT-20260824-BCASTMINT] The chooser: "deposit or withdraw?", plus the
 * warning that says what pressing it will destroy.
 * ===========================================================================
 * เจ้าของ 24/08: *"กดปุ่ม modal เตือน ให้เลือก dep หรือ with แล้วมิ้นค่าให้ในฟอร์ม"*.
 *
 * 🔴 THE WARNING IS NOT DECORATION. A mint REPLACES every condition already on
 *    the form (`mintRules.ts#applyMint`), so pressing a choice can delete work
 *    the admin just typed. An action that destroys must say so BEFORE it runs,
 *    not with an undo afterwards — there is no undo here.
 *    ปุ่มนี้ลบเงื่อนไขเดิมทิ้ง ⇒ ต้องเตือนก่อนกด ไม่ใช่มา undo ทีหลัง เพราะไม่มี undo.
 *
 * ⚠️ THE WARNING IS SHOWN ONLY WHEN THERE IS SOMETHING TO LOSE. A form with no
 *    rules yet loses nothing, and a warning that cries wolf on an empty form is
 *    the fastest way to teach people to click through real ones.
 *    ฟอร์มว่าง = ไม่มีอะไรให้เสีย ⇒ ไม่ต้องเตือน เตือนพร่ำเพรื่อคนจะเลิกอ่าน.
 *
 * ⚠️ It renders its choices from `MINTS`, so a new mint needs no edit here.
 *
 * revert: ลบไฟล์นี้พร้อมโฟลเดอร์ `mint/`
 */
import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

import { useI18n } from '../../../i18n';

import type { MintChoice, MintDefinition } from './mint.registry';

interface Props {
  readonly mint: MintDefinition | null;
  /** How many conditions the form holds right now — drives the warning. */
  readonly existingRuleCount: number;
  /* [FIX-20260825-MINTMULTI] รับเป็น "ลิสต์" เพราะเจ้าของสั่งให้ติ๊กฝาก+ถอนพร้อมกันได้
     ตัวรวมเป็นเงื่อนไขอยู่ที่ `mintRules.ts#applyMint` โมดัลนี้แค่บอกว่าติ๊กอะไรไว้ */
  readonly onPick: (choices: MintChoice[]) => void;
  readonly onClose: () => void;
}

export const MintChoiceModal: React.FC<Props> = ({
  mint,
  existingRuleCount,
  onPick,
  onClose,
}) => {
  const { t } = useI18n();

  /* `null` = closed. A separate `isOpen` beside a nullable mint would let the
     two disagree; one source, no impossible state. */
  if (mint === null) return null;

    const [picked, setPicked] = React.useState<string[]>([]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-white/45 p-4 backdrop-blur">
      <div
        className="my-8 w-full max-w-md rounded-2xl border border-dark-700 bg-dark-800 shadow-2xl"
        data-testid="mint-choice-modal"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between border-b border-dark-700 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">
            {t(mint.title_key)}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-slate-700 transition-colors hover:text-slate-900"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          {existingRuleCount > 0 && (
            <p
              className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700"
              data-testid="mint-replace-warning"
              role="alert"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {t('broadcast.mint_replace_warning', {
                  count: String(existingRuleCount),
                })}
              </span>
            </p>
          )}

          {/* [FIX-20260825-MINTMULTI] ติ๊กได้หลายตัว — กดแล้วยังไม่ปิดโมดัล
              ต้องกด "ตกลง" อีกที · testid เดิมคงไว้ให้เทสที่มีอยู่ยังจับได้ */}
          {mint.choices.map(choice => {
            const on = picked.includes(choice.id);
            return (
              <button
                key={choice.id}
                type="button"
                aria-pressed={on}
                data-testid={`mint-choice-${choice.id}`}
                onClick={() =>
                  setPicked(prev =>
                    prev.includes(choice.id)
                      ? prev.filter(x => x !== choice.id)
                      : [...prev, choice.id],
                  )
                }
                className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                  on
                    ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-400/50'
                    : 'border-dark-700 hover:border-emerald-500 hover:bg-emerald-500/10'
                }`}
              >
                <span className="block text-sm font-semibold text-slate-900">
                  {t(choice.label_key)}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-700">
                  {t(choice.hint_key)}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            disabled={picked.length === 0}
            data-testid="mint-confirm"
            onClick={() =>
              onPick(mint.choices.filter(c => picked.includes(c.id)))
            }
            className="mt-1 w-full rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common.confirm')}
          </button>

          <button
            type="button"
            onClick={onClose}
            data-testid="mint-cancel"
            className="mt-1 w-full rounded-xl border border-dark-700 px-4 py-2 text-sm text-slate-700 transition-colors hover:text-slate-900"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MintChoiceModal;
