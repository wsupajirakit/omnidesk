import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class KillUserSessionsDto {
  @ApiPropertyOptional({ description: 'Target user ObjectId' })
  @IsOptional()
  @IsString()
  user_id?: string;
}
