/**
 * [FIX-20260907-DEADCONDWARN] The conditions are still here — they just will not
 * narrow this send.
 * ===========================================================================
 * WHAT AN ADMIN SEES WITHOUT THIS. They set audience conditions under Multicast,
 * switch the send method to Broadcast, and the entire conditions block
 * disappears from the screen. Nothing is said. The rules are NOT cleared —
 * `[FIX-20260825-CONDMULTICASTONLY]` in `BroadcastFormModal.tsx` states that
 * keeping them is deliberate, so switching back restores them — but they are
 * also no longer applied, because `/message/broadcast` carries no recipient list
 * and LINE fans the message out to every follower of the channel.
 *
 * 🔴 THE WARNING FOR THIS ALREADY EXISTED AND WAS UNREACHABLE. It was written on
 *    23/08 and rendered under `rules.length > 0 && send_kind !== 'multicast'` —
 *    but it sat INSIDE the `send_kind === 'multicast'` block, so its two
 *    conditions contradicted each other and it never appeared once. No test
 *    asserted that it rendered, which is why nothing caught it. This component
 *    exists so the sentence lives somewhere it can actually be seen, and it
 *    reuses the same copy key rather than inventing a fifth translation of the
 *    same fact.
 *
 * 🔴 IT EXPLAINS, IT DOES NOT ENFORCE. The backend refuses a save that MOVES a
 *    job into this state (`broadcast-send/audience-on-broadcast.policy.ts`) and
 *    deliberately still allows editing a job already in it. This notice covers
 *    the case the server permits — a stored job being edited — where a silent
 *    screen is the whole problem.
 *
 * ⚠️ DO NOT CLEAR THE RULES FROM HERE. They are the admin's work, and clearing
 *    them automatically would destroy it the moment somebody flips the send
 *    method to look at the options. The button offers the choice; it does not
 *    take it.
 *
 * revert: delete this file and its one use in `BroadcastFormModal.tsx`.
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';

import { useI18n } from '../../../i18n';

export interface AudienceKeptNoticeProps {
  /** The conditions currently stored on the form. */
  readonly rules?: readonly unknown[];
  /** `'broadcast'` | `'multicast'` | null — whatever is selected right now. */
  readonly sendKind?: string | null;
  /** Drop the conditions. Offered, never done automatically. */
  readonly onClear?: () => void;
  readonly disabled?: boolean;
}

/**
 * Should the notice appear at all?
 *
 * Exported so a test can drive the rule directly, and so the condition lives in
 * one place rather than being restated in JSX.
 *
 * ⚠️ `!== 'multicast'` rather than `=== 'broadcast'` ON PURPOSE. A job saved
 *    before 23/08 carries no `send_kind` at all and runs on the legacy sender,
 *    which never reads `target` either (`broadcast-legacy-send.util.ts` reads
 *    only `_id`, `message`, `hook_ids`, `sent_at`). Those jobs have exactly the
 *    same problem, so they get exactly the same sentence.
 */
export const shouldShowAudienceKept = (
  rules: readonly unknown[] | undefined,
  sendKind: string | null | undefined,
): boolean => (rules?.length ?? 0) > 0 && sendKind !== 'multicast';

export const AudienceKeptNotice: React.FC<AudienceKeptNoticeProps> = ({
  rules,
  sendKind,
  onClear,
  disabled = false,
}) => {
  const { t } = useI18n();
  if (!shouldShowAudienceKept(rules, sendKind)) return null;

  return (
    <div
      data-testid="audience-kept-notice"
      className="mt-3 rounded-xl border border-amber-400 bg-amber-50 p-3 dark:bg-amber-500/10"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="min-w-0">
          {/* The 23/08 copy, reused verbatim — it is already translated into
              th / en / zh and it still says exactly the right thing. */}
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            {t('broadcast.audience_needs_multicast')}
          </p>
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
            {t('broadcast.audience_kept_hint', {
              count: rules?.length ?? 0,
            })}
          </p>
          {onClear && (
            <button
              type="button"
              data-testid="audience-clear-rules"
              onClick={onClear}
              disabled={disabled}
              className="mt-2 rounded-lg border border-amber-500 px-3 py-1 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:text-amber-300"
            >
              {t('broadcast.audience_clear_rules')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AudienceKeptNotice;
