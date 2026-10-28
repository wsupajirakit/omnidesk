import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GenerateTempKeyDto {
  @ApiProperty({ description: 'User ObjectId' })
  @IsString()
  user_id!: string;
}
