import { IsOptional, IsString } from 'class-validator';

/**
 * [FEAT-20260820-REGINSIGHT] query for GET /api/insight-reports/registrations.
 * Same field names and Bangkok-date semantics as TicketInsightsQueryDto so the
 * FE passes the exact params it already knows how to build.
 */
export class RegistrationInsightsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  start_time?: string;

  @IsOptional()
  @IsString()
  end_time?: string;

  @IsOptional()
  @IsString()
  line_oa_hook_id?: string;
}
