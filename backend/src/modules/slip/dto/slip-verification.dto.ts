/**
 * DTOs for the slip-verification endpoints.
 *
 * LIFTED from legacy-api/src/controllers/slip/slipVerificationController.js.
 *
 * The legacy handler builds its payload by reading a fixed list of body keys and
 * ignores everything else, so validation here is deliberately permissive: every
 * field optional, unknown keys rejected by the global pipe. Making a field
 * required would answer 400 where legacy answers 201/400-from-mongoose, which is
 * a parity break, not a hardening win.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

/** Body of `POST /api/slip-verifications` and `PUT /api/slip-verifications/:id`. */
export class SlipVerificationPayloadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  transaction_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  api_status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trans_ref?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sender_account_no?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sender_account_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sender_bank?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiver_account_no?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiver_account_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiver_bank?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  slip_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  internal_content_id?: string;

  /** Free-form: legacy stores whatever arrives under Mixed. */
  @ApiPropertyOptional()
  @IsOptional()
  raw_content?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  raw_response?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/** Query string of `GET /api/slip-verifications`. */
export class ListSlipVerificationsQueryDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  api_status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  start_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  end_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sort?: string;
}
