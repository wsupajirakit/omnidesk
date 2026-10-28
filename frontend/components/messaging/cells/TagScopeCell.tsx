import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../../i18n';

import type { DynamicTagEntry, HookData } from '../../../types';

/**
 * [FEAT-20260830-TAGSCOPECELL] the OA column of the Dynamic Tags table.
 * ===========================================================================
 * Owner 30/08, with a screenshot: a tag bound to 15 groups printed all fifteen
 * names into one cell, so the column ran off the right edge of the screen and
 * pushed the row actions out of reach. Show a couple of names, then `+N`, and
 * put the full list behind a click.
 *
 * WHY ITS OWN FILE: `pages/messaging/DynamicTagList.tsx` is 1,002 lines and is
 * one of the names waived by the `max-lines` ratchet — that list may only
 * shrink. A new self-contained piece of UI belongs outside it from the start
 * (eslint.config.mjs max-lines rule).
 *
 * ⚠️ THE FOUR BRANCHES ARE THE PAGE'S OWN, MOVED VERBATIM. Which branch wins,
 *    the wording, the colours and the two-line layout are unchanged — the only
 *    new behaviour is the cap and the dialog. A characterization test freezes
 *    each branch's text so a later edit cannot quietly reword them.
 *
 * revert: delete this file + `TagScopeModal.tsx`, drop the export from
 *         `components/messaging/index.ts`, and paste the original <td> body
 *         back at the `[FEAT-20260728-TAGSCOPE]` comment in DynamicTagList.
 */

/** How many names the cell prints before it collapses the rest into `+N`.
 *  Two, because the `hook_ids` branch below already showed exactly two and the
 *  column should not have two different ideas of "a few". */
export const TAG_SCOPE_INLINE_LIMIT = 2;

export interface TagScopeCellProps {
  item: DynamicTagEntry;
  hooks: HookData[];
  /** the page owns group naming (it holds the visible-groups list) */
  groupName: (gid?: string) => string;
}

/** `+N` — the only new control in this cell. Rendered as a real button so it is
 *  reachable by keyboard; `stopPropagation` because table rows are clickable. */
const MoreButton: React.FC<{ n: number; onClick: () => void; tone: 'purple' | 'indigo' }> = ({
  n,
  onClick,
  tone,
}) => {
  const { t } = useI18n();
  return (
  <button
    type="button"
    data-testid="tag-scope-more"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className={`ml-1 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-black transition-colors ${
      tone === 'purple'
        ? 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300'
        : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300'
    }`}
    title={t('pageui.messaging.scope_see_all', 'ดูทั้งหมด')}
  >
    +{n}
  </button>
  );
};

export const TagScopeCell: React.FC<TagScopeCellProps> = ({ item, hooks, groupName }) => {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);

  const hookAlias = (id: string) => hooks.find((h) => h._id === id)?.alias || '?';
  const groupIds = item.group_ids ?? [];
  const hookIds = item.hook_ids ?? [];

  /* Branch 1 — bound to several groups. THIS is the one that overflowed. */
  if (groupIds.length > 0) {
    const shown = groupIds.slice(0, TAG_SCOPE_INLINE_LIMIT);
    const rest = groupIds.length - shown.length;
    return (
      <div className="flex flex-col min-w-0">
        <span className="flex items-center min-w-0 text-sm font-bold text-purple-700">
          <span className="truncate">
            👥 {groupIds.length > 1 ? t('pageui.messaging.scope_n_groups', '{n} กลุ่ม: ', { n: groupIds.length }) : ''}
            {shown.map((g) => groupName(g)).join(', ')}
          </span>
          {rest > 0 && <MoreButton n={rest} tone="purple" onClick={() => setShowAll(true)} />}
        </span>
        <span className="text-[10px] text-purple-500 truncate mt-0.5">
          {t('pageui.messaging.scope_whole_group', 'ทั้งกลุ่ม')}{hookIds.length > 0 ? t('pageui.messaging.scope_plus_oas', ' + ☑️ อีก {n} OA', { n: hookIds.length }) : ''}
        </span>
        {showAll && (
          <TagScopeModal
            tag={item.tag}
            groups={groupIds.map((g) => groupName(g))}
            oas={hookIds.map(hookAlias)}
            onClose={() => setShowAll(false)}
          />
        )}
      </div>
    );
  }

  /* Branch 2 — one whole group. One name, never long. Unchanged. */
  if (item.group_id) {
    return (
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-bold text-purple-700 truncate">👥 {groupName(item.group_id)}</span>
        <span className="text-[10px] text-purple-500 truncate mt-0.5">{t('pageui.messaging.scope_whole_group_all', 'ทั้งกลุ่ม (ทุก OA ในกลุ่ม)')}</span>
      </div>
    );
  }

  /* Branch 3 — a hand-picked set of OAs. It already capped at two and printed a
     bare `+N`; that number is now the same button as branch 1's, so the column
     does not have one clickable `+N` and one dead one. */
  if (hookIds.length > 0) {
    const shown = hookIds.slice(0, TAG_SCOPE_INLINE_LIMIT);
    const rest = hookIds.length - shown.length;
    return (
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-bold text-indigo-700 truncate">☑️ {t('pageui.messaging.scope_only_n_oas', 'เฉพาะ {n} OA', { n: hookIds.length })}</span>
        <span className="flex items-center min-w-0 text-[10px] text-indigo-500 mt-0.5">
          <span className="truncate">{shown.map(hookAlias).join(', ')}</span>
          {rest > 0 && <MoreButton n={rest} tone="indigo" onClick={() => setShowAll(true)} />}
        </span>
        {showAll && (
          <TagScopeModal
            tag={item.tag}
            groups={[]}
            oas={hookIds.map(hookAlias)}
            onClose={() => setShowAll(false)}
          />
        )}
      </div>
    );
  }

  /* Branch 4 — a single OA (or none). Unchanged. */
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-sm font-bold text-slate-900 truncate">
        {hooks.find((h) => h._id === item.hook_id)?.line_oa_name || '-'}
      </span>
      <span className="text-[10px] text-slate-700 truncate mt-0.5">
        {hooks.find((h) => h._id === item.hook_id)?.alias || 'System'}
      </span>
    </div>
  );
};

/**
 * The full-scope dialog behind `+N`.
 *
 * Deliberately shaped like the value/detail modal this page already owns
 * (`[FEAT-20260804-MERGECOL]`): same overlay, same rounded card, same header
 * with the tag on the left and an X on the right — a second visual language for
 * a second dialog on one page is noise.
 */
const TagScopeModal: React.FC<{
  tag: string;
  groups: string[];
  oas: string[];
  onClose: () => void;
}> = ({ tag, groups, oas, onClose }) => {
  const { t } = useI18n();
  return (
  <div
    data-testid="tag-scope-modal"
    className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-dark-950/60 backdrop-blur-sm animation-fade-in"
    onClick={onClose}
  >
    <div
      className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
        <span className="font-mono text-sm font-bold text-primary-600 truncate">[[{tag}]]</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close', 'ปิด')}
          className="p-1.5 rounded-lg text-slate-700 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X size={18} />
        </button>
      </div>
      {/* the list can be long — it scrolls inside the card, the page never does */}
      <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {groups.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1">
              {t('pageui.messaging.scope_groups_count', 'กลุ่ม ({n})', { n: groups.length })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((name, i) => (
                <span
                  key={`${name}-${i}`}
                  className="rounded-lg bg-purple-50 text-purple-700 border border-purple-200 px-2 py-1 text-xs font-bold dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}
        {oas.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1">
              OA ({oas.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {oas.map((alias, i) => (
                <span
                  key={`${alias}-${i}`}
                  className="rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-1 text-xs font-bold dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800"
                >
                  {alias}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
  );
};

export default TagScopeCell;
