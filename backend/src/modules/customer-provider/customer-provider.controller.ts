/**
 * [FEAT-20261014-TICKETCATS] What the active provider tells the SCREEN — read-only, no data.
 *
 * `GET /api/customer-provider/ticket-categories` → `{ success, data: { ticket_categories } }`
 *   loan_v1 → ['Collection','IT','Payment','Other'] · a provider that declares nothing
 *   (shop-api) → null, and the screen keeps its own path exactly as before.
 * One endpoint for every page that offers a category (ticket chat, ticket support, insight),
 * instead of adding a field to each of the eight list responses that already carry
 * provider switches. Any logged-in user may read it (global JwtAuthGuard) — it names
 * categories, nothing about customers.
 * Second route `member-detail` ([FEAT-20261015-MEMBERDETAIL]) — same rules, same guard.
 * revert: delete this file and its line in customer-provider.module.ts.
 */
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  memberDetailWire,
  providerFeaturesOff,
  providerHiddenScreenSections,
  providerMemberDetail,
  providerTicketCategories,
  type MemberDetailWire,
} from './features';

@ApiTags('customer-provider')
@Controller('api/customer-provider')
export class CustomerProviderController {
  @Get('ticket-categories')
  public ticketCategories(): {
    success: true;
    data: { ticket_categories: readonly string[] | null };
  } {
    return {
      success: true,
      data: { ticket_categories: providerTicketCategories() },
    };
  }

  /* [FEAT-20261015-MEMBERDETAIL] `GET /api/customer-provider/member-detail` — how the panel's
     hand-typed customer card behaves (loan: nickname for all, name/phone/contract while
     unregistered) · shop-api → null = today's card. A route, not a raw-profile stamp: for an
     unregistered customer the screen has no raw-profile answer to read a stamp from. */
  @Get('member-detail')
  public memberDetail(): {
    success: true;
    data: { member_detail: MemberDetailWire | null };
  } {
    return {
      success: true,
      data: { member_detail: memberDetailWire(providerMemberDetail()) },
    };
  }

  /* [FEAT-20261018-SITERULESWORLD] `GET /api/customer-provider/features` — the worlds this site
     silences (loan: notice · followUp · register · payment · siteRules) · shop-api → []. ONE route
     for every screen option that follows a world, so the next one needs no new route.
     [FEAT-20261018-SCREENSECTIONS] + `hidden`: the dashboard sections the screen must not draw
     (`features/screen-sections.ts` — silenced worlds' sections + the provider's own list) ·
     shop-api → []. The FE asks per section; an older FE ignores the extra field. */
  @Get('features')
  public features(): {
    success: true;
    data: { silenced: readonly string[]; hidden: readonly string[] };
  } {
    return {
      success: true,
      data: {
        silenced: providerFeaturesOff(),
        hidden: providerHiddenScreenSections(),
      },
    };
  }
}
