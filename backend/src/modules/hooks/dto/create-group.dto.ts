import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Body of POST /api/groups.
 *
 * Deliberately loose where legacy is loose: `group_name` is validated in the
 * service (trim, then "required" if empty) so that a whitespace-only value
 * returns legacy's exact 400 `group_name is required` rather than a
 * ValidationPipe envelope, which the dashboard does not parse.
 *
 * `status` accepts anything because legacy coerces with `Boolean(...)` — a
 * stricter `@IsBoolean()` here would reject bodies legacy accepts.
 */
export class CreateGroupDto {
  @ApiProperty({ description: 'Group display name' })
  @IsOptional()
  @IsString()
  group_name?: string;

  @ApiPropertyOptional({ description: 'Free-text description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Active flag; coerced with Boolean()' })
  @IsOptional()
  status?: unknown;
}
