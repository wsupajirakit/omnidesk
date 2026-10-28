/**
 * ==== [FEAT-20260810-PAYSTATEFLEX] Bind ONE flex card per payment reply state ====
 *
 * Owner's rule, 2026-08-10: **1 state = 1 card, chosen from a select.** This block is
 * the whole UI for `hook.payment_flex_ids` — an object map `{ [state]: cardId }`.
 * A state with NO key = "not set" = that state keeps replying exactly as it does today,
 * so an existing OA sees no change until an admin picks something here.
 *
 * WHY ITS OWN FILE: `HookFormModal.tsx` is already ~5.6k lines and the owner has asked
 * repeatedly not to grow it ("อย่าให้ไฟล์บวม"). The modal contributes ~7 lines: the
 * import and one `<HookPaymentFlexBlock … />` at the bottom of the External tab. Same
 * pattern as `HandoffHookCredsEditor` / `HookHandoffTab` in this folder.
 *
 * PROPS ONLY — no fetching, no filtering. `slipTemplates` is the list the modal already
 * computed once (`flexTemplates.filter(flex_type === 'slip')`, HookFormModal:512);
 * re-filtering here would be a second definition of "which cards are eligible".
 * ตัวกรองอยู่ที่เดียว — ที่พ่อแม่ ไม่ทำซ้ำ
 *
 * revert: delete this file + the import and the single JSX call in HookFormModal, and
 * drop `payment_flex_ids` from DEFAULT_FORM / the initialData load. Every state falls
 * back to its current reply with no other change.
 */
import React, { useState } from 'react';
import { CreditCard, Info, ChevronDown, Eye } from 'lucide-react';
import { FlexMessageEntry } from '../../types';
import { useI18n } from '../../i18n';
// [FEAT-20260811-PAYRESPEXAMPLES] raw response examples come from the BE spec.
import {
  paymentReplyExamplesService,
  ReplyStateResponseExample,
} from '../../services/hook';

/**
 * ⚠️ KNOWN, ACCEPTED DUPLICATION — declared out loud, not hidden.
 *
 * The badges below describe which buttons/behaviour each reply state carries. The
 * SOURCE OF TRUTH is `REPLY_STATE_DEFAULTS` in
 * `omnidesk-api/src/modules/payment/payment-runner.service.ts` (`kind` + `actions`), plus
 * the per-state notes in `payment-reply-copy.ts`. The back end does NOT expose that map
 * over the API yet, so the dashboard cannot read it — and the owner requires the admin
 * to see, AT THE POINT OF CHOOSING A CARD, what the state actually does. Without it an
 * admin binds a retry-button card to a state that has no retry, and the button silently
 * vanishes at render.
 *
 * ⚠️ THIS MUST BE KEPT IN SYNC BY HAND until BE serves it (e.g. GET
 * /api/payment/reply-states). Change `REPLY_STATE_DEFAULTS` → change this table in the
 * same PR. Nothing breaks functionally if it drifts — the badge just starts lying, which
 * is worse than useless on the money path.
 * ห้ามแก้ข้างเดียว: แก้ที่ BE แล้วต้องมาแก้ตารางนี้ด้วย ไม่งั้น badge จะโกหกแอดมิน
 *
 * `actions` mirrors BE `actions` AS RENDERED, not as declared: `review` declares
 * `['retry','contact_admin']` in BE but the retry node is dropped at build time (no
 * resume context ever exists for that state — see `payment-mint-flex.builder`
 * `buildAction`), so listing 🔁 here would promise a button the customer never sees.
 */
type StateBadge = { icon: string; i18n: string };
const RETRY_BADGE: StateBadge = { icon: '🔁', i18n: 'hook_form.payflex_badge_retry' };
const CONTACT_BADGE: StateBadge = { icon: '💬', i18n: 'hook_form.payflex_badge_contact' };
const TICKET_BADGE: StateBadge = { icon: '🎫', i18n: 'hook_form.payflex_badge_ticket' };

/** One reply state as the admin sees it. `state` === the BE `ReplyState` key verbatim. */
type PayStateRow = {
  state: string;
  /** Badges = what this state DOES. Empty = plain reply, no buttons, no ticket. */
  badges: StateBadge[];
  /** `true` = show the ⚠️ warn styling on the hint (money may have moved / tone matters). */
  warn?: boolean;
};

/**
 * Groups exist so the block does not read as a wall of 8 dropdowns (owner's note).
 * Order inside a group = order on screen. Grouping is presentation only — the BE map is
 * flat, so moving a row between groups changes nothing but the layout.
 */
const PAY_STATE_GROUPS: { key: string; i18n: string; rows: PayStateRow[] }[] = [
  {
    key: 'success',
    i18n: 'hook_form.payflex_group_success',
    rows: [
      // Money MOVED, slip locked. Blank here = the Swiftcheck `flex_success` card still answers.
      { state: 'topup_success', badges: [] },
      { state: 'walletpay_success', badges: [] },
    ],
  },
  {
    key: 'pending',
    i18n: 'hook_form.payflex_group_pending',
    rows: [
      // Matched but an admin still confirms — must NOT read as "success" on the card.
      { state: 'matched_pending', badges: [], warn: true },
      // The only state with a working retry: it resumes at the next statement, same slip.
      { state: 'no_match_retry', badges: [RETRY_BADGE, CONTACT_BADGE] },
      // Amount matched no pending deposit; lock RELEASED so resending is safe.
      // [FIX-20260816-TICKETCOMMENT] BE ALSO auto-opens an admin ticket for this
      // state, carrying the real amounts (payment-runner.service.ts:2279,
      // [FEAT-20260810-TICKETAMOUNTS]) — verified 16/08 against the live DB:
      // all 10 existing direct tickets came from THIS state, not member_not_match.
      { state: 'statement_not_found', badges: [] },
    ],
  },
  {
    key: 'human',
    i18n: 'hook_form.payflex_group_human',
    rows: [
      // Customer must link their account first — retry changes nothing until they do.
      { state: 'not_linked', badges: [] },
      // [FIX-20260816-TICKETCOMMENT] BE auto-opens an admin ticket here
      // (payment-runner.service.ts:1363) — the earlier wording "the ONLY state
      // that opens a ticket by itself" was WRONG and its line ref (:1188) stale:
      // `statement_not_found` auto-opens one too (:2279, with the real amounts;
      // 10 live tickets prove it), and a bound card's `direct_ticket_on_reply`
      // can open/retitle on any state (webhook.service.ts:4972). This row keeps
      // the badge because the ticket is this state's whole point: the reply
      // text promises the customer an admin will take over.
      { state: 'member_not_match', badges: [TICKET_BADGE] },
      // Money outcome UNKNOWN. NO retry (nothing to resume) and the copy must not say
      // "failed"/"cancelled" — the transfer may well have gone through.
      { state: 'review', badges: [CONTACT_BADGE], warn: true },
    ],
  },
];

/* [FEAT-20260811-PAYRESPEXAMPLES] the verbatim raw responses used to live here
 * as a `REAL_RAW` constant — that bloated this file and drifted from the BE
 * captures. They now come from the BE central spec via
 * `paymentReplyExamplesService` (BE: `payment-reply-response-examples.ts`,
 * route GET /payment/hook-modal-reply-state-response-examples — display data
 * only, nothing in the BE consumes it). Loaded lazily on first eye-open; a
 * fetch failure just hides the raw blocks, the guide text still renders.
 * ย้าย raw ไปไว้ BE ที่เดียว — FE โหลดมาโชว์ตอนกดลูกตาเท่านั้น. */

/**
 * [FEAT-20260811-PAYFLEXEYE] Guide sections = the REAL flow order, one divider per
 * actor: Swiftcheck gate → topup leg → our statement matcher → walletpay leg → the shared
 * endings. Each section's desc line says what continues where and WHY — mirrored from
 * the runner's flow map (payment-runner.service.ts class doc + docs/payment-states.md).
 * ตัวคั่นเรียงตาม flow จริง ไม่ใช่ตามกลุ่ม UI ข้างล่าง (อันนั้นเรียงเพื่อเลือกการ์ด).
 */
const GUIDE_SECTIONS: { key: string; states: string[] }[] = [
  { key: 'swiftcheck', states: [] }, // gate only — no bindable state of its own
  { key: 'topup', states: ['topup_success', 'not_linked', 'member_not_match'] },
  { key: 'gate', states: ['statement_not_found'] }, // our matcher, no provider HTTP
  { key: 'walletpay', states: ['walletpay_success', 'matched_pending', 'no_match_retry'] },
  { key: 'system', states: ['review'] }, // the shared "no one could decide" ending
];

export interface HookPaymentFlexBlockProps {
  /** `hook.payment_flex_ids`. Absent/`{}` on every OA that never set one. */
  value: Record<string, string> | null | undefined;
  /** Full replacement map. Unset states are DELETED from the map, never sent as `''`. */
  onChange: (next: Record<string, string>) => void;
  /** Already filtered to `flex_type === 'slip'` by the parent — do not re-filter. */
  slipTemplates: FlexMessageEntry[];
  /** View mode / read-only, same flag the rest of the form uses. */
  disabled?: boolean;
}

export const HookPaymentFlexBlock: React.FC<HookPaymentFlexBlockProps> = ({
  value,
  onChange,
  slipTemplates,
  disabled = false,
}) => {
  const { t } = useI18n();
  const map = value || {};

  /* [FEAT-20260810-PAYFLEXFOLD] พับได้ทั้งบล็อกและพับได้ทีละกลุ่ม
   * บล็อกนี้กิน 8 select + hint ทุกอัน = ยาวกว่าหนึ่งหน้าจอ และอยู่ท้ายแท็บ External
   * ที่มีของอื่นอยู่แล้ว ⇒ เปิดค้างไว้ทำให้เลื่อนหาของอื่นยาก
   *
   * เริ่มที่ "พับ" (`false`) เพราะ OA ส่วนใหญ่ไม่ได้ตั้งการ์ด ⇒ ค่าเริ่มต้นควรเป็น
   * สิ่งที่คนส่วนใหญ่ต้องการ · ตัวเลข "ตั้งไว้ x/8" ยังโชว์บนหัวข้อตอนพับอยู่
   * จึงรู้สถานะได้โดยไม่ต้องกาง
   * state อยู่ใน component นี้เท่านั้น ไม่แตะ form data ⇒ พับ/กาง ไม่นับเป็นการแก้ค่า
   * [FEAT-20261018-EXTAPICARDS] owner 18/10/2026 reversed the default: "พับปิดได้ทุกการ์ด
   * default เปิด" ⇒ starts OPEN. revert: `useState(false)`. */
  const [open, setOpen] = useState(true);
  /* [FEAT-20260811-PAYFLEXEYE] ลูกตาบนหัวข้อ — กางตารางว่าแต่ละช่องคือ ReplyState
   * ตัวไหนในโค้ด (key ตรงตัวจาก `row.state`) พร้อมคำอธิบายสองบรรทัดต่อ state.
   * เปิดลูกตาแล้วบล็อกต้องกางด้วย ไม่งั้นตารางโผล่ใต้หัวข้อที่พับอยู่ = มองไม่เห็น */
  const [showGuide, setShowGuide] = useState(false);
  /* [FEAT-20260811-PAYRESPEXAMPLES] null = not loaded yet · {} = loaded-empty or
   * failed (raw blocks simply absent — the guide never blocks on this fetch). */
  const [rawExamples, setRawExamples] = useState<Record<
    string,
    ReplyStateResponseExample[]
  > | null>(null);
  const loadRawExamples = () => {
    if (rawExamples !== null) return; // fetch once per mount
    paymentReplyExamplesService
      .getHookModalReplyStateResponseExamples()
      .then(setRawExamples)
      .catch(() => setRawExamples({}));
  };
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const isGroupOpen = (key: string) => openGroups[key] !== false; // กางเป็นค่าเริ่มต้น
  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => ({ ...prev, [key]: prev[key] === false }));

  /* Picking the "ใช้ค่าเดิม" option must REMOVE the key, not store `''`.
     The BE resolver treats a blank id as "not bound" either way, but an empty string
     left in the map is a value an admin set and can no longer see — it reads as
     configured in the DB while behaving as unconfigured. Delete = honest. */
  const pick = (state: string, id: string) => {
    if (disabled) return;
    const next = { ...map };
    if (id) next[state] = id;
    else delete next[state];
    onChange(next);
  };

  /* Both derived, never typed as literals — adding a state to PAY_STATE_GROUPS must not
     leave a "3/8" counter behind. boundCount counts only states this UI knows about, so a
     stale key left in the map by an older build is not advertised as configured. */
  const allStates = PAY_STATE_GROUPS.flatMap((g) => g.rows.map((r) => r.state));
  const boundCount = allStates.filter((s) => !!map[s]).length;

  return (
    <div className="extapi-card md:col-span-2 p-6 bg-dark-900 border border-dark-700 rounded-2xl flex flex-col gap-5">
      {/* [FEAT-20260810-PAYFLEXFOLD] หัวข้อทั้งแถบเป็นปุ่มพับ — กดที่ไหนก็ได้บนหัวข้อ
          ยังกดได้ตอน view mode เพราะการกางดูไม่ใช่การแก้ค่า */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center justify-between gap-3 flex-wrap text-left cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <CreditCard className="text-primary-500" size={24} />
          <h4 className="font-bold text-slate-900">{t('hook_form.payflex_title')}</h4>
          {/* [FEAT-20260811-PAYFLEXEYE] span ไม่ใช่ <button> — หัวข้อทั้งแถบเป็นปุ่มพับ
              อยู่แล้ว ปุ่มซ้อนปุ่มผิด HTML · stopPropagation กันไม่ให้กดลูกตาแล้วพับบล็อก */}
          <span
            role="button"
            tabIndex={0}
            aria-label={t('hook_form.payflex_eye_aria')}
            title={t('hook_form.payflex_eye_aria')}
            onClick={(e) => {
              e.stopPropagation();
              setShowGuide((g) => !g);
              setOpen(true);
              loadRawExamples();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                setShowGuide((g) => !g);
                setOpen(true);
                loadRawExamples();
              }
            }}
            className={`p-1 rounded-lg transition-colors ${
              showGuide
                ? 'text-primary-600 bg-primary-50'
                : 'text-slate-400 hover:text-primary-500'
            }`}
          >
            <Eye size={16} />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500">
            {t('hook_form.payflex_bound_count', { count: boundCount, total: allStates.length })}
          </span>
          <ChevronDown
            size={18}
            className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {open && (
        <>
      {/* [FEAT-20260811-PAYFLEXEYE] ตารางอธิบายทุกช่อง: label บนจอ ↔ ReplyState ใน
          โค้ด + สองบรรทัดต่อ state (เชิงระบบ / ความหมายที่ลูกค้าเจอ) · ข้อความอยู่ใน
          i18n `payflex_eye_*` — SOURCE OF TRUTH ฝั่ง BE คือ ReplyState +
          REPLY_STATE_DEFAULTS ใน payment-runner.service.ts และตารางใน
          docs/payment-states.md §7b · แก้ BE แล้วต้องตามมาแก้คำอธิบายนี้ด้วย
          (กติกาเดียวกับ badge ข้างบน) */}
      {showGuide && (
        <div
          data-testid="payflex-state-guide"
          className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col gap-3"
        >
          <p className="text-xs font-bold text-slate-600">
            {t('hook_form.payflex_eye_title')}
          </p>
          {GUIDE_SECTIONS.map((sec) => (
            <div key={sec.key} className="flex flex-col gap-2">
              {/* ตัวคั่นต่อลูกค้า — หัวข้อ + บรรทัด flow ว่าอะไรไปต่อ/หยุด เพราะอะไร */}
              <div className="mt-2 pt-2 border-t border-slate-300/70">
                <p className="text-[11px] font-black text-slate-700 uppercase tracking-wide">
                  {t(`hook_form.payflex_eye_sec_${sec.key}`)}
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {t(`hook_form.payflex_eye_sec_${sec.key}_desc`)}
                </p>
              </div>
              {sec.states
                .map((s) =>
                  PAY_STATE_GROUPS.flatMap((g) => g.rows).find((r) => r.state === s),
                )
                .filter((r): r is PayStateRow => !!r)
                .map((row) => (
            <div key={row.state} className="flex flex-col gap-0.5 pl-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-700">
                  {t(`hook_form.payflex_state_${row.state}`)}
                </span>
                <code className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-mono">
                  {row.state}
                </code>
              </div>
              {/* ใคร/response อะไรทำให้เกิด state นี้ */}
              <p className="text-[11px] font-bold text-slate-600 leading-relaxed">
                {t(`hook_form.payflex_eye_src_${row.state}`)}
              </p>
              <p className="text-[11px] text-slate-500 font-mono leading-relaxed">
                {t(`hook_form.payflex_eye_tech_${row.state}`)}
              </p>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {t(`hook_form.payflex_eye_plain_${row.state}`)}
              </p>
              {/* raw จริงจากสเปคกลางฝั่ง BE — มีเฉพาะ state ที่เคยเห็นของจริง */}
              {(rawExamples?.[row.state] || []).map((r, i) => (
                <div key={i} className="mt-0.5">
                  <span className="text-[10px] font-bold text-slate-400">{r.label}</span>
                  <pre className="mt-0.5 p-2 rounded-lg bg-slate-100 border border-slate-200 text-[10px] font-mono text-slate-600 whitespace-pre-wrap break-all leading-relaxed">
                    {r.raw}
                  </pre>
                </div>
              ))}
            </div>
                ))}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500/90 leading-relaxed">{t('hook_form.payflex_intro')}</p>

      {/* Type gate: a card saved as any other flex_type never appears below, and the BE
          resolver refuses it a second time at send. Admins hit this constantly, so it is
          a standing hint rather than an error after the fact. */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-xs">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>{t('hook_form.payflex_type_hint')}</span>
      </div>

      {slipTemplates.length === 0 ? (
        <p className="text-xs text-slate-500/80 border border-dashed border-dark-600 rounded-lg px-3 py-3">
          {t('hook_form.payflex_empty')}
        </p>
      ) : (
        PAY_STATE_GROUPS.map((group) => (
          <div key={group.key} className="flex flex-col gap-3">
            {/* [FEAT-20260810-PAYFLEXFOLD] พับทีละกลุ่ม — กางไว้เป็นค่าเริ่มต้น
                เพราะกางทั้งบล็อกมาแล้วแปลว่าตั้งใจจะมาตั้งค่า · ตัวเลข x/y ต่อกลุ่ม
                ทำให้พับแล้วยังรู้ว่ากลุ่มนี้ตั้งไปกี่อัน */}
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              aria-expanded={isGroupOpen(group.key)}
              className="flex items-center gap-2 text-left cursor-pointer"
            >
              <ChevronDown
                size={14}
                className={`shrink-0 text-slate-400 transition-transform ${
                  isGroupOpen(group.key) ? 'rotate-180' : ''
                }`}
              />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t(group.i18n)}
              </span>
              <span className="text-[10px] font-bold text-slate-400">
                {group.rows.filter((r) => !!map[r.state]).length}/{group.rows.length}
              </span>
            </button>
            <div
              className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${
                isGroupOpen(group.key) ? '' : 'hidden'
              }`}
            >
              {group.rows.map((row) => (
                <div key={row.state}>
                  <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
                    <label className="block text-sm font-medium text-slate-500">
                      {t(`hook_form.payflex_state_${row.state}`)}
                    </label>
                    {/* Badges: what the state carries. See the sync warning at the top. */}
                    {row.badges.length > 0 && (
                      <span className="flex items-center gap-1.5 flex-wrap">
                        {row.badges.map((b) => (
                          <span
                            key={b.i18n}
                            className="shrink-0 px-2 py-0.5 rounded-lg bg-primary-50 text-primary-600 border border-primary-200 text-[10px] font-bold"
                          >
                            {b.icon} {t(b.i18n)}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  {/* Class list mirrors the modal's `inputClass(false, 'bg-white')` — match
                      the surrounding selects, do not invent a look. */}
                  <select
                    disabled={disabled}
                    value={map[row.state] || ''}
                    onChange={(e) => pick(row.state, e.target.value)}
                    className="w-full bg-white border border-primary-500/30 rounded-lg px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                  >
                    {/* Explicit real choice, not a placeholder — "keep the current reply". */}
                    <option value="">{t('hook_form.payflex_keep_current')}</option>
                    {slipTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                  <p
                    className={`mt-1 text-xs ${
                      row.warn ? 'text-amber-600' : 'text-slate-500/80'
                    }`}
                  >
                    {row.warn && '⚠️ '}
                    {t(`hook_form.payflex_hint_${row.state}`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
        </>
      )}
    </div>
  );
};

export default HookPaymentFlexBlock;
