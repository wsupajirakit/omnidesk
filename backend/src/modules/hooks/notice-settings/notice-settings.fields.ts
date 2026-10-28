/**
 * [FEAT-20260822-NOTICEMODE] Field rules for the hook "notice" settings mode.
 *
 * The mode stores, per OA: a deposit-system notice (toggle + scope + flex
 * card), a withdraw-system notice (same trio) and a follow-customer switch.
 * Runtime behaviour (actually SENDING a notice) is a later phase — this file
 * only decides what may be WRITTEN. เฟสนี้เก็บค่าอย่างเดียว ยังไม่มีการยิงเตือน.
 *
 * WHY A SEPARATE FILE, not lines in `ALLOWED_UPDATES` / `BULK_SETTING_FIELDS`:
 * both of those lists are pinned by golden specs byte-for-byte against legacy
 * (see `ignore-abandon-write-paths.spec.ts` for the whole story), and the
 * owner's standing rule for this mode is "แยก path ใหม่ ห้ามกระทบของเดิม".
 * Everything here is pure functions — no DI, no @Injectable — so no test
 * module anywhere needs a new provider.
 *
 * ⚠️ BOOLEANS ARE CHECKED WITH `typeof`, NEVER COERCED. The global
 * ValidationPipe runs `enableImplicitConversion`, and `Boolean('false')` is
 * `true` — a DTO decorator would run AFTER that coercion and could not catch
 * it. The routes take the raw body (Record) so the pipe skips it and the
 * `typeof` below is the real guard. `"false"` เป็นสตริง truthy ห้าม coerce.
 *
 * ⚠️ ROWS ARE READ BEHAVIOURALLY. Hooks are read with `.lean()`, which skips
 * schema defaults, so every pre-existing row answers `undefined` for every
 * field here. A toggle is ON only when `=== true`; a scope widens only when it
 * is EXPLICITLY 'all' or 'slip'; anything else — absent, '', junk — reads as
 * the narrow default 'text'. absent ต้องแปลว่า "พฤติกรรมเดิมก่อนมีฟีเจอร์" เสมอ.
 *
 * revert: delete this folder plus the two service methods and two routes that
 * import it (`updateHookNotice`, `bulkUpdateHookNotice`, `PUT /hook/notice/:id`,
 * `PATCH /hook/notice/bulk`) and the seven @Prop lines in hook.schema.ts.
 */
import { BadRequestException } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';

export type NoticeScope = 'text' | 'all' | 'slip';

/** Owner 22/08/2026: "เตือนระบบฝากถอนมีผลกับ text, all, slip (เพิ่ม slip)". */
export const NOTICE_SCOPES: readonly NoticeScope[] = ['text', 'all', 'slip'];

export const NOTICE_TOGGLE_FIELDS = [
  'notice_deposit_status',
  'notice_withdraw_status',
  'follow_player_status',
  /* [FEAT-20260829-STATUSFIRST] the two night-window preference switches.
     In THIS list (default-off, `=== true`), NOT in NOTICE_CHECK_FLAG_FIELDS —
     that list's absent=ON polarity would flip every old OA on day one.
     Membership here is what lets `parseNoticeFields` accept them on
     `PUT /hook/notice/:id` and what makes the audit diff carry them. */
  'notice_deposit_sitestatus_first',
  'notice_withdraw_sitestatus_first',
] as const;

/**
 * [FEAT-20260823-NOTICECHECKFLAGS] The four check-wrapping flags — their OWN
 * list, deliberately NOT in NOTICE_TOGGLE_FIELDS although they are booleans.
 *
 * Two reasons, both load-bearing:
 *   1. POLARITY. Everything in NOTICE_TOGGLE_FIELDS is read absent=OFF
 *      (`readNoticeToggle`). These are read absent=ON (`readNoticeCheckFlag`),
 *      because absent must mean "exactly the behaviour before the column
 *      existed" — and before it existed, every check ran. Sharing the list
 *      would make the audit diff below report `false → true` for a flag that
 *      was effectively on all along — an audit row that lies.
 *   2. The card gate (NOTICE_CARD_PAIRS) is keyed by explicit field NAMES, so
 *      no list membership drags these into it — but keeping them out of the
 *      toggle list makes that fact visible instead of incidental.
 * ขั้วกลับกับ toggle เดิม · absent = เปิด = พฤติกรรมเดิม.
 */
export const NOTICE_CHECK_FLAG_FIELDS = [
  'notice_deposit_time_check',
  'notice_deposit_sitestatus_check',
  'notice_withdraw_time_check',
  'notice_withdraw_sitestatus_check',
] as const;

export const NOTICE_SCOPE_FIELDS = [
  'notice_deposit_scope',
  'notice_withdraw_scope',
] as const;

/**
 * Card bindings. Cards are GLOBAL documents (the same nature the per-reply-
 * state card map in hook-field-tabs.ts documents, and what lets clone fan one
 * card onto many OAs) — so these are settable on BOTH the per-hook route and
 * the bulk route, under one shared gate. Owner, 22/08 round 5 on the bulk
 * question: "เอาดีที่สุด ห้ามเป็นหนี้" — one rule everywhere, no special case.
 */
export const NOTICE_FLEX_FIELDS = [
  'notice_deposit_flex_id',
  'notice_withdraw_flex_id',
  // [R2] the off-service-time and slip cards from the full 13:21 spec —
  // cases A, C, E, F. Same gate as the two above on every route.
  'notice_deposit_offtime_flex_id',
  'notice_withdraw_offtime_flex_id',
  'notice_all_offtime_flex_id',
  'notice_all_disable_flex_id',
] as const;

export const NOTICE_FIELDS: readonly string[] = [
  ...NOTICE_TOGGLE_FIELDS,
  ...NOTICE_CHECK_FLAG_FIELDS,
  ...NOTICE_SCOPE_FIELDS,
  ...NOTICE_FLEX_FIELDS,
];

/**
 * D6 (owner: "ไม่ให้เซฟ เตือนเลือกให้ครบ") — a notice toggle may only be ON
 * when EVERY card its side needs is set, judged on the EFFECTIVE state after
 * the write. follow_player_status has no card and is deliberately absent.
 *
 * [R2] Each side now needs its disable card AND its off-time card (D16:
 * "เลือกให้ครบ" — the FE shows a warning modal, this gate is the backstop).
 * The two `all` cards belong to the slip path (cases E/F), which per D15 runs
 * off the DEPOSIT toggle — so they are required only when the deposit scope
 * is EFFECTIVELY 'slip' (`whenScope`). A deposit notice that never touches
 * slips must not demand slip cards. The clone pair-drag iterates this same
 * list, so every required card also rides along on a field-picked clone.
 */
export interface NoticeCardPair {
  status: string;
  flex: string;
  label: string;
  /** required only when this scope field's EFFECTIVE value equals `value`. */
  whenScope?: { field: string; value: NoticeScope };
}

export const NOTICE_CARD_PAIRS: readonly NoticeCardPair[] = [
  {
    status: 'notice_deposit_status',
    flex: 'notice_deposit_flex_id',
    label: 'deposit',
  },
  {
    status: 'notice_deposit_status',
    flex: 'notice_deposit_offtime_flex_id',
    label: 'deposit off-time',
  },
  {
    status: 'notice_withdraw_status',
    flex: 'notice_withdraw_flex_id',
    label: 'withdraw',
  },
  {
    status: 'notice_withdraw_status',
    flex: 'notice_withdraw_offtime_flex_id',
    label: 'withdraw off-time',
  },
  {
    status: 'notice_deposit_status',
    flex: 'notice_all_offtime_flex_id',
    label: 'all off-time',
    whenScope: { field: 'notice_deposit_scope', value: 'slip' },
  },
  {
    status: 'notice_deposit_status',
    flex: 'notice_all_disable_flex_id',
    label: 'all disable',
    whenScope: { field: 'notice_deposit_scope', value: 'slip' },
  },
];

export interface NoticeChange {
  field: string;
  from: unknown;
  to: unknown;
}

/** Normalised, validated subset of notice fields a request asked to write. */
export type NoticeCandidates = Record<string, unknown>;

/** Behavioural toggle read — `=== true`, the lean-row rule. */
export function readNoticeToggle(
  row: Record<string, unknown>,
  field: string,
): boolean {
  return row[field] === true;
}

/**
 * [FEAT-20260823-NOTICECHECKFLAGS] Check-flag read — `!== false`.
 *
 * THE ONE PLACE the flags' polarity lives. Absent, junk, a lean row that
 * predates the column — all read ON, because the checks always ran before the
 * flags existed and absent must change nothing. Only an explicit `false` turns
 * a check off. The proof fixture (notice-before-20260823.json) is asserted
 * against exactly this rule.
 * ⚠️ Never read these fields with `readNoticeToggle` — opposite polarity;
 * doing so silences every legacy hook at once. ขั้วกลับกัน ห้ามสลับ reader.
 */
export function readNoticeCheckFlag(
  row: Record<string, unknown>,
  field: string,
): boolean {
  return row[field] !== false;
}

/** Behavioural scope read — only an explicit known value counts; else 'text'. */
export function readNoticeScope(value: unknown): NoticeScope {
  return NOTICE_SCOPES.includes(value as NoticeScope)
    ? (value as NoticeScope)
    : 'text';
}

/** Behavioural card read — a non-empty id or null; ObjectIds stringified. */
export function readNoticeFlex(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  // A lean row holds an ObjectId here — its own toString IS the id text.
  const s = (value as { toString(): string }).toString();
  return s.length > 0 ? s : null;
}

/**
 * Validates the shape of a request body and returns ONLY the whitelisted,
 * normalised fields. Shape errors throw 400 with the field named — shape does
 * not depend on any row, so bulk callers validate ONCE, not per hook.
 * Unknown keys are ignored, the same stance every hook write path takes.
 */
export function parseNoticeFields(
  body: Record<string, unknown>,
): NoticeCandidates {
  const out: NoticeCandidates = {};

  for (const field of NOTICE_TOGGLE_FIELDS) {
    if (!(field in body)) continue;
    // A real boolean only — see the header for why coercion is forbidden.
    if (typeof body[field] !== 'boolean') {
      throw new BadRequestException(`${field} must be a boolean`);
    }
    out[field] = body[field];
  }

  /* [FEAT-20260823-NOTICECHECKFLAGS] same strictness as the toggles — a real
     boolean only, the string "false" is refused for the same reason. */
  for (const field of NOTICE_CHECK_FLAG_FIELDS) {
    if (!(field in body)) continue;
    if (typeof body[field] !== 'boolean') {
      throw new BadRequestException(`${field} must be a boolean`);
    }
    out[field] = body[field];
  }

  for (const field of NOTICE_SCOPE_FIELDS) {
    if (!(field in body)) continue;
    if (!NOTICE_SCOPES.includes(body[field] as NoticeScope)) {
      throw new BadRequestException(
        `${field} must be one of: ${NOTICE_SCOPES.join(', ')}`,
      );
    }
    out[field] = body[field];
  }

  for (const field of NOTICE_FLEX_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    if (
      value !== null &&
      !(typeof value === 'string' && isValidObjectId(value))
    ) {
      throw new BadRequestException(
        `${field} must be a flex message id or null`,
      );
    }
    out[field] = value;
  }

  if (Object.keys(out).length === 0) {
    throw new BadRequestException('no notice field to update');
  }
  return out;
}

/**
 * [FIX-20260822-CLONEUNDEF] Drop keys whose value is `undefined`.
 *
 * ⚠️ WHY A GATE NEEDS THIS. The clone path builds its update bag by comparing
 * `JSON.stringify(prev) !== JSON.stringify(next)`, and `JSON.stringify(undefined)`
 * is `undefined` — so a SOURCE row that never stored a field (every row created
 * before that field existed) still lands in the bag, as an explicit
 * `undefined`. Mongoose then strips undefined out of `$set`, so nothing is
 * written — but a gate reading the bag sees the key as PRESENT and reads its
 * value as "off" / "cleared". Both readings are wrong in opposite directions:
 *   · a toggle read as off skips the card requirement → the clone leaves a
 *     state the OA's own PUT route rejects, which is the lock-out this gate
 *     exists to prevent;
 *   · a card field read as cleared refuses a clone that would have changed
 *     nothing.
 * Judge the write on what will actually be written. undefined ไม่ใช่การเขียน.
 */
export function withoutUndefined(
  bag: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bag)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * D6 gate. Returns the violation message for the EFFECTIVE state a write would
 * leave behind (candidates over row), or null when the write is legal.
 * Returns instead of throwing so the bulk path can collect per-hook refusals
 * into one all-or-nothing BlockedHooksException.
 */
export function noticeCardViolation(
  candidates: NoticeCandidates,
  row: Record<string, unknown>,
): string | null {
  for (const pair of NOTICE_CARD_PAIRS) {
    const status =
      pair.status in candidates
        ? candidates[pair.status] === true
        : readNoticeToggle(row, pair.status);
    if (!status) continue;
    if (pair.whenScope) {
      // [R2] slip-only requirements: judged on the EFFECTIVE scope, same
      // candidates-over-row rule as everything else in this gate.
      const scope =
        pair.whenScope.field in candidates
          ? readNoticeScope(candidates[pair.whenScope.field])
          : readNoticeScope(row[pair.whenScope.field]);
      if (scope !== pair.whenScope.value) continue;
    }
    const flex =
      pair.flex in candidates
        ? readNoticeFlex(candidates[pair.flex])
        : readNoticeFlex(row[pair.flex]);
    if (!flex) {
      return `${pair.label} notice needs a flex card before it can be on`;
    }
  }
  return null;
}

/**
 * Behavioural diff — which candidates actually MOVE this row. Writing 'text'
 * onto an absent scope, or false onto an absent toggle, changes nothing and is
 * reported as no change, so audits stay honest and repeated calls leave no
 * rows (the precedent every bulk sibling sets). แถวที่ไม่ขยับ = ไม่เขียน ไม่ audit.
 */
export function diffNoticeChanges(
  candidates: NoticeCandidates,
  row: Record<string, unknown>,
): NoticeChange[] {
  const changes: NoticeChange[] = [];
  for (const [field, value] of Object.entries(candidates)) {
    let from: unknown;
    let to: unknown;
    if ((NOTICE_TOGGLE_FIELDS as readonly string[]).includes(field)) {
      from = readNoticeToggle(row, field);
      to = value === true;
    } else if (
      (NOTICE_CHECK_FLAG_FIELDS as readonly string[]).includes(field)
    ) {
      /* [FEAT-20260823-NOTICECHECKFLAGS] absent=ON polarity — reading `from`
         with the toggle rule would log `false → true` for a check that was
         effectively on the whole time. อ่านด้วย reader ของมันเอง audit ถึงไม่โกหก */
      from = readNoticeCheckFlag(row, field);
      to = value !== false;
    } else if ((NOTICE_SCOPE_FIELDS as readonly string[]).includes(field)) {
      from = readNoticeScope(row[field]);
      to = readNoticeScope(value);
    } else {
      from = readNoticeFlex(row[field]);
      to = readNoticeFlex(value);
    }
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}
