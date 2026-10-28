import React from 'react';
import { Copy } from 'lucide-react';
import { useI18n } from '../../i18n';
import { RAW_JSON_RULES_SAMPLE } from '../../config/rawJsonRulesSample';
import { copyText } from '../../utils/copyText';

/**
 * ==== [FEAT-20260731-RAWJSONSAMPLE] START — ไฟล์ใหม่ทั้งไฟล์
 * 🔒 งานสาย AUTO — to_dev_auto / to_prod_auto เท่านั้น
 *
 * เนื้อในของ modal ช่วยเหลือ ช่อง "กฏการใช้ข้อมูล RAW JSON" (แท็บ AI Response)
 * = คำอธิบายเดิม + ตัวอย่างฉบับเต็ม + ปุ่มคัดลอก
 *
 * Rendered INSIDE the existing <AlertModal>, whose `message` prop already accepts
 * a ReactNode — so AlertModal.tsx itself is untouched.
 *
 * ปุ่มคัดลอกไม่แตะ formData เลย ไม่ setState ของฟอร์ม ไม่เขียนทับช่องที่แอดมิน
 * พิมพ์ไว้ — คัดลอกลง clipboard อย่างเดียว แล้วให้ผู้ใช้วางเอง
 * (จงใจไม่ทำปุ่ม "เติมให้เลย" เพราะจะทับข้อความเดิมโดยไม่ได้ตั้งใจ)
 *
 * onCopied / onCopyFailed ถูกส่งมาจาก HookFormModal เพื่อยิง toast ตัวเดิมของฟอร์ม
 * (toast layer z-[200] > modal z-[60] จึงลอยอยู่เหนือ modal เห็นได้ชัด)
 *
 * revert: ลบไฟล์นี้ + config/rawJsonRulesSample.ts แล้วคืน message ของ helpModal
 *         ให้เป็น t('hook_form.ai_raw_json_rules_help') ตัวเดียวเหมือนเดิม
 * ==== [FEAT-20260731-RAWJSONSAMPLE] END
 */

interface RawJsonRulesHelpProps {
  onCopied: () => void;
  onCopyFailed: () => void;
}

export const RawJsonRulesHelp: React.FC<RawJsonRulesHelpProps> = ({ onCopied, onCopyFailed }) => {
  const { t } = useI18n();

  const handleCopySample = async () => {
    // [FIX-20260830-COPYHTTP2] the old code was right that the raw API throws on
    // http — but that meant the sample could never be copied at all. copyText
    // falls back to execCommand, so the failure branch is now a real failure.
    if (await copyText(RAW_JSON_RULES_SAMPLE)) {
      onCopied();
    } else {
      onCopyFailed();
    }
  };

  return (
    <div>
      {/* คำอธิบายเดิม — ข้อความไม่เปลี่ยน ย้ายมาอยู่ใน component นี้เฉยๆ */}
      <div className="whitespace-pre-wrap">{t('hook_form.ai_raw_json_rules_help')}</div>

      <div className="mt-5 pt-4 border-t border-dark-700">
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-sm font-bold text-slate-500">
            {t('hook_form.ai_raw_json_rules_sample_title')}
          </span>
          <button
            type="button"
            onClick={handleCopySample}
            title={t('hook_form.ai_raw_json_rules_copy')}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 transition-all"
          >
            <Copy size={13} />
            {t('hook_form.ai_raw_json_rules_copy')}
          </button>
        </div>
        {/* ตัวอย่างยาวมาก — จำกัดความสูงแล้วให้ scroll ในกล่องตัวเอง
            กัน modal ยืดจนปุ่มปิดหลุดจอ */}
        <pre className="max-h-72 overflow-auto custom-scrollbar rounded-lg border border-dark-700 bg-dark-900/60 p-3 text-[11px] leading-relaxed text-slate-500 whitespace-pre-wrap break-words font-mono">
          {RAW_JSON_RULES_SAMPLE}
        </pre>
      </div>
    </div>
  );
};
