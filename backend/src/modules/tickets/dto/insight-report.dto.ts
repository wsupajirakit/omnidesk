import { IsOptional, IsString } from 'class-validator';

export class TicketInsightsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  start_time?: string;

  @IsOptional()
  @IsString()
  end_time?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  line_oa_hook_id?: string;

  @IsOptional()
  @IsString()
  admin_user_id?: string;
}
