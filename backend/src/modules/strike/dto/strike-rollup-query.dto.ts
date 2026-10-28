import { IsIn, IsISO8601, IsOptional } from 'class-validator';

/**
 * [FEAT-20260826-STRIKEROLLUP] Query for `GET /api/strikes/:lineUserId/rollup`.
 *
 * ⚠️ THIS TAKES INSTANTS, NOT `YYYY-MM-DD` — and that is a deliberate departure
 * from its sibling `StrikeSummaryQueryDto`, so read why before "fixing" it.
 *
 * Turning a Bangkok wall-clock date into a UTC instant happens in exactly ONE
 * place in this codebase — `parseBangkokDate`, exported from
 * `tickets/insight-reports.service.ts` — and that file carries the note about
 * the day-boundary bug a second implementation already caused once. So there are
 * only two ways to accept `YYYY-MM-DD` here, and both are closed:
 *
 *   import that function → `strike.module.ts` states, as an owner requirement,
 *     that this module imports NOTHING from another feature module. Importing
 *     from `tickets` would end the property that makes this feature deletable
 *     in one folder.
 *   write a second parser → exactly what `strike-query.dto.ts` forbids.
 *
 * Accepting a full instant sidesteps both: there is no timezone arithmetic in
 * this module at all, which is also how `StrikeService.summarize` already
 * behaves (it takes `Date` and does no date maths). This is not a new precedent,
 * it is the existing one written down.
 *
 * ⇒ THE CALLER CONVERTS. A dashboard asking for "today in Bangkok" sends the
 *   instants for that day.
 *   คนเรียกเป็นคนแปลงเวลาไทยเป็น instant เอง โมดูลนี้ไม่ยุ่งกับ timezone เลย
 *
 * ⚠️ A BARE `YYYY-MM-DD` IS ACCEPTED BY THE VALIDATOR — measured 26/08, not
 * assumed: `@IsISO8601({strict:true})` passes `2026-08-19` because a date-only
 * string IS valid ISO-8601. It then becomes UTC midnight, which is 07:00 in
 * Bangkok, so a caller who sends one silently loses the first seven hours of
 * that day. The validator cannot catch this and no rule here pretends it does;
 * it is the caller's contract, stated in `docs/strike-session.md`.
 *
 * revert: delete this file with the route that uses it.
 */
export class StrikeRollupQueryDto {
  /**
   * ISO-8601 instant, e.g. `2026-08-19T17:00:00.000Z`.
   *
   * `@IsISO8601({strict:true})` rather than a bare one — measured 26/08, not
   * assumed: without `strict` the string `2026-02-31` VALIDATES, then reaches
   * `new Date()` and rolls over into March, so a query would silently run
   * against a day the caller never asked for. With it, that string is rejected.
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  /**
   * Which sessions to fold — "cleared", "not cleared yet", or everything.
   *
   * The three values map onto the `status` the sessions already hold; no new
   * field, no migration, nothing stored. `open` returns at most ONE session by
   * construction — the partial unique index on `{line_user_id, status:'open'}`
   * makes a second one impossible — so a `sessions_counted` of 1 there is the
   * database working, not a truncated answer.
   *
   * ⚠️ Meaningless together with `from`/`to`: that path counts EVENTS, and an
   * event does not know whether the session it belongs to was later cleared.
   * The controller rejects the combination rather than ignoring it, because a
   * filter that is silently dropped returns a plausible number for a question
   * nobody asked. ส่งคู่กับช่วงเวลาไม่ได้ — ต้อง 400 ไม่ใช่เงียบ
   */
  @IsOptional()
  @IsIn(['all', 'open', 'closed'])
  session_status?: 'all' | 'open' | 'closed';
}
