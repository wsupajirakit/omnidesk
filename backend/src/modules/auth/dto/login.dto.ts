import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Login credentials.
 *
 * The global ValidationPipe runs with `whitelist` and `forbidNonWhitelisted`,
 * so anything not declared here is rejected before a handler sees it. That is
 * what stops `$`-prefixed operators in a JSON body from reaching a Mongo query.
 */
export class LoginDto {
  @ApiProperty({ example: 'operator' })
  @IsString({ message: 'username and password are required' })
  @MinLength(1, { message: 'username and password are required' })
  username!: string;

  @ApiProperty()
  @IsString({ message: 'username and password are required' })
  @MinLength(1, { message: 'username and password are required' })
  password!: string;
}
