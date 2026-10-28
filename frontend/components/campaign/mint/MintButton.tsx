/**
 * [FEAT-20260824-BCASTMINT] The button in the target section, and the only
 * thing `BroadcastFormModal` has to mount.
 * ===========================================================================
 * เจ้าของ 24/08: *"ทำเป็น module mint boardcast/multicast ไว้ จะมี mint อื่น ๆ อีก
 * ห้ามสร้างหนี้ ต้องเพิ่มง่าย"*.
 *
 * 🔴 THE FORM LEARNS NOTHING ABOUT MINTS. It renders `<MintButton>` and
 *    receives finished `{match, rules}` — the same object
 *    `AudienceRuleBuilder.onChange` already hands it. So a new mint changes
 *    `mint.registry.ts` and nothing else, and deleting the feature is deleting
 *    this folder plus one JSX block. ฟอร์มไม่รู้จัก mint เลย รับแค่ผลลัพธ์รูปเดิม.
 *
 * ⚠️ ONE BUTTON PER MINT, rendered from the table. The day there are five
 *    mints this row becomes five buttons with no edit here — which is what
 *    "ต้องเพิ่มง่าย" has to mean in code, not just in a comment.
 *
 * ⚠️ `disabled` follows the form's read-only state exactly like every other
 *    control in that section. A button that fills in a field the user may not
 *    edit is a way to lose data on a locked record.
 *
 * revert: ลบโฟลเดอร์ `mint/` + import และบล็อก `<MintButton …/>` ในฟอร์ม
 */
import React from 'react';
import { Sparkles } from 'lucide-react';

import { useI18n } from '../../../i18n';

import { MINTS, type MintChoice, type MintDefinition } from './mint.registry';
import { applyMint, type MintedRule } from './mintRules';
import { MintChoiceModal } from './MintChoiceModal';

interface Props {
  readonly disabled?: boolean;
  /** The form's current conditions — only used to decide whether to warn. */
  readonly existingRuleCount: number;
  /** Handed the finished target patch, ready to spread into `formData.target`. */
  readonly onMint: (next: {
    readonly match: 'and' | 'or';
    readonly rules: MintedRule[];
  }) => void;
}

export const MintButton: React.FC<Props> = ({
  disabled = false,
  existingRuleCount,
  onMint,
}) => {
  const { t } = useI18n();
  const [open, setOpen] = React.useState<MintDefinition | null>(null);

  const pick = (choices: MintChoice[]): void => {
    /* 🔴 `new Date()` HERE, at the click. Reading the clock when the module
       loaded would mint yesterday's date in a tab left open overnight.
       See `mintRules.ts`. เวลาต้องมาจากตอนกด. */
    onMint(applyMint(choices, new Date()));
    setOpen(null);
  };

  return (
    <>
      <div className="flex flex-wrap gap-2" data-testid="mint-buttons">
        {MINTS.map(mint => (
          <button
            key={mint.id}
            type="button"
            disabled={disabled}
            data-testid={`mint-open-${mint.id}`}
            onClick={() => setOpen(mint)}
            /* [UI-20260826-MINTBIG] เจ้าของสั่ง: "label ปุ่ม mint = Mint เงื่อนไข [icon]
               ขยายปุ่มใหญ่ขึ้น + border ด้วย"
               เดิม `text-xs px-3 py-1.5 border` (เส้นบาง อ่านยาก กดยาก)
               ⇒ `text-sm px-4 py-2.5 border-2` · ไอคอน 13 → 16
               ⚠️ ไม่แตะ `disabled:` — พฤติกรรมตอนกดไม่ได้เหมือนเดิมทุกประการ */
            className="inline-flex items-center gap-2 rounded-xl border-2 border-dark-600 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition-all hover:border-emerald-500 hover:text-emerald-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles size={16} aria-hidden />
            {t(mint.label_key)}
          </button>
        ))}
      </div>

      <MintChoiceModal
        mint={open}
        existingRuleCount={existingRuleCount}
        onPick={pick}
        onClose={() => setOpen(null)}
      />
    </>
  );
};

export default MintButton;
