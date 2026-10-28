/** Public surface of the tickets module — import '@/modules/tickets'. */

export * from './tickets.module';
export * from './tickets.service';
export * from './tickets.controller';
export * from './assign-histories.service';
export * from './assign-histories.controller';
export * from './insight-reports.service';
export * from './insight-reports.controller';
export * from './insight-registrations';
export {
  Ticket,
  TicketSchema,
  type TicketDocument,
} from './schemas/ticket.schema';
// [FEAT-20260808-TKTSCOPE] within_days resolver — exposed for unit tests.
export {
  resolveWithinDaysCutoff,
  WITHIN_DAYS_ALLOWED,
} from './within-days.util';
// [FIX-20260811-LINTBARREL] divider helper's public surface — the payment
// runner writes real divider rows ([FIX-20260811-PAYDIVIDER]) and must import
// through this barrel like every other cross-module consumer.
export {
  actorLabel,
  retitleLatestDivider,
  writeTicketDivider,
  type DividerVariant,
  type TicketDividerDeps,
  type WriteDividerInput,
} from './ticket-divider.helper';

// [FIX-20260817-JOBSTATUSSET] the two write DTOs — exported so a unit spec can
// drive the REAL ValidationPipe against the REAL decorators (z-test imports
// through barrels; a deep `@/modules/tickets/dto` path is an eslint error).
export { CreateTicketDto, UpdateTicketDto, OpenTicketFromRoomDto } from './dto';

// [FIX-20260824-CASGHOST] the compare-and-swap predicate + the safe id reader —
// exported so the spec drives the REAL rule the service calls, not a copy of it.
// A spec that re-implements this rule stays green against the broken version;
// that happened while writing this fix and the mutation check caught it.
// เทสต้องเรียกตัวจริง ไม่ใช่เขียนกติกาซ้ำ.
export {
  CAS_EXPECTED_OWNER_FIELD,
  casOwnerText,
  isCasRequested,
} from './cas-requested.util';

// [FEAT-20260817-REOPENBYADMIN] "เปิดเคสอีกครั้ง" helper — exported for the
// spec (z-test imports through the barrel) and any future cross-module caller.
export {
  createTicketByAdmin,
  // [FEAT-20260819-OPENFROMROOM] first case for a room that never had one — a
  // separate name because it is NOT a reopen (no earlier ticket exists).
  openTicketFromRoom,
  type CreateTicketByAdminAuth,
  type CreateTicketByAdminDeps,
  type CreateTicketByAdminResult,
} from './create-by-admin';

// [FEAT-20260815-CATUPGRADE] Other → Payment when a slip arrives on an unclaimed
// room. Exported through the barrel like every other cross-module consumer.
export {
  upgradeTicketCategoryOnSlip,
  type TicketCategoryUpgradeDeps,
  type TicketCategoryUpgradeInput,
} from './ticket-category-upgrade.helper';

/* [FEAT-20260908-CHATTRANS] The translate funnel used to be re-exported here.
   It is a module of its own now — `@/modules/ai-translate` — because it is a
   CAPABILITY, not a ticket feature: chat calls it, tickets may call it, and it
   knows about neither. Nothing was deleted, only moved. */
// [PERF-20260821-TICKETCURSOR] keyset paging helpers for the list (pure).
export * from './list-cursor.util';
// [PERF-20260822-TKTIDSFETCH] parse the optional `ids` subset param (pure).
export * from './list-ids.util';
// [PERF-20260821-MEMBERSEARCH] the member-search switch + query builder (pure).
export * from './member-search.util';
