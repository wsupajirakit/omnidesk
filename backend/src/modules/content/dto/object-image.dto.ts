import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateObjectImageDto {
  @IsOptional()
  @IsString()
  detail?: string;

  @IsOptional()
  matching_tag?: unknown;

  @IsOptional()
  @IsString()
  img_path?: string;

  @IsOptional()
  @IsString()
  storage?: string;

  @IsOptional()
  @IsString()
  file_type?: string;

  @IsArray()
  @IsString({ each: true })
  categories!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  group_providers?: string[];

  /* [FEAT-20260901-OBJSCOPE] OA scope + on/off, alongside the group scope that
     was already here. Absent leaves the stored value untouched. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hook_ids?: string[];

  @IsOptional()
  @IsBoolean()
  status?: boolean;

  @IsOptional()
  @IsString()
  response_type?: string;
}

export class UpdateObjectImageDto {
  @IsOptional()
  @IsString()
  detail?: string;

  @IsOptional()
  matching_tag?: unknown;

  @IsOptional()
  @IsString()
  img_path?: string;

  @IsOptional()
  @IsString()
  storage?: string;

  @IsOptional()
  @IsString()
  file_type?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  group_providers?: string[];

  /* [FEAT-20260901-OBJSCOPE] OA scope + on/off, alongside the group scope that
     was already here. Absent leaves the stored value untouched. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hook_ids?: string[];

  @IsOptional()
  @IsBoolean()
  status?: boolean;

  @IsOptional()
  @IsString()
  response_type?: string;
}
