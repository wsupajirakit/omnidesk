import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * `label` and `path` are required BY THE SCHEMA, which is the only place legacy
 * declares them — it hands the raw body to `new Menu(...)` and lets
 * `Menu.save()` produce ``Menu validation failed: label: Path `label` is
 * required.`` Asserting presence here would answer first with a different
 * sentence, and would have to be kept in step with the schema by hand.
 */
export class CreateMenuDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  path?: string;

  @IsOptional()
  @IsString()
  parent_menu?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_permissions?: string[];

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

export class UpdateMenuDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  path?: string;

  @IsOptional()
  @IsString()
  parent_menu?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_permissions?: string[];

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
