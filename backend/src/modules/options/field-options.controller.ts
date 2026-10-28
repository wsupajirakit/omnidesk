/**
 * ==== [FEAT-20260903-FIELDOPTIONS] GET /api/field-options/:key ===============
 *
 * The one route of the options pipe. It has no domain knowledge and no branch per
 * field — it looks the key up in the registry and answers. Adding the next field
 * touches `field-options.registry.ts` and nothing here.
 *
 * ⚠️ AUTH: authenticated, no extra permission — matching `GET /hook/field-tabs`,
 * which serves the same class of thing (metadata a form needs to render). The
 * global `JwtAuthGuard` + `PermissionsGuard` are bound with `APP_GUARD` in
 * `AuthModule`, so a route without a permission decorator is "any logged-in
 * caller". A tighter permission here would 403 the very operators the list is
 * for: the form is a hook screen, not a slip-admin screen.
 *
 * ⚠️ NOTHING SENSITIVE PASSES THROUGH. Sources return value + i18n key, never a
 * credential, a host or a customer's data — and they must keep doing so. If a
 * future list needs to be permission-scoped, that is the moment to add per-key
 * permissions, not before.
 *
 * ⚠️ NO INDEX ROUTE listing the keys — no path-less GET on this controller.
 * Nothing needs it, and an endpoint that enumerates the server's configurable
 * surface is a thing to add on purpose with a reason, not by default.
 *
 * 🔴 AND THAT SENTENCE MUST NOT SPELL THE DECORATOR CALL OUT. `scripts/route-coverage.mjs`
 * matches `/@(Get|Post|Put|Patch|Delete)\(...\)/` line by line over the raw file and
 * does NOT strip comments, so writing the decorator-with-parens here invented a
 * phantom `GET /` route in the guard's output — permanently un-coverable, because
 * its path has no concrete segment to match a test against. คอมเมนต์ก็ถูกสแกน.
 */
import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  type FieldOption,
  fieldOptionsFor,
  realChoiceCount,
} from './field-options.registry';

@ApiTags('field-options')
@Controller('api/field-options')
export class FieldOptionsController {
  @Get(':key')
  @ApiOperation({
    summary: 'The values a field may be set to, as the server can honour them',
  })
  getFieldOptions(@Param('key') key: string): {
    key: string;
    options: FieldOption[];
    choice_count: number;
  } {
    const options = fieldOptionsFor(key);
    /* A key nobody registered is the client asking for something that does not
     * exist — a 404, not a 500, and not an empty list either: an empty list would
     * read as "this field has no values", which is a different and wrong answer
     * that a form would render as a disabled dropdown with no explanation. */
    if (!options) {
      throw new NotFoundException(`no options registered for field "${key}"`);
    }
    return {
      key,
      options,
      /* The default excluded, so a client can drop a control that cannot change
       * anything without knowing WHICH entry is the fallback — see the registry's
       * note on why the server owns that count. */
      choice_count: realChoiceCount(options),
    };
  }
}
