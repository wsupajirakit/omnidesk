import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsString } from 'class-validator';

export class BulkUpdateActiveDto {
  @ApiProperty({ description: 'User ObjectIds to update' })
  @IsArray()
  @IsString({ each: true })
  user_ids!: string[];

  @ApiProperty({ description: 'New active state' })
  @IsBoolean()
  active!: boolean;
}
