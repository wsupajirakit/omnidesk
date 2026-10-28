import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, X } from 'lucide-react';

import { useI18n } from '../../../i18n';
/* [FEAT-20260827-ADMINBLOCK] the same consent pair the webhook delete uses —
   reused, not reinvented (ConfirmConsentCheck's header is the reasoning). */
import ConfirmConsentCheck from '../../modals/ConfirmConsentCheck';
import { ConfirmModal } from '../../modals/ConfirmModal';
import strikeService, {
  type StrikeSessionView,
  type SuspendPolicy,
} from '../../../services/strike/strikeService';

/**
 * [FEAT-20260826-STRIKESUSPEND] One customer's strike record, on demand.
 * ===========================================================================
 * 📖 PLAN: `omnidesk-api/todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * Owner, 26/08: the profile picture in the right-hand panel opens a modal that
 * shows the sessions and the total, says how many strikes this session has and
 * how many are left before the bot goes quiet, prints that number in dark red
 * once it is reached, and offers a button to clear the session.
 *
 * ⚠️ OPENING IS ALWAYS ALLOWED; CLEARING IS NOT. Owner, later the same day:
 * *"avatar panel ขวากดดูสถิติ strike ได้ตลอดนะไม่ต้องรอแดง แต่ปุ่มเคลียร์ต้องรอแดงก่อน"*.
 * So the modal opens for anybody — a customer at 0 strikes included — and the
 * clear button appears only once they are actually locked. Two separate
 * conditions, deliberately not folded into one.
 *
 * ⚠️ THE THRESHOLD COMES FROM THE SERVER, ALWAYS. `policy.suspend_at` is read
 * from the same response, never hardcoded and never mirrored in a constant here.
 * If the dashboard owned that number, changing `STRIKE_SUSPEND_AT` on the server
 * would make this screen quietly lie, and no test on either side would fail
 * because each would still be self-consistent. เลขต้องมาจากที่เดียวกับที่ตัดสิน
 *
 * ⚠️ IT FETCHES ONLY WHILE OPEN. Two reads on mount, none on a timer, and none
 * when it is closed — a modal nobody opened must cost nothing.
 *
 * revert: delete this file, `StrikeCautionMark.tsx`, and the block in
 * `TicketChat.tsx` that mounts them.
 */
interface Props {
  lineUserId: string;
  onClose: () => void;
  /** Holder of `strike.manage` — reading is `ticket.manage`. [FEAT-20260827-ADMINBLOCK]
      Gates BOTH admin actions now: clear (while locked) and Block (while not).
      Same privilege by the owner's call — "สมมาตรกัน" — so one prop, kept under
      its original name to leave the caller and its tests untouched. */
  canClear: boolean;
  /** Told to the caller so the avatar mark and the header tray can catch up.
      [FEAT-20260827-ADMINBLOCK] fired after a BLOCK too — it is the same
      "state changed, re-read" pipe, whatever direction the state moved. */
  onCleared?: () => void;
}

export const StrikeStatsModal: React.FC<Props> = ({
  lineUserId,
  onClose,
  canClear,
  onCleared,
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* [FEAT-20260829-CLEARFEEDBACK] What the LAST clear did. Owner, 29/08: pressing
     Clear said nothing at all — the confirm box just sat there, so an admin could
     not tell a success from a dead click and pressed again. Separate from
     `error` because they render as different colours and clear at different
     times: a success is wiped the moment the box is reopened. */
  const [notice, setNotice] = useState<'ok' | 'failed' | null>(null);
  const [current, setCurrent] = useState<StrikeSessionView | null>(null);
  const [sessions, setSessions] = useState<StrikeSessionView[]>([]);
  const [policy, setPolicy] = useState<SuspendPolicy | null>(null);
  /* [FEAT-20260827-ADMINBLOCK] the Block confirm dialog + its consent tick.
     Consent is CLEARED on every close (see the dialog's onClose) — a
     remembered tick would make the next confirm a single click, which is the
     exact failure the checkbox exists to stop (WebhookList precedent). */
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockConsent, setBlockConsent] = useState(false);
  /* [FEAT-20260827-CLEARCONSENT] same pair for the CLEAR side — owner asked
     for symmetry: releasing a locked customer is as deliberate an act as
     locking one. Same reset-on-close rule, same reasoning as above. */
  const [clearOpen, setClearOpen] = useState(false);
  const [clearConsent, setClearConsent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      /* Both reads together — they are independent, and running them in series
         would show the admin a half-drawn modal for no reason. */
      const [cur, list, tray] = await Promise.all([
        strikeService.current(lineUserId),
        strikeService.sessions(lineUserId),
        /* The policy lives on the tray endpoint, which is the only place that
           reports it. Asking for one row keeps it cheap — the numbers are what
           we are after, not the list. */
        strikeService.listSuspended(1).catch(() => null),
      ]);
      setCurrent(cur.current ?? null);
      setSessions(list.sessions ?? []);
      setPolicy(tray?.policy ?? null);
    } catch {
      setError('error');
    } finally {
      setLoading(false);
    }
    /* ⚠️ `t` is DELIBERATELY NOT A DEPENDENCY. `useI18n()` returns a fresh `t`
       on every render, so listing it here makes this callback new every render,
       which re-fires the effect below, which sets state, which renders again —
       an endless fetch loop that looks like a modal stuck on "loading".
       Nothing inside reads `t` any more, so there is nothing to go stale.
       t เปลี่ยน identity ทุก render ⇒ ใส่เป็น dep = ยิงไม่จบ */
  }, [lineUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isLocked = !!current?.suspended_at;
  const used = current?.strike_total ?? 0;
  /* [FIX-2708-MAXDISPLAY] เจ้าของ 27/08 พร้อมภาพ: ล็อกอยู่ (ติดครบเองหรือโดน
     Block แอดมิน) เลขใหญ่ต้องอ่านเป็น max/max — "0/5 แต่บอทเงียบ" คือความงง
     ที่ภาพชี้ · เป็นการแสดงผลเท่านั้น: strike_total จริงไม่ถูกแตะ (แถวประวัติ
     ข้างล่างยังโชว์เลขจริง) · cap อ่านไม่ได้ (policy ไม่มา) = โชว์เลขจริงตามเดิม
     revert: ลบ shownUsed แล้วใช้ used ตรง ๆ ในเลขใหญ่ */
  /* [FIX-20260830-STRIKEHONEST] `shownUsed` and `remaining` are GONE, and with
     them the "X / Y  ·  อีก N ครั้งบอทจะเงียบ" headline.
     🔴 Why: `used` is `session.strike_total` — a running total that only grows
        and has no time window. The rule that actually locks a customer counts
        ROWS IN `member_strike_events` inside `STRIKE_SUSPEND_WINDOW_HOURS`
        (`strike-gate.service.ts:isSuspended`). The two are different numbers, so
        the screen could read "3 / 3 · อีก 0 ครั้ง" while the customer was never
        going to be locked — exactly the case the owner reported for
        U1a51d6… on 30/08.
        A fraction and a countdown are PROMISES; this screen cannot keep them
        without the windowed count, which the API does not send. So it stops
        promising: the running total is labelled as a running total, and the
        rule is stated separately as a rule.
     ⚠️ Restoring the fraction REQUIRES the BE to return the windowed count —
        do not recompute it here from `strike_total`, that IS the bug. */

  const clear = async () => {
    if (!current?._id || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await strikeService.clearSession(current._id, 'cleared from strike modal');
      onCleared?.();
      /* Close the confirm ONLY here, inside the success path. Closing it in a
         `finally` would dismiss it on failure too, hiding the very message the
         admin needs and making a failed clear look done. */
      setClearOpen(false);
      setClearConsent(false);
      setNotice('ok');
      await load();
    } catch {
      setNotice('failed');
    } finally {
      setBusy(false);
    }
  };

  /* [FEAT-20260827-ADMINBLOCK] mint the latch. 409 (already suspended — the
     gate or another admin won the race) is NOT an error to show: the reload
     below repaints the locked state, which is what the admin asked for anyway. */
  const block = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await strikeService.suspendSession(lineUserId, 'Block จำกัดการคุย — blocked from strike modal');
      onCleared?.();
    } catch (err) {
      // 409 = already locked; the reload below repaints exactly that state.
      // (`buildApiError` puts the HTTP status on the error — apiClient.ts)
      if ((err as { status?: number })?.status !== 409) setError('error');
    } finally {
      setBusy(false);
      await load();
    }
  };

  const lifetime = sessions.reduce((n, s) => n + (s.strike_total ?? 0), 0);

  /* 🔴 PORTALLED TO `document.body`, AND IT HAS TO BE.
     ===========================================================================
     Owner, 26/08, with a screenshot: *"modal กินขอบขวา"* — the panel ran off the
     right edge of the screen and the backdrop only greyed out part of the page.

     ต้นเหตุ: `position: fixed` is NOT always relative to the viewport. Any
     ancestor with a `transform`, `filter`, `backdrop-filter` or `perspective`
     becomes the containing block for its fixed descendants (CSS Transforms
     spec). This modal renders inside the ticket page's right panel, which has
     exactly that — so `left-1/2` meant "half of the PANEL", not half the screen,
     and `inset-0` covered the panel instead of the page.

     ⚠️ No amount of z-index or width tweaking fixes this: the box was the wrong
     size because it was being measured against the wrong box. Moving the node
     out to `document.body` puts it back outside every transformed ancestor, and
     `fixed` means what it says again.
     fixed ไม่ได้อิงจอเสมอ — ถ้ามี ancestor ที่ transform มันจะอิง ancestor ตัวนั้น
     ⇒ ต้อง portal ออกไปนอก ไม่ใช่ไล่แก้ตัวเลข

     Precedent in this repo: `components/common/SearchableSelect.tsx:185` does the
     same thing for the same reason. ยืมของที่มีอยู่ ไม่ประดิษฐ์ใหม่

     revert: ลบ `createPortal(` กับวงเล็บปิด `, document.body)` แล้วมันจะกลับไป
     render ในที่เดิม (พร้อมบั๊กเดิม) */
  return createPortal(
    <>
      {/* Blocks the page behind. Like the tray, it does NOT dismiss on click —
          an admin reads numbers out of this and a stray click must not lose it. */}
      <div
        data-testid="strike-modal-backdrop"
        className="fixed inset-0 z-[60] bg-slate-900/25 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        data-testid="strike-stats-modal"
        className="fixed left-1/2 top-1/2 z-[61] w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-white shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close') || 'close'}
          className="absolute -right-4 -top-4 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-white text-gray-600 shadow-lg hover:bg-gray-50"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-bold text-gray-800">
            {t('strike.modal_title')}
          </h3>
          <p className="mt-0.5 text-[11px] text-gray-500">
            {t('strike.modal_subtitle')}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : (
          <div className="px-5 py-4">
            {error && (
              <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                {error}
              </div>
            )}

            {/* [FEAT-20260829-CLEARFEEDBACK] the outcome of the last clear.
                Green for done, red for failed — the failure keeps the confirm
                box open behind it, so the admin can simply press again. */}
            {notice && (
              <div
                role="status"
                className={`mb-3 rounded-lg px-3 py-2 text-[12px] ${
                  notice === 'ok'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-rose-50 text-rose-700'
                }`}
              >
                {notice === 'ok' ? t('strike.clear_ok') : t('strike.clear_failed')}
              </div>
            )}

            {/* ── the headline number ─────────────────────────────────────────
                Dark red once the cap is reached, per the owner's instruction to
                make the count itself unmistakable rather than adding a badge
                beside it. สีอยู่ที่ตัวเลข ไม่ใช่ป้ายข้าง ๆ */}
            <div className="flex items-end justify-between rounded-xl bg-gray-50 px-4 py-3">
              <div>
                <div className="text-[11px] font-medium text-gray-500">
                  {t('strike.current_session')}
                </div>
                <div
                  data-testid="strike-current-count"
                  className={`text-3xl font-black leading-tight ${
                    isLocked ? 'text-rose-800' : 'text-gray-800'
                  }`}
                >
                  {used}
                  <span className="ml-1 text-base font-bold text-gray-400">
                    {t('strike.session_total_unit')}
                  </span>
                </div>
              </div>
              <div className="text-right">
                {isLocked ? (
                  <div
                    data-testid="strike-locked-note"
                    className="flex items-center gap-1.5 text-[12px] font-bold text-rose-800"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    {t('strike.locked')}
                  </div>
                ) : (
                  /* [FIX-20260830-STRIKEHONEST] the RULE, not a countdown.
                     Both numbers come from the server's policy — never
                     hardcoded, so changing STRIKE_SUSPEND_AT or
                     STRIKE_SUSPEND_WINDOW_HOURS moves this line with it. */
                  policy && (
                    <div
                      data-testid="strike-rule"
                      className="text-[12px] font-medium text-gray-600"
                    >
                      {t('strike.rule_line')
                        .replace('{n}', String(policy.suspend_at))
                        .replace('{h}', String(policy.window_hours))}
                    </div>
                  )
                )}
                {policy && !isLocked && (
                  <div
                    data-testid="strike-rule-note"
                    className="mt-0.5 max-w-[15rem] text-[10px] leading-snug text-gray-400"
                  >
                    {t('strike.rule_note')}
                  </div>
                )}
                {/* [FEAT-20260827-ADMINBLOCK] the data distinction, made visible:
                    `suspended_by` exists only when an admin minted the lock —
                    the strike ceiling never writes it. Nothing branches on this
                    beyond the label. */}
                {isLocked && current?.suspended_by && (
                  <div
                    data-testid="strike-blocked-by-admin"
                    className="mt-0.5 text-[10px] font-bold text-rose-700"
                  >
                    {t('strike.blocked_by_admin')}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="text-[10px] text-gray-500">
                  {t('strike.lifetime')}
                </div>
                <div className="text-lg font-bold text-gray-800">{lifetime}</div>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="text-[10px] text-gray-500">
                  {t('strike.sessions')}
                </div>
                <div className="text-lg font-bold text-gray-800">
                  {sessions.length}
                </div>
              </div>
            </div>

            {/* ── the history ─────────────────────────────────────────────── */}
            <div className="mt-3 max-h-52 overflow-y-auto rounded-lg border border-border">
              {sessions.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] text-gray-500">
                  {t('strike.no_sessions')}
                </div>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s._id}
                    className="flex items-center justify-between border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-gray-700">
                        #{s.seq}
                        <span className="ml-2 font-normal text-gray-400">
                          {s.status}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {new Date(s.opened_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* per-level tally, e.g. L1×3 — the levels are whatever the
                          server sent; nothing here assumes a ceiling of four. */}
                      <span className="text-[10px] text-gray-400">
                        {Object.entries(s.by_level ?? {})
                          .map(([lv, n]) => `L${lv}×${n}`)
                          .join(' ')}
                      </span>
                      {/* [FIX-2708-MAXDISPLAY] ใบที่โดน force block: เลขจริงคงไว้
                          (ประวัติห้ามโกหก — เจ้าของเคาะ) แต่ป้ายจิ๋วบอกที่มา ·
                          `suspended_by` มีเฉพาะใบที่แอดมินสั่ง (view ฝั่ง BE) */}
                      {s.suspended_by && (
                        <span
                          data-testid="strike-session-blocktag"
                          className="rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-700"
                        >
                          {t('strike.blocked_by_admin')}
                        </span>
                      )}
                      <span
                        className={`text-sm font-bold ${
                          s.suspended_at ? 'text-rose-800' : 'text-gray-700'
                        }`}
                      >
                        {s.strike_total}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* ── clearing ────────────────────────────────────────────────────
                TWO conditions, and both are real:
                  · `canClear`  — `strike.manage`, which most roles do NOT hold
                  · `isLocked`  — the owner asked for the button to wait for red
                A customer at 2 of 5 has nothing to release, so a button there
                would only invite closing a session that is doing its job. */}
            {canClear && isLocked && (
              <>
                <button
                  type="button"
                  /* [FEAT-20260827-CLEARCONSENT] no longer calls the endpoint —
                     the click opens the consent dialog below, symmetric with
                     Block. revert: put `void clear()` back and delete the second
                     ConfirmModal + the clearOpen/clearConsent state. */
                  /* [FEAT-20260829-CLEARFEEDBACK] wipe the previous outcome as the
                     box opens: a stale "cleared" banner sitting above a fresh
                     confirm reads as if THIS attempt had already succeeded. */
                  onClick={() => {
                    setNotice(null);
                    setClearOpen(true);
                  }}
                  disabled={busy}
                  data-testid="strike-clear-button"
                  className="mt-3 w-full rounded-lg bg-rose-600 px-3 py-2 text-[13px] font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
                >
                  {busy ? t('common.loading') : t('suspended.clear')}
                </button>
                <p className="mt-2 text-center text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-lg py-1.5 px-2.5 leading-relaxed">
                  💡 {t('strike.clear_hint')}
                </p>
              </>
            )}

            {/* ── [FEAT-20260827-ADMINBLOCK] Block — "Block จำกัดการคุย" ─────────
                The clear button's mirror: same privilege (`canClear` holds
                `strike.manage`), OPPOSITE lock state. A locked customer has
                nothing to block; an unlocked one has nothing to clear — the two
                buttons can never render together. The click only OPENS the
                consent dialog below; nothing is called until the box is ticked
                and confirmed. ปุ่มแค่เปิด dialog · ของจริงยิงหลังติ๊ก+ยืนยัน */}
            {canClear && !isLocked && (
              <>
                <button
                  type="button"
                  onClick={() => setBlockOpen(true)}
                  disabled={busy}
                  data-testid="strike-block-button"
                  className="mt-3 w-full rounded-lg bg-rose-600 px-3 py-2 text-[13px] font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
                >
                  {busy ? t('common.loading') : t('strike.block_button')}
                </button>
                <p className="mt-2 text-center text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-800/60 rounded-lg py-1.5 px-2.5 leading-relaxed">
                  ⚠️ {t('strike.block_hint')}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* [FEAT-20260827-ADMINBLOCK] the consent dialog. 🔴 A SIBLING of the
          panel on purpose, never a child: the panel above carries
          `-translate-x-1/2`, and a `position: fixed` descendant of a
          transformed box is laid out against THAT BOX, not the viewport — the
          exact off-screen bug this file's own portal note documents. As a
          fragment child it lands directly under document.body. ห้ามย้ายเข้า panel */}
      <ConfirmModal
        isOpen={blockOpen}
        onClose={() => {
          setBlockOpen(false);
          setBlockConsent(false); // never remember a tick — see the state note
        }}
        onConfirm={() => void block()}
        confirmDisabled={!blockConsent}
        title={t('strike.block_confirm_title')}
        message={t('strike.block_confirm_message')}
        type="danger"
      >
        <ConfirmConsentCheck
          checked={blockConsent}
          onChange={setBlockConsent}
          label={t('strike.block_consent')}
        />
      </ConfirmModal>

      {/* [FEAT-20260827-CLEARCONSENT] the clear consent dialog — the Block
          dialog's mirror, and a SIBLING of the panel for the same transform
          reason. Only one of the two can ever open: their buttons render on
          opposite lock states. */}
      <ConfirmModal
        isOpen={clearOpen}
        onClose={() => {
          setClearOpen(false);
          setClearConsent(false); // never remember a tick — see the state note
        }}
        onConfirm={() => void clear()}
        confirmDisabled={!clearConsent}
        title={t('strike.clear_confirm_title')}
        message={t('strike.clear_confirm_message')}
        type="danger"
      >
        <ConfirmConsentCheck
          checked={clearConsent}
          onChange={setClearConsent}
          label={t('strike.clear_consent')}
        />
      </ConfirmModal>
    </>,
    document.body,
  );
};

export default StrikeStatsModal;
