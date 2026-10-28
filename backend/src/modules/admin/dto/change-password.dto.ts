import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password' })
  @IsString()
  @MinLength(1)
  old_password!: string;

  @ApiProperty({ description: 'New password' })
  @IsString()
  @MinLength(1)
  password!: string;
}
