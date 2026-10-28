import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class BulkUpdatePermissionsDto {
  @ApiProperty({ description: 'User ObjectIds to update' })
  @IsArray()
  @IsString({ each: true })
  user_ids!: string[];

  @ApiProperty({ description: 'Permissions list to set' })
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}
