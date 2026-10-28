/**
 * [FEAT-20260822-NOTICERUNTIME] R3 — the shapes every case file speaks.
 * ===========================================================================
 * Imports NOTHING (the keys-file rule): a single case can be lifted out, or
 * deleted, without dragging a type chain behind it. ไฟล์ type ห้ามมี import.
 *
 * A CASE is data + one predicate. It never sends, never writes, never reads
 * the database — it answers "do I fire on this context" and names the card
 * field and the member stamp the firing uses. Everything impure stays with
 * the caller. revert: delete with the rest of `cases/`.
 */

/** Everything a case is allowed to know, assembled once per event. */
export interface NoticeContext {
  /** which webhook event kind this is — cases self-select on it. */
  eventKind: 'text' | 'image';
  /**
   * [FIX-20260822-NOTICEPOLICY] the OA's master switch is OFF (`status === 0`).
   * Read from the hook the caller already passes, so honouring it costs the
   * webhook nothing — no new argument, no edit to webhook.service.ts.
   */
  hookStatusOff: boolean;
  /**
   * [FIX-20260822-NOTICECOLLIDE] an operator is holding this room. Honoured
   * per NOTICE_RESPECTS_ASSIST so both call sites behave identically.
   */
  assisted: boolean;
  /** hook toggles, read `=== true` (lean rule) by the context builder. */
  depositOn: boolean;
  withdrawOn: boolean;
  /** effective deposit scope ('text' unless explicitly 'all'/'slip'). */
  depositScope: 'text' | 'all' | 'slip';
  /** word screens — always false on image events. */
  depositWord: boolean;
  withdrawWord: boolean;
  /** jsQR verdict — true only when the prescan reason was 'qr_found'. */
  qrFound: boolean;
  /** inside the shared 23:00-02:00 Thai window right now. */
  inWindow: boolean;
  /* [FEAT-20260829-STATUSFIRST] the per-side night-window preference — ON means
     an OPEN side suppresses its off-time card (A/C/E). Default-off polarity
     (`readNoticeToggle`), so absent = today's behaviour. */
  depositSiteStatusFirst: boolean;
  withdrawSiteStatusFirst: boolean;
  /** site-rule off-service verdicts (fail-open false/false). */
  depositOff: boolean;
  withdrawOff: boolean;

  /* [FEAT-20260823-NOTICECHECKFLAGS] The four check-wrapping flags.
   *
   * ⚠️ OPTIONAL ON PURPOSE — `undefined` means ON. Two reasons:
   *   1. Polarity: absent must equal "before the flags existed" = check runs.
   *      The cases therefore test `!== false`, never truthiness.
   *   2. Proof: the 22/08 case specs build this context as object literals in
   *      23 places. Optional fields let every one of them compile AND pass
   *      byte-unchanged — which is itself the before/after proof that absent
   *      flags change nothing. Making these required would have forced edits
   *      to the very tests that pin the old behaviour.
   * prod (`notice-context.ts`) always sets all four explicitly.
   * absent = เปิด · เทสเดิมไม่ต้องแก้สักตัวอักษร = ตัวพิสูจน์เอง */
  depositTimeCheckOn?: boolean;
  depositSiteStatusCheckOn?: boolean;
  withdrawTimeCheckOn?: boolean;
  withdrawSiteStatusCheckOn?: boolean;
}

/** What a firing decides — the caller does the sending and stamping. */
export interface NoticeDecision {
  caseId: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  /** hook field holding the flex card id to send. */
  cardField: string;
  /** member-config dotted key to stamp (and read for the cooldown). */
  stampKey: string;
}

export interface NoticeCase extends NoticeDecision {
  /** pure — true = this case fires on the context. */
  when: (ctx: NoticeContext) => boolean;
}
