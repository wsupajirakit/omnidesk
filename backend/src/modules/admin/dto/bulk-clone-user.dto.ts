import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class CloneUserItemDto {
  @ApiProperty({ description: 'Username for cloned account' })
  @IsString()
  username!: string;

  @ApiProperty({ description: 'Password for cloned account' })
  @IsString()
  password!: string;

  @ApiPropertyOptional({ description: 'Display name' })
  @IsOptional()
  @IsString()
  display_name?: string;

  @ApiPropertyOptional({ description: 'Email address' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: 'Phone number' })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class BulkCloneUsersDto {
  @ApiProperty({ type: [CloneUserItemDto], description: 'Users to create' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CloneUserItemDto)
  users!: CloneUserItemDto[];
}
