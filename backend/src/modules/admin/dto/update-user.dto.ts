import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'New username' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ description: 'New password' })
  @IsOptional()
  @IsString()
  password?: string;

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

  @ApiPropertyOptional({ description: 'Account active flag' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Role ObjectId' })
  @IsOptional()
  @IsString()
  role_id?: string;

  @ApiPropertyOptional({ description: 'Assigned Group ObjectIds' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groups?: string[];

  @ApiPropertyOptional({ description: 'Alias for groups' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  group_ids?: string[];

  @ApiPropertyOptional({ description: 'Permissions array' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @ApiPropertyOptional({ description: 'Allowed Hook ObjectIds' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowed_hooks?: string[];

  @ApiPropertyOptional({ description: 'Alias for allowed_hooks' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hook_ids?: string[];
}
