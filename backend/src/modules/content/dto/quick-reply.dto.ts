import { IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Presence is NOT asserted here on purpose — see `CreateQuickReplyDto`.
 */
export class CreateQuickReplyCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  order?: number;
}

export class UpdateQuickReplyCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  order?: number;
}

/**
 * ── why `text` and `category_id` are optional here ──────────────────────────
 *
 * Both are REQUIRED — the service rejects a body without them. They carry no
 * presence constraint because class-validator reports every failed constraint
 * at once, in decorator order, whereas legacy validates field by field and
 * returns the FIRST failure ("Text is required" before category_id). Asserting
 * presence at this layer changes which message the operator sees, and for a
 * body missing both fields it changes it to the wrong one.
 *
 * The type constraints stay: they are what stops an object or an operator
 * (`{ $ne: null }`) reaching a query, and legacy has no equivalent.
 */
export class CreateQuickReplyDto {
  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsNumber()
  order?: number;
}

export class UpdateQuickReplyDto {
  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsNumber()
  order?: number;
}
