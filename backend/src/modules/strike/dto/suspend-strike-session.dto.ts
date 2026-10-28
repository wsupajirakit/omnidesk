import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * [FEAT-20260827-ADMINBLOCK] Body of POST /api/strikes/:lineUserId/suspend.
 * 📖 PLAN: `todo/task/27082026/todo8_27082026_admin-block-suspend.md`
 *
 * Only the reason — WHO is blocking comes from the verified token, never from
 * input, and WHOM from the path. Same length rule as the clear's reason so the
 * two admin actions stay symmetric. revert: delete with the route.
 */
export class SuspendStrikeSessionDto {
  /** Free text stored as `suspended_reason` and echoed into the audit row. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
