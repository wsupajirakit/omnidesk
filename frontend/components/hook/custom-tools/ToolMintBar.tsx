/**
 * [FEAT-20261016-TOOLMINT] The Custom Tools page's mint bar — one button per company the SERVER
 * declares (loan site: demo · Acme · Globex).
 *
 *   env complete   → "Mint <label>"      — the server creates the tool (password from its env,
 *                                          encrypted there); the list reloads.
 *   env incomplete → "เติมโครง <label>"   — the create form opens filled with the skeleton; the
 *                                          admin types the rest and saves as usual.
 *   a tool with the company's name is already listed → the mint button is disabled (the server
 *   refuses too — even for a deleted tool's reserved name — and says why).
 *
 * 🔴 shop-api / older back end: the catalog is null ⇒ this renders NOTHING, so the page markup is
 *    byte-for-byte today's (`test/customToolMint.dom.test.tsx` BEFORE snapshot).
 * revert: delete this folder and its import + two JSX lines in `pages/hook/CustomTools.tsx`.
 */
import React, { useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';

import { useI18n } from '../../../i18n';
import { mintCompanyTool } from '../../../services/hook/toolMint';
import { buildToolMintPreset, type ToolMintPreset } from './toolMintPreset';
import { useToolMintCatalog } from './useToolMintCatalog';

interface Props {
  /** names already in the list — a company whose tool exists cannot be minted again */
  existingNames: string[];
  /** open the create form with this preset (incomplete env) */
  onPrefill: (preset: ToolMintPreset) => void;
  /** a tool was minted — reload the list */
  onMinted: () => void;
}

export const ToolMintBar: React.FC<Props> = ({ existingNames, onPrefill, onMinted }) => {
  const { t } = useI18n();
  const catalog = useToolMintCatalog();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  if (!catalog) return null;

  const mint = async (companyId: string) => {
    setBusy(companyId);
    setResult(null);
    try {
      const out = await mintCompanyTool(companyId);
      setResult(out);
      if (out.ok) onMinted();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="tool-mint-bar" className="mb-4 bg-white border border-slate-200 rounded-xl px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-slate-700 mr-1">{t('pageui.hook.mint.bar_title', 'Mint tool ตามค่าย')}</span>
        {catalog.companies.map((c) => {
          const exists = existingNames.includes(c.toolName);
          return c.ready ? (
            <button
              key={c.id}
              type="button"
              data-company={c.id}
              onClick={() => mint(c.id)}
              disabled={exists || busy !== null}
              title={exists ? t('pageui.hook.mint.exists_title', 'มี tool "{name}" อยู่แล้ว', { name: c.toolName }) : t('pageui.hook.mint.create_title', 'สร้าง tool "{name}" จาก env ของ server', { name: c.toolName })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === c.id ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {exists ? t('pageui.hook.mint.exists_btn', 'มีแล้ว ({name})', { name: c.toolName }) : `Mint ${c.label}`}
            </button>
          ) : (
            <button
              key={c.id}
              type="button"
              data-company={c.id}
              onClick={() => onPrefill(buildToolMintPreset(c, catalog))}
              title={t('pageui.hook.mint.prefill_title', 'env ยังไม่ครบ — เปิดฟอร์มพร้อมโครง: {fields}', { fields: [...c.missing, ...c.invalid].join(', ') })}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-300 bg-amber-50 text-amber-800 text-xs font-bold rounded-lg hover:bg-amber-100"
            >
              <Wand2 size={14} /> {t('pageui.hook.mint.prefill_btn', 'เติมโครง')} {c.label}
            </button>
          );
        })}
      </div>
      {catalog.companies.some((c) => !c.ready) && (
        <div className="mt-2 text-[11px] text-slate-500 space-y-0.5">
          {catalog.companies
            .filter((c) => !c.ready)
            .map((c) => (
              <div key={c.id}>
                {c.label}: {t('pageui.hook.mint.env_missing', 'env ขาด')} {c.missing.join(', ') || '-'}
                {c.invalid.length > 0 && ` · ${t('pageui.hook.mint.not_url', 'ไม่ใช่ URL')} ${c.invalid.join(', ')}`}
              </div>
            ))}
        </div>
      )}
      {result && (
        <div className={`mt-2 text-xs font-bold ${result.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{result.message}</div>
      )}
    </div>
  );
};
