/**
 * [FEAT-20260822-NOTICEMODE] The notice tab — the screening cards for
 * "deposit / withdraw is closed right now".
 * ===========================================================================
 * WHAT IT WRITES: seven hook columns (two toggles + the follower switch, two
 * scopes, six card bindings). WHAT IT DOES NOT: touch anything the main form
 * saves.
 *
 * ⭐ IT SAVES ITSELF, ON ITS OWN ROUTE, WITH ITS OWN BUTTON.
 * `PUT /hook/:id` DROPS these fields on purpose (they are not in
 * `ALLOWED_UPDATES` — that list's 400 text is golden-pinned against legacy),
 * so the only way to write them is `PUT /hook/notice/:id`. Wiring them into
 * the modal's own submit would mean a second request hidden inside the first,
 * with two ways to fail and one button: the owner's rule for this mode is
 * "แยก path ใหม่ ห้ามกระทบของเดิม", so the separation is visible in the UI too.
 * ⚠️ THE COST, SAID OUT LOUD: an admin who edits here and presses the modal's
 * main Save has NOT saved these. That is why the unsaved marker below is loud
 * and sits next to the button. ปุ่มบันทึกของแท็บนี้แยกจากปุ่มหลัก.
 *
 * D16 (owner): a toggle cannot be ON without every card that side needs. The
 * modal warns BEFORE the request — `noticeCardGate.ts` mirrors the back end's
 * rule — and the server's 400 is the backstop, never the first line of defence.
 *
 * revert: delete this file, its import + tab button + render line in
 * HookFormModal.tsx, and the two service methods it calls.
 */
import React, { useRef, useEffect, useMemo, useState } from 'react';

import { noticeIsDirty, noticeSnapshot } from '../../../../utils/noticeUnsaved';
import { BellRing, AlertTriangle, Save, Loader2 } from 'lucide-react';
// [FEAT-20260824-NOTICECASEINFO] the A–F chips + reference modal (own file, §6.1)
import {
  CASE_OF_CARD,
  CaseChip,
  NoticeCaseInfoModal,
} from '../NoticeCaseInfoModal';

import type { HookFormTabCtx } from './hookFormTabCtx';
import {
  NOTICE_CARD_PAIRS,
  NOTICE_FORM_FIELDS,
  noticeCardViolations,
  readScope,
  type NoticeCardPair,
} from '../noticeCardGate';
import { webhookService } from '../../../../services/hook';
import { useI18n } from '../../../../i18n';

/** the card list an admin may pick from — the real notice cards are `custom`
 *  (verified against the four the owner created: DEPWARN / WITHWARN /
 *  DEPWITHOFFSERVICE / DEPWITHWARN). A value already bound is always shown even
 *  if its type is something else, so an existing binding can never be hidden —
 *  or silently replaced by the empty option. ค่าเดิมต้องเห็นเสมอ. */
const CARD_TYPE = 'custom';

/* ⚠️ LITERAL KEYS, NOT `t(`hook_form.notice_scope_${s}`)`. The repo's i18n
   coverage test only sees keys written as plain quoted strings, so a key reached
   through a backtick is unguarded — and `t()` answers with the KEY ITSELF when a
   translation is missing, which puts `hook_form.notice_scope_slip` on screen
   instead of a label. Same trap the clone modal hit on 22/08.
   คีย์ต้องเป็นสตริงตรง ๆ ไม่งั้นเทสมองไม่เห็น และคำแปลหายแบบเงียบ ๆ. */
const SCOPE_KEYS = {
  text: 'hook_form.notice_scope_text',
  all: 'hook_form.notice_scope_all',
  slip: 'hook_form.notice_scope_slip',
} as const;
const SCOPES = ['text', 'all', 'slip'] as const;

export function HookNoticeTab({
  ctx,
}: {
  ctx: HookFormTabCtx;
}): React.ReactElement {
  const { formData, setFormData, isViewMode, t, inputClass, flexTemplates } =
    ctx;
  // ctx `t` is (key, vars) — a Thai fallback needs the real i18n `t`
  const i18n = useI18n();
  const hookId = ctx.hookId;
  const [saving, setSaving] = useState(false);
  /* [FEAT-20260829-NOTICEUNSAVED] the main save scrolls this into view before flashing it */
  const saveBtnRef = useRef<HTMLButtonElement | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  // [FEAT-20260824-NOTICECASEINFO]
  const [caseInfoOpen, setCaseInfoOpen] = useState(false);
  /* [FEAT-20260829-NOTICEUNSAVED] the snapshot lives on the FORM now.
     🔴 It used to be `useState` here, and this tab unmounts on every tab switch
        (`activeTab === 'notice' && <HookNoticeTab/>`), so coming back re-seeded it
        from the current form and the marker announced "saved" for a change that
        had never been sent. A ref on the parent survives that, and lets the main
        save ask the same question while this tab is not mounted at all.
     ⚠️ Seeded on FIRST mount only (`null` = never opened). Re-seeding on every
        mount is exactly the bug being fixed. */
  const savedRef = ctx.noticeSavedRef;
  if (savedRef.current === null) savedRef.current = noticeSnapshot(formData);
  const savedSnapshot = savedRef.current;
  const setSavedSnapshot = (v: string) => {
    savedRef.current = v;
  };

  /* [FEAT-20260829-NOTICEUNSAVED] the main save bumps this to point here. */
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!ctx.noticeFlash) return;
    setFlashing(true);
    /* ⚠️ optional-call, not just optional-chain: `scrollIntoView` is absent in
       jsdom, and a throw here would kill the whole effect — the flash would never
       be set and the guard would point at nothing. */
    saveBtnRef.current?.scrollIntoView?.({ block: 'center' });
    const t = setTimeout(() => setFlashing(false), 2400);
    return () => clearTimeout(t);
  }, [ctx.noticeFlash]);

  const violations = useMemo(
    () => noticeCardViolations(formData as Record<string, unknown>),
    [formData],
  );
  /* the SAME rule the main save asks, so the marker and the guard cannot disagree */
  const dirty = noticeIsDirty(savedSnapshot, formData);

  const setField = (name: string, value: unknown) => {
    if (isViewMode) return;
    setFormData((prev: Record<string, unknown>) => ({
      ...prev,
      [name]: value,
    }));
  };

  const doSave = async (over: Record<string, unknown> = {}) => {
    if (!hookId) return;
    const fields = { ...pickNotice(formData), ...over };
    setSaving(true);
    try {
      await webhookService.updateHookNotice(hookId, fields);
      setFormData((prev: Record<string, unknown>) => ({ ...prev, ...over }));
      setSavedSnapshot(JSON.stringify({ ...pickNotice(formData), ...over }));
      ctx.setToast({ message: t('hook_form.notice_saved'), type: 'success' });
      setGateOpen(false);
    } catch (e: any) {
      /* the BE's own words: it names the side and the card that is missing, and
         it is the authority — never swallow it behind a generic message. */
      ctx.setToast({
        message: e?.message || t('hook_form.notice_save_failed'),
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const onSaveClick = () => {
    if (violations.length > 0) {
      setGateOpen(true); // D16 — warn first, the 400 is only the backstop
      return;
    }
    void doSave();
  };

  /** the "turn off what is not ready, then save" way out of the gate modal. */
  const disableIncomplete = () => {
    const off: Record<string, unknown> = {};
    violations.forEach((v) => {
      off[v.status] = false;
    });
    void doSave(off);
  };

  const cardSelect = (pair: NoticeCardPair) => {
    const value = (formData as Record<string, unknown>)[pair.flex];
    const current = value ? String(value) : '';
    const list = flexTemplates.filter(
      (tpl: any) => tpl.flex_type === CARD_TYPE || tpl.id === current,
    );
    const missing = violations.some((v) => v.flex === pair.flex);
    return (
      <div key={pair.flex}>
        <label className="block text-sm font-medium text-slate-500 mb-1">
          {t(pair.labelKey)}
          {/* [FEAT-20260824-NOTICECASEINFO] which runtime case this card answers */}
          <CaseChip id={CASE_OF_CARD[pair.flex] ?? ''} />
          {missing && <span className="ml-1 text-rose-500">*</span>}
        </label>
        <select
          disabled={isViewMode}
          name={pair.flex}
          value={current}
          onChange={(e) => setField(pair.flex, e.target.value || null)}
          className={inputClass(missing, 'bg-white')}
        >
          <option value="">{t('common.none')}</option>
          {list.map((tpl: any) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
            </option>
          ))}
        </select>
      </div>
    );
  };

  const toggle = (name: string, label: string, hint?: string) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        disabled={isViewMode}
        checked={(formData as Record<string, unknown>)[name] === true}
        onChange={(e) => setField(name, e.target.checked)}
        className="accent-primary-500 rounded mt-0.5"
      />
      <span>
        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
          {label}
        </span>
        {hint && (
          <span className="block text-[11px] text-slate-500">{hint}</span>
        )}
      </span>
    </label>
  );

  /**
   * [LOCK-20260823-WITHDRAWSCOPE] The withdraw side offers ONE value: `text`.
   *
   * WHY — `notice_withdraw_scope` decides nothing. The notice runtime reads a
   * single scope column and it is the deposit one:
   *   notice-context.ts:54   depositScope: readNoticeScope(hook['notice_deposit_scope'])
   * `NoticeContext` has no field a withdraw scope could even occupy
   * (cases/notice-case.types.ts:32 — `depositScope` is the only Scope there), and
   * the two slip cases gate on the DEPOSIT switch as well as the deposit scope:
   *   case-e-all-offtime.ts:29-30 / case-f-all-disable.ts:29-30
   *     ctx.depositOn && ctx.depositScope === 'slip'
   * A repo-wide grep finds `notice_withdraw_scope` in exactly three places, all
   * metadata: the column (hook.schema.ts:355), the writable list
   * (notice-settings.fields.ts:48) and the tab map (hook-field-tabs.ts:208).
   *
   * ⚠️ THE WITHDRAW SIDE ITSELF WORKS — cases C and D fire on text events and
   * read no scope at all (case-c:14-18, case-d:15-19). Only `all` and `slip`
   * are inert here, and offering them let an operator pick a value that quietly
   * did nothing. ฝั่งถอนทำงานปกติกับ text · แค่ all/slip ที่ไม่มีผล
   *
   * 🔜 OPEN, owner 23/08: "all slip ของถอนค่อยว่ากัน" — the runtime for those two
   * is a later decision, not a defect. When it is built, delete `lockedTo` at the
   * call site below and the two values come back with nothing else to restore.
   * Full evidence: omnidesk-api todo/task/23082026/todo18_23082026_notice-slip-deposit-only.md
   *
   * revert: drop the `lockedTo` argument and this note.
   */
  const scopeSelect = (
    name: string,
    label: string,
    hint?: string,
    /** When set, the ONLY value on offer — create and edit alike. */
    lockedTo?: (typeof SCOPES)[number],
  ) => (
    <div>
      <label className="block text-sm font-medium text-slate-500 mb-1">
        {label}
      </label>
      <select
        disabled={isViewMode}
        name={name}
        /* A locked select shows the locked value even if the row carries
           something else, so what is on screen is what a save would write. */
        value={lockedTo ?? readScope((formData as Record<string, unknown>)[name])}
        onChange={(e) => setField(name, e.target.value)}
        className={inputClass(false, 'bg-white')}
      >
        {(lockedTo ? [lockedTo] : SCOPES).map((s) => (
          <option key={s} value={s}>
            {t(SCOPE_KEYS[s])}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-slate-500/80">{hint}</p>}
    </div>
  );

  const depositPairs = NOTICE_CARD_PAIRS.filter(
    (p) => p.status === 'notice_deposit_status' && !p.whenScope,
  );
  const slipPairs = NOTICE_CARD_PAIRS.filter((p) => p.whenScope);
  const withdrawPairs = NOTICE_CARD_PAIRS.filter(
    (p) => p.status === 'notice_withdraw_status',
  );
  const slipMode =
    readScope((formData as Record<string, unknown>).notice_deposit_scope) ===
    'slip';

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-3">
        <BellRing className="text-amber-600 shrink-0 mt-0.5" size={18} />
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {t('hook_form.notice_intro')}
        </p>
      </div>

      {/* [FEAT-20260824-NOTICECASEINFO] the big reference button — owner: "ปุ่ม
          info ใหญ่บนสุดบอกว่าแต่ละเคสทำอะไร เงื่อนไขอะไร" */}
      <button
        type="button"
        onClick={() => setCaseInfoOpen(true)}
        className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary-300 dark:border-primary-700 bg-primary-50/60 dark:bg-primary-900/20 px-4 py-3 text-sm font-bold text-primary-700 dark:text-primary-300 hover:bg-primary-100/70 dark:hover:bg-primary-900/40 transition-colors"
      >
        <span className="text-base">ℹ️</span>
        {i18n.t('pageui.hookform.notice_info_button', 'เคส A–F คืออะไร ยิงเมื่อไหร่ — กดดูเงื่อนไขทุกเคส + ชื่อคอลัมน์จริง')}
      </button>
      <NoticeCaseInfoModal open={caseInfoOpen} onClose={() => setCaseInfoOpen(false)} />

      {/* [FEAT-20260829-NOTICEUNSAVED] the tab's own save row, moved UP to sit
          directly under the case-reference button — owner 29/08.
          🔴 It used to be the LAST thing on a tab that is taller than the screen,
             so the one control that actually stores these settings, and the only
             notice that they are still pending, were both below the fold. The
             main save button at the top of the dialog was in plain sight and
             saves a DIFFERENT route, which is exactly how the two got confused.
          ⚠️ `data-testid` is what the spec finds; the class list carries the
             flash, so both must stay on this button. */}
      <div
        className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${
          flashing
            ? 'border-rose-400 bg-rose-50/70 dark:border-rose-500 dark:bg-rose-900/20'
            : 'border-slate-200 dark:border-slate-700'
        }`}
        data-testid="notice-save-row"
      >
        <div className="text-xs">
          {violations.length > 0 ? (
            <span className="text-rose-600 font-bold">
              {t('hook_form.notice_incomplete_count', {
                count: violations.length,
              })}
            </span>
          ) : dirty ? (
            <span className="text-amber-600 font-bold">
              {t('hook_form.notice_unsaved')}
            </span>
          ) : (
            <span className="text-slate-400">{t('hook_form.notice_synced')}</span>
          )}
        </div>
        <button
          ref={saveBtnRef}
          type="button"
          disabled={isViewMode || saving || !hookId}
          onClick={onSaveClick}
          data-testid="notice-save-button"
          className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 disabled:opacity-50 ${
            flashing ? 'notice-save-flash ring-4 ring-rose-400' : ''
          }`}
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {t('hook_form.notice_save')}
        </button>
      </div>

      {!hookId && (
        <p className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-xs text-slate-600 dark:text-slate-300">
          {t('hook_form.notice_needs_saved_hook')}
        </p>
      )}

      <section className="space-y-3">
        <h4 className="font-bold text-slate-700 dark:text-slate-200">
          {t('hook_form.notice_section_deposit')}
        </h4>
        {toggle(
          'notice_deposit_status',
          t('hook_form.notice_deposit_status'),
          t('hook_form.notice_deposit_hint'),
        )}
        {/* [FEAT-20260823-NOTICECHECKFLAGS] the two wrap-flags of this side.
            They do not alter any condition — they decide whether the condition
            is READ at all. Absent on old rows = ON (the BE reader is `!== false`);
            the form state is normalised to a real boolean in HookFormModal's
            initialData mapping, so the shared `toggle()` (`=== true`) renders
            them correctly. ปิด = การ์ดกลุ่มนั้นของฝั่งนี้เงียบ · เงื่อนไขเดิมไม่ถูกแตะ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
          {toggle(
            'notice_deposit_time_check',
            t('hook_form.notice_time_check'),
            t('hook_form.notice_time_check_hint'),
          )}
          {toggle(
            'notice_deposit_sitestatus_check',
            t('hook_form.notice_sitestatus_check'),
            t('hook_form.notice_sitestatus_check_hint'),
          )}
          {/* [FEAT-20260829-STATUSFIRST] the night-window preference switch.
              🔴 OPPOSITE polarity from the two flags above: those are absent=ON
                 (they gate whether a check is read), this one is absent=OFF —
                 default off was the owner's explicit order. The shared
                 `toggle()` (`=== true`) renders default-off correctly with no
                 normalisation needed. */}
          {toggle(
            'notice_deposit_sitestatus_first',
            t('hook_form.notice_sitestatus_first'),
            t('hook_form.notice_sitestatus_first_hint'),
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scopeSelect(
            'notice_deposit_scope',
            t('hook_form.notice_deposit_scope'),
            t('hook_form.notice_scope_hint'),
          )}
          {depositPairs.map(cardSelect)}
        </div>
        {slipMode && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <p className="md:col-span-2 text-[11px] text-slate-500">
              {t('hook_form.notice_slip_cards_hint')}
            </p>
            {slipPairs.map(cardSelect)}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="font-bold text-slate-700 dark:text-slate-200">
          {t('hook_form.notice_section_withdraw')}
        </h4>
        {toggle('notice_withdraw_status', t('hook_form.notice_withdraw_status'))}
        {/* [FEAT-20260823-NOTICECHECKFLAGS] same pair, withdraw side — see the
            deposit note above. E/F (slip) ride the DEPOSIT flags, not these. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
          {toggle(
            'notice_withdraw_time_check',
            t('hook_form.notice_time_check'),
            t('hook_form.notice_time_check_hint'),
          )}
          {toggle(
            'notice_withdraw_sitestatus_check',
            t('hook_form.notice_sitestatus_check'),
            t('hook_form.notice_sitestatus_check_hint'),
          )}
          {/* [FEAT-20260829-STATUSFIRST] withdraw mirror — see the deposit side. */}
          {toggle(
            'notice_withdraw_sitestatus_first',
            t('hook_form.notice_sitestatus_first'),
            t('hook_form.notice_sitestatus_first_hint'),
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* [LOCK-20260823-WITHDRAWSCOPE] locked to `text` — see the note on
              scopeSelect for why, and what to delete when it is unlocked. */}
          {scopeSelect(
            'notice_withdraw_scope',
            t('hook_form.notice_withdraw_scope'),
            t('hook_form.notice_withdraw_scope_hint'),
            'text',
          )}
          {withdrawPairs.map(cardSelect)}
        </div>
      </section>

      {/* [HIDE-20260823-FOLLOWERSWITCH] The Follower switch is hidden, not deleted.
         *
         * WHY IT IS HIDDEN — it controls nothing. `follow_player_status` is written
         * to the hook and then read by NOBODY: a grep across the whole back end
         * returns four hits and all four are metadata, never a decision —
         *   hooks/schemas/hook.schema.ts:405            declares the column
         *   hooks/hook-field-tabs.ts:210                says it lives on this tab
         *   hooks/notice-settings/notice-settings.fields.ts:43,78  lists it as
         *                                               writable, and notes it owns
         *                                               no card on purpose
         * Showing an operator a switch that changes nothing is worse than showing
         * nothing: they flip it, the save succeeds, and they believe a customer is
         * now being followed.
         *
         * WHAT DOES THE JOB INSTEAD — the two deposit/withdraw switches, directly.
         * The notice runtime reads exactly those two and no others
         * (webhook/notice-runtime/notice-context.ts:52-53):
         *   notice_deposit_status  → ctx.depositOn
         *   notice_withdraw_status → ctx.withdrawOn
         * and every follow-up stamp on the member is written off them:
         *   case-a/b  depositOn                   → follow_up.line.notice_deposit_at
         *   case-c/d  withdrawOn                  → follow_up.line.notice_withdraw_at
         *   case-e/f  depositOn + scope 'slip'    → follow_up.line.notice_payment_at
         * So "following a player" is already fully expressed by those two toggles.
         *
         * WHY NOT DELETE IT — the column exists on live hook rows, its write route
         * (PUT /hook/notice/:id) accepts it, and the clone pair-drag carries it.
         * Removing the field is a back-end decision with data behind it; removing
         * the CONTROL is not. The owner's own 22/08 spec parked the runtime for
         * this switch as "Phase 3 🛑 ล็อกจนกว่า D1-D3 จะถูกตอบ"
         * (todo/task/22082026/todo5_22082026_hook-notice-follow-settings.md:153) —
         * hidden is the honest state until that phase is answered.
         *
         * TO BRING IT BACK: delete this comment and the `false &&` below. The
         * strings, the toggle helper and the form state are all still wired, so it
         * renders exactly as before with nothing else to restore.
         * ซ่อนไว้ก่อน ไม่ได้ลบ — ค่ายังอยู่ใน DB และเส้นเขียนยังรับอยู่ */}
      {false && (
        <section className="space-y-3">
          <h4 className="font-bold text-slate-700 dark:text-slate-200">
            {t('hook_form.notice_section_follower')}
          </h4>
          {toggle(
            'follow_player_status',
            t('hook_form.follow_player_status'),
            t('hook_form.follow_player_hint'),
          )}
        </section>
      )}

      {gateOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-amber-200 bg-amber-50 dark:bg-amber-900/20">
              <AlertTriangle className="text-amber-600" size={18} />
              <h3 className="font-bold text-slate-800 dark:text-slate-100">
                {t('hook_form.notice_gate_title')}
              </h3>
            </div>
            <div className="p-5 space-y-3 text-sm text-slate-700 dark:text-slate-300">
              <p>{t('hook_form.notice_gate_body')}</p>
              <ul className="space-y-1">
                {violations.map((v) => (
                  <li key={v.flex} className="flex gap-2">
                    <span className="text-rose-500">•</span>
                    <span>{t(v.labelKey)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setGateOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-bold"
              >
                {t('hook_form.notice_gate_back')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={disableIncomplete}
                className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 disabled:opacity-50"
              >
                {t('hook_form.notice_gate_disable')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** only this mode's fields — the request body is never the whole form. */
function pickNotice(form: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  NOTICE_FORM_FIELDS.forEach((f) => {
    if (f in form) out[f] = form[f];
  });
  return out;
}
