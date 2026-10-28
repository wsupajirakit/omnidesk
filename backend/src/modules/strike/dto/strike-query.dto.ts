import { IsOptional, IsString } from 'class-validator';

/**
 * [FEAT-20260824-STRIKESESSION] Query for GET /api/strikes/summary.
 *
 * ⚠️ Dates arrive as strings and are parsed by the caller-facing layer, not by
 * `StrikeService`. This codebase has exactly one place that turns a Bangkok
 * wall-clock date into a UTC instant — `tickets/insight-reports.service.ts:24-70`,
 * which carries the note about the day-boundary bug a second implementation
 * caused. This DTO deliberately does not grow a second one.
 *
 * Field names mirror `RegistrationInsightsQueryDto` so the dashboard can reuse
 * the params it already builds for the other insight cards.
 */
export class StrikeSummaryQueryDto {
  /** `YYYY-MM-DD`. Absent = the last 7 days. */
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  /** Narrow to one OA. Absent = every OA the caller can already see. */
  @IsOptional()
  @IsString()
  line_oa_hook_id?: string;
}
