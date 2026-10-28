import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Body of PUT /api/groups/:id.
 *
 * Every field is optional: legacy treats `undefined` as "leave alone" and only
 * a present key participates in the changed-fields audit entry. Validation of
 * an empty `group_name` happens in the service, for the same reason as
 * CreateGroupDto.
 */
export class UpdateGroupDto {
  @ApiPropertyOptional({ description: 'New group display name' })
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
