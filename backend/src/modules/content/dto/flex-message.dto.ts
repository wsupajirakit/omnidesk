import {
  Allow,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * DTOs for `/api/flex-messages`.
 *
 * `content_json` is deliberately untyped: it holds a raw LINE Flex payload, and
 * pinning a shape here would reject cards the provider already accepts. It is
 * only ever stored and echoed, never interpreted by this service.
 *
 * `content_tags` is likewise loose at the pipe: legacy accepts four different
 * shapes (canonical array, label-only array, string array, numbered object) and
 * answers 400 with a specific Thai reason for anything else. That reasoning
 * lives in `normalizeContentTags`, so validating the shape here as well would
 * produce a *different* 400 message for the same input and break parity.
 *
 * ⚠️ Both use `@Allow()`, not a bare `@IsOptional()` or `@IsDefined()`. The
 * global pipe runs `whitelist` + `forbidNonWhitelisted`, and those two
 * decorators do not register the property as known — so the field was rejected
 * with "property content_json should not exist" before the handler ever ran,
 * turning legacy's "name and content_json are required" into a different 400.
 * The golden diff caught it; `@Allow()` is the decorator that whitelists a
 * property without constraining its shape.
 */
export class CreateFlexMessageDto {
  /**
   * `@Allow()` rather than `@IsString()`: legacy checks `!name || !content_json`
   * inside the handler and answers "name and content_json are required". A pipe
   * constraint would answer a *different* 400 first, so the required-field
   * message would never be reached.
   */
  @Allow()
  name!: string;

  @Allow()
  content_json!: unknown;

  @IsOptional()
  @IsString()
  flex_type?: string;

  /**
   * [FEAT-20260829-FLEXMENUTYPE] which menu this card belongs to (`main`/`sub`).
   * Meaningful only alongside `flex_type: 'menu'` — the service forces null for
   * every other type, so sending it on another card is harmless rather than a 400.
   */
  @IsOptional()
  @IsString()
  flex_sub_type?: string;

  /**
   * [FEAT-20260829-FLEXMENUSLUG] optional free-text label, menu cards only.
   * Blank is a legal value and stores null; the service forces null for every
   * other type, so sending it elsewhere is harmless rather than a 400.
   */
  @IsOptional()
  @IsString()
  flex_slug?: string;

  @IsOptional()
  @IsString()
  source_role?: string | null;

  @Allow()
  source_roles?: unknown;

  @Allow()
  content_tags?: unknown;

  /* [FEAT-20260810-CARDTICKET] open a direct ticket once this card's reply is
     delivered, using `direct_ticket_text` as the reason an admin reads. Optional and
     off by default ⇒ omitting both keeps the previous behaviour exactly. */
  @IsOptional()
  @IsBoolean()
  direct_ticket_on_reply?: boolean;

  @IsOptional()
  @IsString()
  direct_ticket_text?: string;

  @IsOptional()
  @IsString()
  callback_detail?: string;

  @IsOptional()
  @IsString()
  callback_tag?: string;

  @IsOptional()
  @IsArray()
  group_ids?: unknown[];

  /**
   * Opt-in: also tick this card on every hook in its groups.
   *
   * Legacy compares with `=== true`, so any other value is a no-op rather than
   * an error. Kept as a strict boolean here for the same effect.
   */
  @IsOptional()
  @IsBoolean()
  grant_all_hooks?: boolean;
}

/**
 * Update is fully partial and *absence is meaningful*: a field that is not sent
 * is left untouched, which is how the older form and direct API callers keep
 * working. `content_tags: []` therefore means "clear the slots" while omitting
 * it means "leave them alone" — the two must stay distinguishable.
 */
export class UpdateFlexMessageDto {
  @IsOptional()
  @IsString()
  name?: string;

  @Allow()
  content_json?: unknown;

  @IsOptional()
  @IsString()
  flex_type?: string;

  /**
   * [FEAT-20260829-FLEXMENUTYPE] which menu this card belongs to (`main`/`sub`).
   * Meaningful only alongside `flex_type: 'menu'` — the service forces null for
   * every other type, so sending it on another card is harmless rather than a 400.
   */
  @IsOptional()
  @IsString()
  flex_sub_type?: string;

  /**
   * [FEAT-20260829-FLEXMENUSLUG] optional free-text label, menu cards only.
   * Blank is a legal value and stores null; the service forces null for every
   * other type, so sending it elsewhere is harmless rather than a 400.
   */
  @IsOptional()
  @IsString()
  flex_slug?: string;

  @IsOptional()
  @IsString()
  source_role?: string | null;

  @Allow()
  source_roles?: unknown;

  @Allow()
  content_tags?: unknown;

  /* [FEAT-20260810-CARDTICKET] open a direct ticket once this card's reply is
     delivered, using `direct_ticket_text` as the reason an admin reads. Optional and
     off by default ⇒ omitting both keeps the previous behaviour exactly. */
  @IsOptional()
  @IsBoolean()
  direct_ticket_on_reply?: boolean;

  @IsOptional()
  @IsString()
  direct_ticket_text?: string;

  @IsOptional()
  @IsString()
  callback_detail?: string;

  @IsOptional()
  @IsString()
  callback_tag?: string;

  @IsOptional()
  @IsArray()
  group_ids?: unknown[];

  @IsOptional()
  @IsBoolean()
  grant_all_hooks?: boolean;
}

/**
 * [FEAT-20260830-FLEXBULKGROUPS] body of `POST /api/flex-messages/bulk-groups`.
 *
 * A SEPARATE DTO ON PURPOSE, not `UpdateFlexMessageDto` with a list of ids.
 * That one can change any field, so accepting a batch through it would let a
 * single request rewrite names, types and card JSON alongside the group scope.
 * This one carries the two arrays and nothing else, and the global pipe's
 * `forbidNonWhitelisted` rejects anything extra before the handler runs — the
 * same reasoning `DynamicTagsService.bulkScope` states for its own endpoint.
 *
 * Both arrays stay `unknown[]` at the pipe, matching the sibling `group_ids`
 * fields above: the service resolves and validates the ObjectIds itself and
 * answers with its own message, so constraining the element shape here would
 * produce two different 400s for one bad input.
 */
export class BulkFlexGroupsDto {
  @IsArray()
  flex_ids!: unknown[];

  @IsArray()
  group_ids!: unknown[];
}
