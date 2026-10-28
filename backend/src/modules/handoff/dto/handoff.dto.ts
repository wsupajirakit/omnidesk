/**
 * DTOs for the handoff endpoints.
 *
 * LIFTED from the legacy handoff controllers. Validation is deliberately
 * permissive on the write bodies: the legacy handlers accept an arbitrary
 * object and let Mongoose's `strict: true` drop unknown keys, so declaring
 * required fields here would answer 400 where legacy answers 201 — a parity
 * break dressed up as hardening. The field-level checks legacy DOES perform
 * (key charset, `env_tag`, config registry) live in the services, before any
 * database access, exactly as they do in legacy.
 *
 * Query DTOs keep every value a string because the legacy handlers read
 * `req.query` and coerce with `Number(...)` themselves; parsing earlier would
 * change what a malformed `?page=abc` does.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** Query of `GET /api/handoff/targets`. */
export class ListTargetsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  /** `'true'` / `'false'`; anything else leaves the filter off. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  enabled?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hook_id?: string;
}

/** Query of `GET /api/handoff/jobs`. */
export class ListJobsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  target_key?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject_id?: string;
}

/** Query of `GET /api/handoff/callbacks`. */
export class ListCallbacksQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  match_status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  target_key?: string;
}

/** Query of `GET /api/handoff/overrides`. */
export class ListOverridesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hook_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  target_key?: string;
}

/** Query of `GET /api/handoff/chain-runs`. */
export class ListRunsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  limit?: string;

  /** Compared against the literal string `'true'`, as legacy does. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  needs_review?: string;

  /**
   * [FEAT-20260809-DATERANGE] Inclusive `created_at` window.
   *
   * Accepts a bare `YYYY-MM-DD`, which is read as a BANGKOK calendar day, or a full ISO
   * instant, which is used as given. Kept as a plain string (not @IsDateString) so a
   * malformed value is IGNORED rather than 400-ing the whole page — same forgiving
   * contract the webhook-log list already offers. Windows wider than MAX_RANGE_DAYS are
   * clamped server-side; see `common/utils/date-range.ts`.
   */
  @ApiPropertyOptional({ description: 'YYYY-MM-DD (Bangkok) or ISO instant' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD (Bangkok) or ISO instant' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chain_key?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  slip_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

/** Body of `POST /api/handoff/callbacks/:id/attach`. */
export class AttachCallbackDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  job_id?: string;
}

/** Body of `POST /api/handoff/callbacks/:id/dismiss`. */
export class DismissCallbackDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
