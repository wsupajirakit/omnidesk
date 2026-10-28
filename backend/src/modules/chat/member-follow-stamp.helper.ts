/**
 * [FEAT-20260829-MANUALFOLLOWSTAMP] an admin stamps a follow-up time by hand.
 * ===========================================================================
 * Owner, 29/08/2026: on the right-hand panel, "ติดตามฝาก" and "ติดตามถอน" are
 * clickable while they read `n/a`; clicking one records the follow-up time for
 * that member. Deposit and withdraw are pressed separately, each behind its own
 * confirm, and each write leaves an audit row. **Only these two values may be
 * stamped this way.**
 *
 * WHY A FILE OF ITS OWN, not a few lines in `members.service.ts`: the rules below
 * (which keys, when, and what the audit row says) are longer than the write they
 * guard, and the service is already large. Owner's standing rule —
 * *"ห้ามยัด ห้ามบวม จัดระเบียบ"*. Deleting this file plus its one call site in
 * `members.service.ts` and the route in `members.controller.ts` removes the whole
 * feature; nothing else in the app depends on it. Same shape and same placement
 * as its neighbour `member-abandon-audit.helper.ts`.
 *
 * 🔴 THE ALLOW-LIST IS THE POINT. The route takes a `kind` ('deposit'|'withdraw'),
 * NEVER a config key off the wire. `follow_up.line.*` also holds
 * `notice_payment_at` and `request_reg_at`, which mean different things and have
 * their own writers and clearers; letting a caller name the key would put all of
 * them one typo away from being stamped by hand. The owner asked for exactly two.
 *
 * 🔴 EMPTY ONLY — a stamp that already has a value is NOT overwritten.
 * Owner picked this: the button exists only where the panel shows `n/a`. These
 * stamps are the "last time the system sent a notice card" record that
 * `webhook/notice-runtime/notice-guard.helper.ts` writes and the `?follow=`
 * contact filter reads; silently moving an existing one forward would rewrite
 * history that other screens report on. A second press is refused, not applied.
 *
 * WHY THE VALUE IS "NOW". The registry types both keys as `'date'` and every
 * other writer stores the moment the follow-up happened. A manual stamp means
 * "I am following up on this now", so it stores the same thing.
 *
 * ⚠️ THE DB HOLDS UTC AND THAT IS CORRECT. The +07:00 rendering happens on the
 * screen (`omnidesk-console/components/member/follow-up/followStamps.ts`).
 * Do not store a Bangkok wall-clock time here.
 *
 * revert: delete this file, the `setFollowUpStamp` method in `members.service.ts`
 *         and the route in `members.controller.ts`. Nothing else refers to it.
 */
import type { AuthenticatedUser } from '@/common';

/** The only two things an admin may stamp by hand. Adding a third is a decision. */
export const FOLLOW_STAMP_KINDS = ['deposit', 'withdraw'] as const;

export type FollowStampKind = (typeof FOLLOW_STAMP_KINDS)[number];

/**
 * kind → the member-config key it writes.
 *
 * These strings must stay in `MEMBER_CONFIG_KEYS`; `writeMemberConfig` asserts
 * the key and its declared type ('date') and throws otherwise, so a rename on
 * the registry side surfaces here rather than writing to a path nobody reads.
 */
export const FOLLOW_STAMP_KEY_BY_KIND: Readonly<
  Record<FollowStampKind, string>
> = {
  deposit: 'follow_up.line.notice_deposit_at',
  withdraw: 'follow_up.line.notice_withdraw_at',
};

/** Narrows whatever arrived on the wire. Anything else is a bad request. */
export const isFollowStampKind = (value: unknown): value is FollowStampKind =>
  typeof value === 'string' &&
  (FOLLOW_STAMP_KINDS as readonly string[]).includes(value);

/**
 * Reads the stamp currently stored on a member document.
 *
 * The member is fetched `.lean()`, so `config` is a plain object and the path is
 * walked rather than addressed with dots. Returns `null` for missing, `null`,
 * empty string — the same "no stamp" rule the screen and the BE clearers use.
 */
export const readStoredStamp = (
  member: unknown,
  kind: FollowStampKind,
): unknown => {
  const path = FOLLOW_STAMP_KEY_BY_KIND[kind].split('.');
  let node: unknown = (member as { config?: unknown } | null)?.config;
  for (const step of path) {
    if (!node || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[step];
  }
  if (node === undefined || node === null || node === '') return null;
  return node;
};

/** True when the stamp is empty, i.e. the screen would render `n/a`. */
export const stampIsEmpty = (member: unknown, kind: FollowStampKind): boolean =>
  readStoredStamp(member, kind) === null;

/**
 * [FEAT-20260830-AUDITLINEID] the human-readable half of the audit row.
 *
 * Names WHOSE follow-up was stamped, not just that one was. A member with no
 * LINE id still gets a sentence — it simply does not claim an id it does not
 * have, rather than printing `undefined` into the log.
 */
export function buildFollowStampNote(
  kind: FollowStampKind,
  lineUserId?: string | null,
): string {
  const what = kind === 'deposit' ? 'ติดตามสถานะฝาก' : 'ติดตามสถานะถอน';
  const who =
    typeof lineUserId === 'string' && lineUserId.trim()
      ? ` · Channel LINE user ${lineUserId.trim()}`
      : '';
  return `${what} — stamped by hand from the customer panel${who}`;
}

/**
 * [FEAT-20260830-FOLLOWUPFRESH] the registration pair, read off a lean member.
 *
 * The close-case dialog shows its registration section only when a member
 * carries BOTH `abandon_trigger_at` AND `request_reg_at` — verified identical on
 * both sides: `tickets/patch-after-close.helper.ts:145` decides it that way, and
 * the screen does too (`CloseCaseSections.tsx:71`, via `ABANDON_ROW.key` /
 * `REQUEST_REG_ROW.key` in `followStamps.ts`).
 *
 * 🔴 These two are NOT in `FOLLOW_STAMP_KEY_BY_KIND` on purpose — that map is
 *    the allow-list of what an admin may STAMP by hand, and these may not be.
 *    This function only READS them, so the allow-list stays untouched.
 */
export const readRegistrationPair = (member: unknown): boolean => {
  const config = (member as { config?: unknown } | null)?.config;
  const followUp = (config as { follow_up?: unknown } | undefined)?.follow_up;
  const line = (followUp as { line?: unknown } | undefined)?.line as
    Record<string, unknown> | undefined;
  const has = (leaf: string): boolean => {
    const v = line?.[leaf];
    return v !== undefined && v !== null && v !== '';
  };
  return has('abandon_trigger_at') && has('request_reg_at');
};

/** Just the piece of the audit service this needs — never the whole class. */
export interface FollowStampAuditWriter {
  createAuditLog(payload: Record<string, unknown>): Promise<unknown>;
}

/**
 * Records the manual stamp. Returns nothing and never rejects.
 *
 * FIRE-AND-FORGET, for the same reason as `auditAbandonShieldFlip`: by the time
 * this runs the value is already written, so failing the request would tell the
 * operator their click did nothing when it did, and they would click again.
 * An audit gap is recoverable; a lie about the data is not.
 *
 * ⚠️ `changed_fields` MUST be an ARRAY of `{field, from, to}` — `AuditLogService`
 *    normalises a non-array to `[]` and then REFUSES action 'update' with empty
 *    changes, and the refusal would land in the catch below and vanish. That
 *    exact mistake silently dropped every abandon-shield row for six days
 *    (see `member-abandon-audit.helper.ts`, FIX-20260827-ABANDONAUDITSHAPE).
 */
export function auditFollowStampSet(
  input: {
    memberId: string;
    /**
     * [FEAT-20260830-AUDITLINEID] the member's LINE user id (`members.line_user_id`,
     * e.g. `U206614f…`).
     *
     * WHY IT IS RECORDED NEXT TO `ref_id`: `ref_id` holds the member's Mongo
     * `_id`, which is the only id the audit screen can follow back to a row —
     * but it is NOT the id an admin sees anywhere else. When someone asks
     * "whose follow-up did we stamp", they have a LINE id in hand, not an
     * ObjectId, and there is no way to get from one to the other by reading the
     * log. Both are written so the row answers on its own.
     * ⚠️ Optional: a member with no LINE id (another channel, or a legacy row)
     *    must still produce an audit row — the id line is simply omitted.
     */
    lineUserId?: string | null;
    kind: FollowStampKind;
    /** The moment written to the member document. */
    at: Date;
    auth?: AuthenticatedUser;
  },
  deps: { audit: FollowStampAuditWriter; warn: (msg: string) => void },
): void {
  const userId = input?.auth?.userId;
  if (!userId) {
    deps.warn('[MANUALFOLLOWSTAMP] audit skipped — no actor on the request');
    return;
  }

  void deps.audit
    .createAuditLog({
      ref_id: String(input.memberId),
      parent: 'line_user',
      action: 'update',
      /* [FEAT-20260830-AUDITLINEID] the LINE id rides as a row of its own rather
         than a column: `CreateAuditLogInput` accepts only ref_id / hook_id /
         group_id, and inventing a column would mean a schema change for a value
         that is read, never queried. `from` and `to` are the SAME id on purpose —
         nothing changed about it; it is there to say WHO. */
      changed_fields: [
        {
          field: FOLLOW_STAMP_KEY_BY_KIND[input.kind],
          // it was empty — that is the only state this route accepts
          from: null as unknown,
          to: input.at.toISOString() as unknown,
        },
        ...(input.lineUserId
          ? [
              {
                field: 'line_user_id',
                from: input.lineUserId as unknown,
                to: input.lineUserId as unknown,
              },
            ]
          : []),
      ],
      actor: {
        user_id: String(userId),
        username: input.auth?.username,
        display_name: input.auth?.displayName,
      },
      /* [FEAT-20260830-AUDITLINEID] the note is the only part of the row a
         reader sees without expanding it, so the LINE id goes there as well as
         in `line_user_id` below. */
      note: buildFollowStampNote(input.kind, input.lineUserId),
    })
    .catch((err: Error) =>
      deps.warn(`[MANUALFOLLOWSTAMP] audit failed: ${err.message}`),
    );
}
