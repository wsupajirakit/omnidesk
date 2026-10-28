import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: 'Unique username' })
  @IsString()
  @MinLength(1)
  username!: string;

  @ApiProperty({ description: 'Plaintext password' })
  @IsString()
  @MinLength(1)
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

  @ApiPropertyOptional({ description: 'Assigned Role ObjectId' })
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

  @ApiPropertyOptional({ description: 'Direct permissions array' })
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
