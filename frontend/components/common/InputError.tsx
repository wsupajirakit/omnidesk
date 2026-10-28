/**
 * ==== [FEAT-20260811-HOOKFORMSPLIT] extracted from HookFormModal.tsx ====
 *
 * InputError — a pure inline field-error line (icon + message, or nothing when
 * there is no error). It was declared inside the 5,300-line HookFormModal and
 * used at 17 call sites there; it reads NO state, only its `error` prop, so it is
 * a shared primitive. Lives in components/common/ so other forms can reuse it
 * instead of re-declaring the same 8 lines.
 *
 * ⚠️ JSX verbatim (class strings byte-identical to the inline version). 🚫 KEEP
 * PARENTS THIN — a pure presentational bit like this belongs in common/, never
 * re-inlined. revert: paste back into HookFormModal, drop this file + imports.
 */
import React from 'react';
import { AlertCircle } from 'lucide-react';

export const InputError: React.FC<{ error?: string }> = ({ error }) => {
  if (!error) return null;
  return (
    <div className="flex items-center gap-1 mt-1 text-red-400 text-xs animation-fade-in">
      <AlertCircle size={12} />
      <span>{error}</span>
    </div>
  );
};

export default InputError;
