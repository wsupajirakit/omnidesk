/**
 * [FEAT-20260805-HANDOFF-HOOKTAB] Per-hook creds editor — ONE component, TWO entry points.
 * Used by both the hook-edit Handoff tab (per hook, iterate targets) and the Handoff Targets
 * scope section (per target, iterate bound hooks). Both write to the SAME store —
 * POST/DELETE /api/handoff/overrides — so ค่าเดียวกันแต่ตั้งได้สองทาง (single source of truth).
 *
 * Self-contained: fetches its own (hook, target) override on mount, so either caller just drops
 * <HandoffHookCredsEditor hookId targetKey /> without threading state. web_code ไม่ต้องตั้ง:
 * Shop-API อ่านจาก hook (customer_link_web_code) เอง. secret_source='custom_tool' = แชร์ key จาก
 * custom tool ที่ hook ผูกไว้.
 */
import React, { useEffect, useState } from 'react';
import { KeyRound, Save, Loader2, Check, Info } from 'lucide-react';
import { handoffService, HandoffHookOverride } from '../../services/chat';
import { useI18n } from '../../i18n';

const AUTH_MODES = ['', 'hmac', 'bearer', 'apikey', 'basic']; // '' = inherit target's mode
type Draft = { endpoint_url: string; auth_mode: string; auth_secret: string; auth_password: string; secret_source: 'own' | 'custom_tool' };

interface Props {
  hookId: string;
  targetKey: string;
  /** @deprecated opt-4 removed — per-hook override is always own-typed. Kept so existing
   *  callers still compile; the flag is no longer read (see the key-source note below). */
  hasCustomTool?: boolean;
  targetEndpointHint?: string;
  compact?: boolean;         // tighter layout for the inline (HandoffTargets) placement
}

export const HandoffHookCredsEditor: React.FC<Props> = ({ hookId, targetKey, targetEndpointHint, compact }) => {
  const { t } = useI18n();
  const [ov, setOv] = useState<HandoffHookOverride | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState<Draft>({ endpoint_url: '', auth_mode: '', auth_secret: '', auth_password: '', secret_source: 'own' });

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    handoffService.listOverrides({ hook_id: hookId, target_key: targetKey })
      .then((rows) => {
        if (!alive) return;
        const row = rows.find((r) => r.target_key === targetKey) || null;
        setOv(row);
        setD({
          endpoint_url: row?.endpoint_url || '',
          auth_mode: row?.auth_mode || '',
          auth_secret: '', auth_password: '',
          secret_source: row?.secret_source === 'custom_tool' ? 'custom_tool' : 'own',
        });
      })
      .catch((e) => { if (alive) setError(e?.message || String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [hookId, targetKey]);

  const useOwn = !!ov && ov.enabled !== false;

  const patch = (p: Partial<Draft>) => setD((s) => ({ ...s, ...p }));

  // enabled=false via delete keeps the store clean; toggling on upserts an enabled row.
  const setEnabled = async (on: boolean) => {
    setSaving(true); setError(null);
    try {
      if (on) {
        const row = await handoffService.upsertOverride({ hook_id: hookId, target_key: targetKey, enabled: true, endpoint_url: d.endpoint_url, auth_mode: d.auth_mode, secret_source: d.secret_source });
        setOv(row);
      } else if (ov?._id) {
        await handoffService.deleteOverride(ov._id);
        setOv(null);
      }
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setSaving(false); }
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const body: any = { hook_id: hookId, target_key: targetKey, enabled: true, endpoint_url: d.endpoint_url, auth_mode: d.auth_mode, secret_source: d.secret_source };
      if (d.secret_source === 'own' && d.auth_secret) body.auth_secret = d.auth_secret; // blank = keep stored
      if (d.auth_password) body.auth_password = d.auth_password;
      const row = await handoffService.upsertOverride(body);
      setOv(row);
      setD((s) => ({ ...s, auth_secret: '', auth_password: '' }));
      setSaved(true); setTimeout(() => setSaved(false), 1600);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> {t('pageui.hookform.creds_loading', 'โหลด creds…')}</div>;

  return (
    <div className={`rounded-lg border ${useOwn ? 'border-primary-500/50 bg-primary-500/[0.05]' : 'border-slate-200 bg-white'} ${compact ? 'p-2.5' : 'p-3'} space-y-2.5`}>
      {error && <div className="p-2 rounded bg-red-50 border border-red-200 text-red-600 text-xs">{error}</div>}

      {/* shared / own toggle */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold ${useOwn ? 'text-slate-400' : 'text-emerald-600'}`}>shared</span>
        <button type="button" disabled={saving} onClick={() => setEnabled(!useOwn)}
          className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-50 ${useOwn ? 'bg-primary-500' : 'bg-slate-300'}`}
          title={useOwn ? t('pageui.hookform.creds_own_back_tip', 'ใช้ creds ตัวเอง — คลิกเพื่อกลับไป shared') : t('pageui.hookform.creds_use_own', 'ใช้ creds ตัวเอง')}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow flex items-center justify-center transition-transform ${useOwn ? 'translate-x-6' : ''}`}>
            {saving ? <Loader2 size={11} className="animate-spin text-slate-400" /> : <KeyRound size={11} className={useOwn ? 'text-primary-600' : 'text-slate-400'} />}
          </span>
        </button>
        <span className={`text-xs font-bold ${useOwn ? 'text-primary-600' : 'text-slate-400'}`}>{t('pageui.hookform.creds_own', 'creds ตัวเอง')}</span>
      </div>

      {useOwn && (
        <>
          <p className="text-xs text-slate-500">{t('pageui.hookform.creds_blank_hint', 'เว้นว่าง = ใช้ค่าจาก target หลัก (path/domain เดียวกัน ต่างแค่ creds). secret เว้นว่าง = ไม่แตะของเดิม.')}</p>

          {/* [FEAT-20260806-CHAIN] Key source is ALWAYS own-typed here — the opt-4 toggle
              ("share custom_tool key" per hook) was removed as redundant. Sharing the custom_tool
              key is the MAIN target's option (secret_source='custom_tool' on the target), not a
              per-hook re-pick. The resolver still HONORS a legacy custom_tool override on read
              (backward-safe) — we just no longer offer it as a NEW choice. เหลือ own อย่างเดียว. */}
          {d.secret_source === 'custom_tool' && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <Info size={12} /> {t('pageui.hookform.creds_legacy', 'legacy: override นี้ใช้ key จาก custom tool — ตั้ง/ย้ายที่ target หลักแทน')}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <label className="block">
              <span className="text-xs font-bold text-slate-600">endpoint URL <span className="text-slate-400">{t('pageui.hookform.creds_blank_uses_target', '(เว้น = ใช้ของ target)')}</span></span>
              <input value={d.endpoint_url} onChange={(e) => patch({ endpoint_url: e.target.value })}
                placeholder={targetEndpointHint || 'https://…'} className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 placeholder-slate-400 font-mono focus:ring-2 focus:ring-primary-500/40 outline-none" />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-600">auth mode</span>
              <select value={d.auth_mode} onChange={(e) => patch({ auth_mode: e.target.value })}
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500/40 outline-none">
                {AUTH_MODES.map((m) => <option key={m || 'inherit'} value={m}>{m || t('pageui.hookform.creds_inherit', '— inherit จาก target —')}</option>)}
              </select>
            </label>
            {d.secret_source === 'own' && (
              <label className="block">
                <span className="text-xs font-bold text-slate-600">secret / API key {ov?.has_auth_secret && <span className="text-emerald-600">{t('pageui.hookform.creds_set', '· ตั้งไว้แล้ว')}</span>}</span>
                <input type="password" autoComplete="new-password" value={d.auth_secret} onChange={(e) => patch({ auth_secret: e.target.value })}
                  placeholder={ov?.has_auth_secret ? t('pageui.hookform.creds_keep_ph', '•••••• (เว้น = คงเดิม)') : t('pageui.hookform.creds_secret_ph', 'กรอก secret')} className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 placeholder-slate-400 font-mono focus:ring-2 focus:ring-primary-500/40 outline-none" />
              </label>
            )}
            <label className="block">
              <span className="text-xs font-bold text-slate-600">password <span className="text-slate-400">(basic)</span> {ov?.has_auth_password && <span className="text-emerald-600">{t('pageui.hookform.creds_set', '· ตั้งไว้แล้ว')}</span>}</span>
              <input type="password" autoComplete="new-password" value={d.auth_password} onChange={(e) => patch({ auth_password: e.target.value })}
                placeholder={ov?.has_auth_password ? t('pageui.hookform.creds_keep_ph', '•••••• (เว้น = คงเดิม)') : t('pageui.hookform.creds_password_ph', 'กรอก password')} className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 placeholder-slate-400 font-mono focus:ring-2 focus:ring-primary-500/40 outline-none" />
            </label>
          </div>

          {d.auth_mode === 'hmac' && (
            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-sky-50 border border-sky-200 text-sky-800 text-xs">
              <Info size={13} className="mt-0.5 shrink-0" />
              <span><b>web_code</b> {t('pageui.hookform.creds_hmac_a', 'ดึงจาก hook นี้อัตโนมัติ (ตั้งแยกไม่ได้ตามสเปค Shop-API) — ตรงนี้ตั้งได้แค่')} <b>secret</b> {t('pageui.hookform.creds_hmac_b', '(+ endpoint ถ้าต่าง).')}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="button" disabled={saving} onClick={save}
              className="px-2.5 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {t('pageui.hookform.creds_save', 'บันทึก creds')}
            </button>
            {saved && <span className="text-emerald-600 text-xs flex items-center gap-1"><Check size={14} /> {t('pageui.hookform.creds_saved', 'บันทึกแล้ว')}</span>}
          </div>
        </>
      )}
    </div>
  );
};

export default HandoffHookCredsEditor;
