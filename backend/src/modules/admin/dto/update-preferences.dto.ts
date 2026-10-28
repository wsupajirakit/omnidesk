import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ description: 'Preferences payload object' })
  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;

  [key: string]: unknown;
}
