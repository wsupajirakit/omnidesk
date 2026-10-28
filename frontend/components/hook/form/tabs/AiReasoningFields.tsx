import React from 'react';

import type { HookFormTabCtx } from './hookFormTabCtx';

/**
 * [FEAT-20260909-DSREASONING] The reasoning knobs, per vendor and per lane.
 * ===========================================================================
 * The owner's matrix, 09/09:
 *
 *                  main (replies + case summary)   translating
 *   Gemini         already exists, in HookAiTab    NEW, here
 *   DeepSeek       NEW, here                       NEW, here
 *
 * and *"summary uses the same one as the main bot"* — two lanes, not three.
 *
 * ## Its own file, deliberately
 *
 * `AiVendorSelect.tsx` is the "which vendor, and what does it need" file and is
 * already dense; `HookAiTab.tsx` is 1,080 lines and on the max-lines waiver,
 * which may only shrink, so nothing new may go there. This is the compliant
 * home and it keeps one concern per file.
 *
 * ## 🔴 THE STATE THAT DOES NOT EXIST ON THE OLD CONTROL
 *
 * The existing Gemini budget control has THREE states — off / dynamic / custom
 * — and treats a missing value as "off", because on that lane `null` and `0`
 * genuinely mean the same thing (the BE reads `budget ?? 0`).
 *
 * **Every field here has a FOURTH state: NOT SET.** On these columns `null` and
 * `0` are different requests: not-set sends no thinking instruction at all,
 * which is exactly what these lanes have always sent, while `0`/`disabled` is a
 * deliberate instruction to stop thinking. Collapsing them the way the old
 * control does would make every OA that never opened this box start sending a
 * field nobody chose — the one thing the owner ruled out, in as many words:
 * an OA on the main Gemini bot needs no backfill of any kind.
 *
 * ⚠️ So "Not set" is the FIRST option everywhere and its value is the empty
 *    string, which each handler turns into `null`. Never `''`, never `0`.
 *
 * ## What is measured rather than assumed
 *
 * `medium` is offered even though the vendor's documentation lists only
 * low/high/max: it was fired at the real API on 09/09 and answered normally.
 * And an effort chosen while thinking is Off is accepted and then IGNORED —
 * also measured — which is why the hint says so instead of the control
 * disabling itself and hiding the operator's choice.
 *
 * revert: delete this file and its three call sites in `AiVendorSelect.tsx`.
 */

/** Shared look, so these read as part of the vendor box they sit in.
 *
 * ⚠️ `rowClass` is why the group is not a tall stack. Each knob is one short
 *    select, and one per line made the DeepSeek box scroll for no reason —
 *    owner, 09/09: "กล่องยาวไป 2 กล่อง 1 แถวพอ". Two per row on anything wider
 *    than a phone; still one per row below that, where side-by-side selects are
 *    unreadable. */
const groupClass = 'md:col-span-2 mt-4 pt-3 border-t border-dark-700';
const rowClass = 'grid grid-cols-1 md:grid-cols-2 gap-4';
const groupTitleClass = 'block text-xs font-semibold text-slate-500 mb-2';
const labelClass = 'block text-sm font-medium text-slate-500 mb-1';
const hintClass = 'mt-1 text-xs text-slate-500/80';

/** `''` from a select is "not set" and must reach the API as null, never ''. */
const orNull = (v: string): string | null => (v === '' ? null : v);

/**
 * DeepSeek's pair — the switch and the effort — for ONE lane.
 *
 * @param lane `'main'` writes `deepseek_thinking` / `deepseek_reasoning_effort`;
 *   `'translate'` writes the `_translate` twins. The suffix is the only
 *   difference, and it is computed once here so no call site can name a column.
 */
export const DeepSeekReasoningFields: React.FC<{
  ctx: HookFormTabCtx;
  lane: 'main' | 'translate';
}> = ({ ctx, lane }) => {
  const { formData, setFormData, isViewMode, t, inputClass } = ctx;
  const suffix = lane === 'translate' ? '_translate' : '';
  const thinkingField = `deepseek_thinking${suffix}`;
  const effortField = `deepseek_reasoning_effort${suffix}`;

  /* Read the value AT EVENT TIME, not inside the updater. React resets a
     controlled select's DOM value before a later callback runs, so reading it
     in there can silently store null for a real choice — measured on the vendor
     select in this same folder. */
  const write = (field: string) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = orNull(e.target.value);
    setFormData((prev: Record<string, unknown>) => ({ ...prev, [field]: next }));
  };

  return (
    <div className={groupClass}>
      <span className={groupTitleClass}>
        {t(
          lane === 'translate'
            ? 'hook_form.reasoning_group_translate'
            : 'hook_form.reasoning_group_main',
        )}
      </span>

      <div className={rowClass}>
        <div>
          <label className={labelClass}>
            {t('hook_form.reasoning_thinking')}
          </label>
          <select
        disabled={isViewMode}
        name={thinkingField}
        value={(formData[thinkingField] as string) || ''}
        onChange={write(thinkingField)}
        className={inputClass(false, 'bg-white')}
      >
        <option value="">{t('hook_form.reasoning_unset')}</option>
        <option value="enabled">
          {t('hook_form.reasoning_thinking_enabled')}
        </option>
            <option value="disabled">
              {t('hook_form.reasoning_thinking_disabled')}
            </option>
          </select>
        </div>
        <div>
          <label className={labelClass}>
            {t('hook_form.reasoning_effort')}
          </label>
          <select
        disabled={isViewMode}
        name={effortField}
        value={(formData[effortField] as string) || ''}
        onChange={write(effortField)}
        className={inputClass(false, 'bg-white')}
      >
        <option value="">{t('hook_form.reasoning_unset')}</option>
        {/* FOUR values. `medium` is here on evidence, not on the documentation,
            which lists only the other three. */}
            {['low', 'medium', 'high', 'max'].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className={hintClass}>{t('hook_form.reasoning_effort_hint')}</p>
    </div>
  );
};

/**
 * Gemini's translate budget. Same units as the main-lane control in
 * `HookAiTab.tsx` — `-1` dynamic, `1..24576` explicit, `0` off — plus the
 * not-set state that control does not have.
 *
 * ⚠️ `0` IS OFFERED, and that is deliberate. The owner asked for this to behave
 *    the same way as `[HOTFIX-20260826-THINK36]`, which is what turns a `0` into
 *    whatever the model family actually accepts. A control that refused `0`
 *    would make the same number mean two different things in two boxes on one
 *    screen.
 */
export const GeminiTranslateBudgetField: React.FC<{ ctx: HookFormTabCtx }> = ({
  ctx,
}) => {
  const { formData, setFormData, isViewMode, t, inputClass } = ctx;
  const FIELD = 'gemini_thinking_budget_translate';
  const raw = formData[FIELD];
  const num = typeof raw === 'number' ? raw : null;
  const mode =
    num === null ? '' : num === 0 ? 'off' : num === -1 ? 'dynamic' : 'custom';

  const set = (value: number | null) =>
    setFormData((prev: Record<string, unknown>) => ({ ...prev, [FIELD]: value }));

  return (
    <div className={groupClass}>
      <span className={groupTitleClass}>
        {t('hook_form.reasoning_group_translate')}
      </span>
      <label className={labelClass}>
        {t('hook_form.reasoning_budget_translate')}
      </label>
      <select
        disabled={isViewMode}
        name={FIELD}
        value={mode}
        onChange={(e) => {
          const m = e.target.value;
          /* Read now, then decide — same rule as every other control here. */
          set(
            m === ''
              ? null
              : m === 'off'
                ? 0
                : m === 'dynamic'
                  ? -1
                  : /* keep a previous custom number rather than resetting the
                       operator's value when they toggle modes */
                    (num !== null && num > 0 ? num : 2048),
          );
        }}
        className={inputClass(false, 'bg-white')}
      >
        <option value="">{t('hook_form.reasoning_unset')}</option>
        <option value="off">{t('hook_form.reasoning_opt_off')}</option>
        <option value="dynamic">{t('hook_form.reasoning_opt_dynamic')}</option>
        <option value="custom">{t('hook_form.reasoning_opt_custom')}</option>
      </select>
      {mode === 'custom' && (
        <input
          type="number"
          min={1}
          max={24576}
          step={1}
          disabled={isViewMode}
          name={`${FIELD}_value`}
          value={num ?? 1}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            /* Clamped here as well as at the API: the BE refuses out-of-range,
               and an operator should not have to submit to find that out. */
            set(
              Number.isFinite(parsed)
                ? Math.max(1, Math.min(24576, parsed))
                : 1,
            );
          }}
          placeholder="1 - 24576"
          className={inputClass(false)}
        />
      )}
      <p className={hintClass}>{t('hook_form.reasoning_budget_hint')}</p>
    </div>
  );
};
