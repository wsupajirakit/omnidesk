import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * [FEAT-20260824-STRIKESESSION] Body of PATCH /api/strikes/sessions/:id.
 *
 * ⚠️ `status` accepts ONLY `'closed'`. Re-opening a closed session is not
 * supported and that is a decision, not an omission: closing already opened the
 * NEXT session, so flipping the old one back would leave two open rows and the
 * partial unique index would reject it. If an admin closes the wrong one, the
 * fix is to close the new one too and read the old one in the history — not to
 * rewind. Adding a real undo means designing what happens to the strikes
 * recorded in between, which is not part of this phase.
 * ปิดผิดใบ = ไปดูในประวัติ ไม่ใช่ย้อนสถานะ
 */
export class PatchStrikeSessionDto {
  @IsIn(['closed'])
  status!: 'closed';

  /** Free text shown next to the closer's name in the history. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
