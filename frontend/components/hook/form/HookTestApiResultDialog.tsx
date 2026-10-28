/**
 * ==== [FEAT-20260811-HOOKFORMSPLIT] extracted from HookFormModal.tsx ====
 *
 * The "Test Connection Result" dialog — one of several self-contained overlays
 * that HookFormModal used to inline. Pulled out to shrink that 5,600-line file
 * WITHOUT moving any state: the parent still owns `testApiResult` and passes it
 * in as `result`; this component is pure presentation and renders nothing when
 * `result` is null (same guard as the old `{testApiResult && (…)}`).
 *
 * ⚠️ THE JSX BELOW IS COPIED VERBATIM — every class string and element order is
 * byte-identical to the inline version, because the adoption is proven by a DOM
 * snapshot (`test/hookTestApiResultDialog.dom.test.tsx`). Do NOT "tidy" the
 * markup here; a class change is a visual change a snapshot will (correctly)
 * reject. ห้ามแต่ง markup — snapshot ล็อกไว้ทีละไบต์.
 *
 * 🚫 อย่าให้ HookFormModal บวมอีก: dialog/section ใหม่ที่ contained แบบนี้ (อ่าน state
 * ตัวเดียว ไม่ผูก form) ให้แยกเป็นไฟล์ลูกแบบนี้ตั้งแต่แรก อย่า inline กลับเข้าไฟล์แม่.
 * KEEP THE PARENT THIN: extract, don't inline. Same pattern as
 * HookPaymentFlexBlock / HookHandoffTab / HandoffHookCredsEditor.
 *
 * revert: paste this JSX back where `<HookTestApiResultDialog … />` is rendered
 * and delete this file.
 */
import React from 'react';
import { Activity, X } from 'lucide-react';

interface HookTestApiResultDialogProps {
  /** The parent's `testApiResult`: an arbitrary API response (its type there is
   *  `any`), or `null` while closed. Only `.error` is read — it picks the red vs
   *  emerald icon chrome; the whole object is JSON-dumped in the body. Typed as a
   *  loose record so any real response shape passes, matching the parent. */
  result: Record<string, unknown> | null;
  onClose: () => void;
}

export const HookTestApiResultDialog: React.FC<HookTestApiResultDialogProps> = ({
  result,
  onClose,
}) => {
  if (!result) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-dark-950/60 backdrop-blur-sm animation-fade-in">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex justify-between items-center p-5 border-b border-dark-700 bg-dark-800/50">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${result.error ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
              <Activity size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Test Connection Result</h3>
              <p className="text-xs text-slate-500 font-medium">External API Response Preview</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-dark-700 text-slate-500 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar bg-dark-900/30">
          <pre className="text-xs font-mono text-emerald-400 p-4 rounded-xl bg-dark-900 border border-emerald-500/20 leading-relaxed overflow-x-auto shadow-inner">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
        <div className="p-4 border-t border-dark-700 bg-dark-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded-xl bg-dark-700 text-slate-300 font-bold hover:bg-dark-600 transition-all text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default HookTestApiResultDialog;
