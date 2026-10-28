/**
 * [FEAT-20260905-CUSTPROV] The customer-provider module.
 *
 * A LEAF: it imports no feature module, so anything may import it without
 * closing a cycle. That matters here — `modules/chat` (the raw-profile and
 * site-rules routes) and `modules/tickets` (the tier filter) both need it, and
 * `chat` and `tickets` already import each other's neighbours. Same reasoning
 * `modules/options` records for its own module.
 *
 * Not `infra/`: this holds domain knowledge (where a tier lives, what a card
 * shows), and the lint rule forbids `infra -> modules`, which would strand it.
 *
 * `@Global` is deliberately NOT used. Five known consumers is not "everything",
 * and a module that must be imported to be used leaves its dependents' imports
 * honest. ใครใช้ต้อง import — จะได้เห็นว่าใครใช้บ้าง
 *
 * revert: delete this folder and its line in `app.module.ts`.
 */
import { Module } from '@nestjs/common';

import { CustomerProviderController } from './customer-provider.controller';
import { CustomerProviderService } from './customer-provider.service';

@Module({
  controllers: [CustomerProviderController], // [FEAT-20261014-TICKETCATS]
  providers: [CustomerProviderService],
  exports: [CustomerProviderService],
})
export class CustomerProviderModule {}
