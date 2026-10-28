import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Body of `PUT /api/translation-dict` (upsert).
 *
 * The three nullable identity columns (`custom_tool_id`, `path_canon`,
 * `scope`) are what make a row unique alongside `dict_name` + `key`. Omitting
 * one means "base layer", never "match anything" — the legacy filter used only
 * three of the five columns and silently overwrote a different row.
 */
export class UpsertTranslationDto {
  // translationDictController.js:223 checks both fields together and answers
  // with one Thai sentence. Both constraints carry it so the deduplicating
  // exceptionFactory collapses them back to exactly that string.
  @ApiProperty({ description: 'Dictionary name' })
  @IsString({ message: 'ต้องมี dict_name และ key' })
  @MinLength(1, { message: 'ต้องมี dict_name และ key' })
  dict_name!: string;

  @ApiProperty({ description: 'Key being translated' })
  @IsString({ message: 'ต้องมี dict_name และ key' })
  @MinLength(1, { message: 'ต้องมี dict_name และ key' })
  key!: string;

  @ApiPropertyOptional({ description: 'Thai translation' })
  @IsOptional()
  @IsString()
  value_th?: string;

  @ApiPropertyOptional({ description: 'English translation' })
  @IsOptional()
  @IsString()
  value_en?: string;

  @ApiPropertyOptional({ description: 'Thai description for admins' })
  @IsOptional()
  @IsString()
  desc_th?: string;

  @ApiPropertyOptional({ description: 'Web scope code, null = every scope' })
  @IsOptional()
  @IsString()
  scope?: string | null;

  @ApiPropertyOptional({ description: 'Path this override applies to' })
  @IsOptional()
  @IsString()
  path_canon?: string | null;

  @ApiPropertyOptional({ description: 'Custom tool this override belongs to' })
  @IsOptional()
  @IsString()
  custom_tool_id?: string | null;
}

/**
 * Query of `GET /api/translation-dict/rows`.
 *
 * Everything stays a string: legacy coerces with `Number(...) || default` and
 * clamps afterwards, so `page=abc` must fall back to 1 rather than 400. Typing
 * these as numbers would make the validation pipe reject inputs legacy accepts.
 */
export class ListTranslationRowsDto {
  @ApiPropertyOptional({ description: 'Page number, defaults to 1' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ description: 'Rows per page, 1–500, defaults to 50' })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({ description: 'Filter by dictionary name' })
  @IsOptional()
  @IsString()
  dict?: string;

  @ApiPropertyOptional({ description: 'Search key / Thai / English value' })
  @IsOptional()
  @IsString()
  q?: string;
}
