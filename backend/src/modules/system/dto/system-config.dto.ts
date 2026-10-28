import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Body of `POST /config`.
 *
 * `value` is deliberately untyped: the legacy collection stores strings,
 * numbers and whole objects under the same field, so constraining it here would
 * reject configs the dashboard can already create.
 */
export class CreateSystemConfigDto {
  @ApiProperty({ description: 'Unique config key' })
  // Message copied from systemConfigController.js — legacy validates inside the
  // handler, so the dashboard renders this exact string. class-validator's
  // default ("key must be longer than or equal to 1 characters") would change
  // what the operator reads.
  @IsString({ message: 'config key is required' })
  @MinLength(1, { message: 'config key is required' })
  key!: string;

  @ApiPropertyOptional({ description: 'Config value (mixed type)' })
  @IsOptional()
  value?: unknown;

  @ApiPropertyOptional({ description: 'Config flag/bucket' })
  @IsOptional()
  @IsNumber()
  flag?: number;

  @ApiPropertyOptional({ description: 'Human readable detail' })
  @IsOptional()
  @IsString()
  detail?: string;

  @ApiPropertyOptional({ description: 'Request path for custom requests' })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({ description: 'Ordering priority' })
  @IsOptional()
  @IsNumber()
  priority?: number;

  @ApiPropertyOptional({
    description: 'Whether the custom request needs a JWT',
  })
  @IsOptional()
  @IsBoolean()
  require_jwt?: boolean;

  @ApiPropertyOptional({ description: 'HTTP method for custom requests' })
  @IsOptional()
  @IsString()
  custom_method?: string;

  @ApiPropertyOptional({ description: 'Raw curl template' })
  @IsOptional()
  @IsString()
  custom_x_curl?: string;

  @ApiPropertyOptional({ description: 'Condition expression' })
  @IsOptional()
  @IsString()
  custom_condition?: string;
}

/**
 * Body of `PUT /config/:id`.
 *
 * Every field is optional and `key` is updatable, matching the legacy
 * `updateConfigById` allowlist exactly — it copies across only the fields it
 * names, and an empty result is rejected with "Nothing to update".
 */
export class UpdateSystemConfigDto {
  @ApiPropertyOptional({ description: 'Unique config key' })
  @IsOptional()
  @IsString()
  key?: string;

  @ApiPropertyOptional({ description: 'Config value (mixed type)' })
  @IsOptional()
  value?: unknown;

  @ApiPropertyOptional({ description: 'Config flag/bucket' })
  @IsOptional()
  @IsNumber()
  flag?: number;

  @ApiPropertyOptional({ description: 'Human readable detail' })
  @IsOptional()
  @IsString()
  detail?: string;

  @ApiPropertyOptional({ description: 'Request path for custom requests' })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({ description: 'Ordering priority' })
  @IsOptional()
  @IsNumber()
  priority?: number;

  @ApiPropertyOptional({
    description: 'Whether the custom request needs a JWT',
  })
  @IsOptional()
  @IsBoolean()
  require_jwt?: boolean;

  @ApiPropertyOptional({ description: 'HTTP method for custom requests' })
  @IsOptional()
  @IsString()
  custom_method?: string;

  @ApiPropertyOptional({ description: 'Raw curl template' })
  @IsOptional()
  @IsString()
  custom_x_curl?: string;

  @ApiPropertyOptional({ description: 'Condition expression' })
  @IsOptional()
  @IsString()
  custom_condition?: string;
}

/** Body of `POST /config/test-custom` — an operator-driven outbound probe. */
export class TestCustomRequestDto {
  @ApiProperty({ description: 'Target URL to call' })
  // systemConfigController.js:176 — legacy's own wording, rendered verbatim
  // by the dashboard.
  @IsString({ message: 'url is required' })
  @MinLength(1, { message: 'url is required' })
  url!: string;

  @ApiPropertyOptional({ description: 'HTTP method (default POST)' })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ description: 'Request headers' })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Request body' })
  @IsOptional()
  data?: unknown;
}
