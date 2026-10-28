import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordWithTempKeyDto {
  @ApiProperty({ description: 'Temporary key received from administrator' })
  @IsString()
  @MinLength(1)
  temp_key!: string;

  @ApiProperty({ description: 'New password' })
  @IsString()
  @MinLength(1)
  password!: string;
}
