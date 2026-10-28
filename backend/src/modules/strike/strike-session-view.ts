/**
 * [FEAT-20260827-ADMINBLOCK] A session as the API returns it — plain data, no
 * Mongoose document.
 *
 * MOVED OUT of `strike.service.ts` on 27/08, and the WHY matters: that file
 * sat at 399 countable lines — one under the repo's max-lines ratchet — so the
 * admin-block work could not add a line to it without minting a brand-new
 * warning, and the waiver list only shrinks. The same rule already split the
 * gate out of the service on 26/08 (see strike-gate.service.ts header). The
 * service re-exports this type, so every existing import keeps working
 * unchanged. ไฟล์เดิมชนเพดาน ratchet — ย้าย type ออก โดย import เดิมไม่ต้องแก้สักที่
 *
 * revert: paste the interface back into `strike.service.ts` and delete this file.
 */
export interface StrikeSessionView {
  _id: string;
  line_user_id: string;
  member_id?: string;
  seq: number;
  status: string;
  strike_total: number;
  by_level: Record<string, number>;
  first_strike_at?: Date;
  last_strike_at?: Date;
  opened_at: Date;
  closed_at?: Date;
  closed_by?: string;
  closed_reason?: string;
  /* [FEAT-20260827-ADMINBLOCK] the latch + its admin attribution. `suspended_at`
     always rode along at runtime (lean + spread); declared now so the type
     stops under-reporting what the FE already reads. The two `suspended_*`
     admin fields exist only on admin-minted rows — see the schema note. */
  suspended_at?: Date;
  suspended_by?: string;
  suspended_reason?: string;
}
