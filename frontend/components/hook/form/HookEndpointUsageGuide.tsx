/**
 * ==== [FEAT-20260811-HOOKFORMSPLIT] extracted from HookFormModal.tsx ====
 *
 * The "Custom Endpoints Usage Guide" overlay (`showHowToUse`) — the biggest
 * single-state block left in HookFormModal, and 100% static content: it reads no
 * form state and no handler, only its own open/close boolean. State stays in the
 * parent; this renders it.
 *
 * ⚠️ JSX COPIED VERBATIM — class strings and element order are byte-identical to
 * the inline version (proven by `test/hookEndpointUsageGuide.dom.test.tsx`).
 * Do not "tidy" the markup; a class change is a visual change the snapshot rejects.
 * ห้ามแต่ง markup — snapshot ล็อกทีละไบต์.
 *
 * 🚫 KEEP HookFormModal THIN — a static, single-state overlay like this belongs
 * in its own file from the start, never inlined back into the parent.
 * อย่า inline overlay ใหม่กลับเข้าไฟล์แม่.
 *
 * revert: paste this JSX back where `<HookEndpointUsageGuide … />` renders,
 * restore the `Play` icon import in the parent, delete this file.
 */
import React from 'react';
import { X, HelpCircle, Zap, Info, Play, Monitor, Terminal } from 'lucide-react';

import { useI18n } from '../../../i18n';

export const HookEndpointUsageGuide: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-dark-950/40 backdrop-blur-sm transition-all animate-in fade-in duration-300">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-8">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary-500 rounded-xl text-white shadow-lg shadow-primary-500/20">
              <HelpCircle size={20} />
            </div>
            <h3 className="text-xl font-bold text-slate-800">Custom Endpoints Usage Guide</h3>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 text-slate-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-8 overflow-y-auto custom-scrollbar prose prose-slate max-w-none">
          <div className="space-y-8">
            <section>
              <h4 className="text-primary-600 flex items-center gap-2 font-black uppercase tracking-widest text-xs mb-4">
                <Zap size={14} /> Introduction
              </h4>
              <p className="text-slate-600 leading-relaxed font-medium">
                {t('pageui.hookform.guide_intro_a', 'ใช้สำหรับเชื่อมต่อ API ของคุณเองแบบ Custom โดยระบบจะส่งข้อมูล')} <b>Line User ID</b> {t('pageui.hookform.guide_intro_b', 'ไปให้คุณเพื่อดึงข้อมูลหรือทำรายการต่าง ๆ')}
              </p>

              <div className="mt-6 flex flex-col sm:flex-row gap-4 italic bg-primary-500/5 p-4 rounded-xl border border-primary-500/10 not-italic">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                     <Info size={14} className="text-primary-500" />
                     <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">{t('pageui.hookform.guide_manual', 'คู่มือการใช้งาน')}</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed font-bold">
                    {t('pageui.hookform.guide_manual_desc', 'ตั้งค่า API ของคุณเพื่อใช้งาน Dynamic Ext. Endpoint และดึงข้อมูลจากระบบภายนอกอัตโนมัติ (ศึกษาเพิ่มเติมจากคลิปตัวอย่าง)')}
                  </p>
                </div>
                <a
                  href="https://drive.google.com/file/d/EXAMPLE_FILE_ID/view?usp=sharing"
                  target="_blank"
                  rel="noreferrer"
                  className="flex-shrink-0 w-full sm:w-[150px] aspect-video rounded-xl relative overflow-hidden group cursor-pointer border-2 border-primary-500/30 bg-dark-900 shadow-xl hover:shadow-primary-500/40 transition-all active:scale-95 animate-pulse-slow"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-primary-600/20 to-dark-950 flex items-center justify-center">
                     <div className="w-12 h-12 rounded-full bg-red-600 backdrop-blur-md flex items-center justify-center border border-white/20 group-hover:scale-110 group-hover:bg-red-500 transition-all duration-500 shadow-xl shadow-red-500/30">
                        <Play size={22} className="text-white fill-white ml-1" />
                     </div>
                  </div>
                  <div className="absolute top-2 left-2 flex items-center gap-1.5">
                     <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                     <span className="text-[9px] font-black text-white/70 uppercase tracking-widest">Engineer Guide</span>
                  </div>
                  <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-dark-950/80 px-2 py-0.5 rounded-lg border border-white/10">
                     <Monitor size={10} className="text-primary-400" />
                     <span className="text-[10px] font-black text-white uppercase tabular-nums">{t('pageui.hookform.guide_clip', 'คลิป')}</span>
                  </div>
                </a>
              </div>
            </section>

            <section className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
              <h4 className="text-slate-800 font-bold mb-3">Endpoint Key</h4>
              <p className="text-sm text-slate-500 mb-4">{t('pageui.hookform.guide_key_hint', 'ชื่อเรียกของ API นี้ (แนะนำภาษาอังกฤษตัวพิมพ์ใหญ่) เช่น:')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white p-3 rounded-xl border border-slate-200 font-mono text-xs text-primary-600 font-bold uppercase tracking-wide">CUSTOMER_PROFILE</div>
                <div className="bg-white p-3 rounded-xl border border-slate-200 font-mono text-xs text-primary-600 font-bold uppercase tracking-wide">PAYMENT_HISTORY</div>
              </div>
            </section>

            <section>
              <h4 className="text-slate-800 font-bold mb-3">Dynamic Values</h4>
              <p className="text-sm text-slate-500 mb-4">{t('pageui.hookform.guide_vars_hint', 'คุณสามารถใช้ตัวแปรเหล่านี้ใน Path หรือ Request Body:')}</p>
              <ul className="space-y-3 m-0 p-0 list-none">
                <li className="flex items-start gap-3 bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                  <code className="text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-200 font-bold text-xs">{`{{line_user_id}}`}</code>
                  <span className="text-xs text-emerald-800 font-medium">{t('pageui.hookform.guide_use_in', 'ใช้ใน')} <b>Path</b> {t('pageui.hookform.guide_path_desc', 'เพื่อระบุ ID ผู้ส่ง')}</span>
                </li>
                <li className="flex items-start gap-3 bg-blue-50 p-3 rounded-xl border border-blue-100">
                  <code className="text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200 font-bold text-xs">{`{{lineuserid}}`}</code>
                  <span className="text-xs text-blue-800 font-medium">{t('pageui.hookform.guide_use_in', 'ใช้ใน')} <b>Request Body</b> (JSON Value)</span>
                </li>
              </ul>
            </section>

            <section className="bg-dark-900 p-6 rounded-2xl border border-dark-700 shadow-inner">
              <h4 className="text-white font-bold mb-4 flex items-center gap-2">
                <Terminal size={16} className="text-primary-400" />
                Example JSON Payload
              </h4>
              <pre className="m-0 bg-transparent text-primary-400 font-mono text-xs leading-relaxed">
{`{
  "userid": "{{lineuserid}}",
  "action": "check_balance",
  "timestamp": "2024-04-12"
}`}
              </pre>
            </section>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-8 py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-2xl font-bold transition-all shadow-lg active:scale-95 text-sm"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
};

export default HookEndpointUsageGuide;
