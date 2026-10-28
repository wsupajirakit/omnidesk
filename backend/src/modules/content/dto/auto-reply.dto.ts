import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class AutoReplyResponseDto {
  @IsString()
  @IsNotEmpty()
  type!: 'text' | 'image' | 'flex';

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  image_url?: string;

  @IsOptional()
  flex_json?: unknown;
}

/**
 * `keyword`, `match_type`, `hook_ids` and `response` are required — the service
 * rejects them in legacy's order (`keyword`, `match_type`, `hook_ids`,
 * `assign_group`, `response`, `priority`, `mode`). See `CreateBroadcastDto` for
 * why presence is not asserted at this layer.
 */
export class CreateAutoReplyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  match_type?: 'exact' | 'contains' | 'regex' | 'loose' | 'fuzzy';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hook_ids?: string[];

  @IsOptional()
  assign_group?: unknown;

  @IsOptional()
  response?: AutoReplyResponseDto;

  @IsOptional()
  mode?: string | null;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  audit_note?: string;
}

export class UpdateAutoReplyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  match_type?: 'exact' | 'contains' | 'regex' | 'loose' | 'fuzzy';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hook_ids?: string[];

  @IsOptional()
  assign_group?: unknown;

  @IsOptional()
  response?: AutoReplyResponseDto;

  @IsOptional()
  mode?: string | null;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  audit_note?: string;
}

/**
 * `active` is required, and the service says so in legacy's words —
 * `active is required`, not class-validator's `active should not be empty`. It
 * also separates "absent" from "present but unparseable" (`active must be 0/1
 * or true/false`), a distinction `@IsNotEmpty()` collapses.
 */
export class UpdateAutoReplyActiveDto {
  @IsOptional()
  active?: boolean | number | string;
}
