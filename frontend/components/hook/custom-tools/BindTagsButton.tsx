/**
 * [FEAT-20261016-TAGBIND] "ผูก tag" — one per tool row. Binds the server's template tags to every
 * OA that uses this tool (an unbound `[[ins_x_*]]` answers N/A silently) and shows what happened.
 *
 * The rules live on the server (omnidesk-api `hooks/tool-tag-bind/tag-bind-plan.ts`): add only,
 * follows the tool's real endpoints, never touches an admin's same-named / deleted / single-OA
 * tag. This button only asks and reports — change the report or the icon here, the rule there.
 *
 * 🔴 shop-api / older back end: no catalog ⇒ renders NOTHING (the row is byte-for-byte today's).
 * revert: delete this file and its line in `pages/hook/CustomTools.tsx` (+ the barrel export).
 */
import React, { useState } from 'react';
import { Loader2, Tags } from 'lucide-react';

import { AlertModal } from '../../modals';
import { translateNow, useI18n } from '../../../i18n';
import { bindToolTags, type TagBindReport } from '../../../services/hook/toolMint';
import { useToolMintCatalog } from './useToolMintCatalog';

const SKIP_REASON: Record<string, string> = {
  endpoint_absent: 'tool นี้ไม่มีเส้นที่ tag อ่าน',
  deleted: 'tag ถูกลบไปแล้ว (ชื่อยังถูกจอง)',
  not_template: 'เป็น tag ของแอดมินที่ชื่อซ้ำ — ไม่แตะ',
  single_oa: 'tag ตั้งแบบ OA เดี่ยว — ไม่เปลี่ยนโหมดให้',
};

const reportText = (r: TagBindReport): string =>
  [
    `tool: ${r.toolName} · ${translateNow('pageui.hook.bind.oa_using_tool', 'OA ที่ใช้ tool:')} ${r.hooks.length ? r.hooks.join(', ') : translateNow('pageui.hook.bind.none_yet', 'ยังไม่มี')}`,
    translateNow('pageui.hook.bind.summary', 'สร้าง tag ใหม่ {inserted} · ผูกเพิ่ม {bound} · ผูกครบแล้ว {already}', { inserted: r.inserted.length, bound: r.bound.length, already: r.already.length }),
    ...r.skipped.map((s) => translateNow('pageui.hook.bind.skip_line', 'ข้าม {tag}: {reason}', {
      tag: s.tag,
      reason: SKIP_REASON[s.reason] ? translateNow(`pageui.hook.bind.skip.${s.reason}`, SKIP_REASON[s.reason]) : s.reason,
    })),
  ].join('\n');

export const BindTagsButton: React.FC<{ toolId: string }> = ({ toolId }) => {
  const { t } = useI18n();
  const catalog = useToolMintCatalog();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ ok: boolean; text: string } | null>(null);
  if (!catalog) return null;

  const run = async () => {
    setBusy(true);
    try {
      const out = await bindToolTags(toolId);
      /* `in`, not `out.ok`: this repo's tsconfig is not strict, so a boolean tag does not narrow */
      setShown('report' in out ? { ok: true, text: reportText(out.report) } : { ok: false, text: out.message });
    } catch (e) {
      setShown({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-testid="bind-tags-btn"
        onClick={run}
        disabled={busy}
        title={t('pageui.hook.bind.button_title', 'ผูก tag ของ template กับ OA ที่ใช้ tool นี้')}
        className="p-1.5 rounded hover:bg-amber-50 text-amber-600 disabled:opacity-50"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Tags size={15} />}
      </button>
      <AlertModal
        isOpen={shown !== null}
        onClose={() => setShown(null)}
        title={shown?.ok ? t('pageui.hook.bind.done', 'ผูก tag แล้ว') : t('pageui.hook.bind.failed', 'ผูก tag ไม่สำเร็จ')}
        message={<span className="whitespace-pre-line">{shown?.text}</span>}
        type={shown?.ok ? 'success' : 'error'}
      />
    </>
  );
};
