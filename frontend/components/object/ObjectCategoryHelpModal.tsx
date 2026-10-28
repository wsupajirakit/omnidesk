/**
 * [UI-20260901-OBJSPLIT] The Google Drive API-key help overlay, and its image
 * zoom — lifted out of `ObjectCategoryFormModal` verbatim.
 *
 * WHY: adding the wizard and the access step pushed that modal past the 400-line
 * `max-lines` warn threshold. The ratchet in `eslint.config.mjs` may only ever
 * shrink, so a new name on its waiver list is not an option — the answer is to
 * split. This overlay was the largest self-contained block: it reads two
 * booleans and closes itself, touching no form state at all.
 *
 * The markup below is byte-identical to what lived in the modal, only
 * re-indented. Nothing about how it looks or behaves changed.
 *
 * revert: paste this back above the closing fragment of ObjectCategoryFormModal
 * and delete this file.
 */
import React from 'react';
import { ExternalLink, Info, Maximize2, Play, X } from 'lucide-react';

import { ScrollIndicator } from '../common';
import { useI18n } from '../../i18n';

export interface ObjectCategoryHelpModalProps {
  isHelpOpen: boolean;
  setIsHelpOpen: (open: boolean) => void;
  isZoomed: boolean;
  setIsZoomed: (zoomed: boolean) => void;
  helpSource: 'icon' | 'input';
  helpScrollRef: React.RefObject<HTMLDivElement>;
}

export const ObjectCategoryHelpModal: React.FC<ObjectCategoryHelpModalProps> = ({
  isHelpOpen,
  setIsHelpOpen,
  isZoomed,
  setIsZoomed,
  helpSource,
  helpScrollRef,
}) => {
  const { t } = useI18n();
  return (
  <>
    {/* GDrive API Key Help Modal */}
    {isHelpOpen && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/45 backdrop-blur">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 relative">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600">
                <Info size={22} />
              </div>
              <h4 className="font-bold text-slate-800 text-lg">{t('pageui.object.help_title', 'คู่มือช่วยเหลือ')}</h4>
            </div>
            <button 
              onClick={() => setIsHelpOpen(false)}
              className="p-1.5 hover:bg-slate-200 rounded-full text-slate-400 transition-colors"
            >
              <X size={24} />
            </button>
          </div>

          <div className="p-8 flex flex-col gap-8 flex-1 overflow-y-auto custom-scrollbar" ref={helpScrollRef}>
            <div className="text-center">
              <p className="text-base font-bold text-slate-700 mb-4">{t('pageui.object.help_how_key', 'วิธีสร้าง API Key Google Drive')}</p>
              <p className="text-xs font-bold text-primary-600 mb-4 animate-pulse">{t('pageui.object.help_click_video', 'คลิกเพื่อชม VDO > คู่มือการสร้าง')}</p>
              <a 
                href="https://drive.google.com/file/d/EXAMPLE_FILE_ID/view?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-full text-sm font-bold hover:bg-red-500 transition-all border border-red-700 shadow-lg shadow-red-500/30"
              >
                <Play size={16} fill="currentColor" />
                {t('pageui.object.help_view_guide', 'ดูคู่มือการสร้าง')}
              </a>
            </div>

            <div className="relative group/player w-[70%] mx-auto">
              <a 
                href="https://drive.google.com/file/d/EXAMPLE_FILE_ID/view?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-black border-4 border-slate-200 rounded-2xl overflow-hidden cursor-pointer shadow-2xl relative transition-all hover:border-red-500 hover:scale-[1.02] active:scale-95"
              >
                <img 
                  src="/assets/guide-placeholder.svg" 
                  alt="GDrive API Key Guide" 
                  className="w-full h-auto object-cover opacity-60 group-hover/player:opacity-40 transition-opacity"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center text-white shadow-2xl transition-transform group-hover/player:scale-125 group-hover/player:rotate-12">
                    <Play size={32} fill="currentColor" className="ml-1" />
                  </div>
                </div>
                <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between">
                  <span className="text-white text-[9px] font-black uppercase tracking-widest">Tutorial Video</span>
                  <Maximize2 size={12} className="text-white opacity-40 group-hover/player:opacity-100" />
                </div>
              </a>
              <p className="text-[10px] text-slate-400 text-center mt-3 font-semibold italic">{t('pageui.object.help_click_player', 'คลิกที่เครื่องเล่นเพื่อชมวิดีโอคู่มือ')}</p>
            </div>

            {/* Static Preview Block for Zoom */}
            <div className="pt-4 border-t border-slate-100 mt-6 bg-slate-50/50 p-4 rounded-2xl">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div>
                {t('pageui.object.help_screenshot', 'Screenshot: จุดที่ต้องระวัง')}
              </p>
              <div 
                className="relative group/static cursor-zoom-in rounded-xl overflow-hidden border border-slate-200 bg-white shadow-md active:scale-95 transition-all"
                onClick={() => setIsZoomed(true)}
              >
                <img 
                  src="/assets/guide-placeholder.svg" 
                  alt="GDrive Guide Static" 
                  className="w-full h-auto object-cover opacity-100 group-hover/static:opacity-90 transition-opacity"
                />
                <div className="absolute inset-0 bg-primary-500/0 group-hover/static:bg-primary-500/10 transition-all flex items-center justify-center">
                  <div className="p-3 bg-white/25 backdrop-blur rounded-full text-white shadow-xl opacity-0 group-hover/static:opacity-100 transition-all">
                    <Maximize2 size={32} />
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 text-center mt-3 font-medium">{t('pageui.object.help_click_image', 'คลิกที่ภาพด้านบนเพื่อขยายดูจุดตั้งค่า')}</p>
            </div>

            {helpSource === 'input' && (
              <label className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200 cursor-pointer group hover:bg-white transition-colors">
                <div className="relative flex items-center">
                  <input 
                    type="checkbox" 
                    defaultChecked={localStorage.getItem('hide_gdrive_help') === 'true'}
                    onChange={(e) => {
                      if (e.target.checked) {
                        localStorage.setItem('hide_gdrive_help', 'true');
                      } else {
                        localStorage.removeItem('hide_gdrive_help');
                      }
                    }}
                    className="peer h-6 w-6 cursor-pointer appearance-none rounded-lg border border-slate-300 bg-white checked:bg-primary-600 checked:border-primary-600 transition-all"
                  />
                  <X size={14} className="absolute inset-0 m-auto text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" />
                </div>
                <span className="text-sm text-slate-600 select-none font-bold group-hover:text-slate-900 transition-colors">
                  {t('pageui.object.help_dont_show', 'ไม่ต้องแสดงอีก')}
                </span>
              </label>
            )}
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0">
            <button 
              onClick={() => setIsHelpOpen(false)}
              className="w-full px-8 py-3.5 bg-slate-900 text-white rounded-xl text-base font-black shadow-xl hover:bg-slate-800 transition-all active:scale-95 uppercase tracking-widest"
            >
              {t('pageui.object.help_got_it', 'เข้าใจแล้ว, ปิด')}
            </button>
          </div>
          <ScrollIndicator containerRef={helpScrollRef} />
        </div>
      </div>
    )}

    {/* Image Zoom Overlay */}
    {isZoomed && (
      <div 
        className="fixed inset-0 z-[100] flex items-center justify-center bg-white/60 backdrop-blur animate-in fade-in duration-300"
        onClick={() => setIsZoomed(false)}
      >
        <button 
          className="absolute top-6 right-6 p-2 bg-slate-900/10 hover:bg-slate-900/20 text-slate-900 rounded-full transition-all"
          onClick={() => setIsZoomed(false)}
        >
          <X size={24} />
        </button>
        <img 
          src="/assets/guide-placeholder.svg" 
          alt="Zoomed" 
          className="max-w-[95%] max-h-[90%] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300"
        />
      </div>
    )}
  </>
  );
};

export default ObjectCategoryHelpModal;
