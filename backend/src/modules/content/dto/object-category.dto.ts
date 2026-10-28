import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * `name` is required; the service rejects a body without it with legacy's
 * `name is required`. See `CreateQuickReplyDto` for why presence is asserted
 * there and not here.
 */
export class CreateObjectCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  api_key?: string;
  /* [FEAT-20260901-OBJSCOPE] Scope + switch. All optional and all absent-tolerant:
     omitting them leaves the stored value alone, and an absent scope means
     unrestricted. Shaped exactly like `CreateObjectImageDto.group_providers`. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  group_providers?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hook_ids?: string[];

  @IsOptional()
  @IsBoolean()
  status?: boolean;
}

export class UpdateObjectCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  api_key?: string;
  /* [FEAT-20260901-OBJSCOPE] Scope + switch. All optional and all absent-tolerant:
     omitting them leaves the stored value alone, and an absent scope means
     unrestricted. Shaped exactly like `CreateObjectImageDto.group_providers`. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  group_providers?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hook_ids?: string[];

  @IsOptional()
  @IsBoolean()
  status?: boolean;
}
