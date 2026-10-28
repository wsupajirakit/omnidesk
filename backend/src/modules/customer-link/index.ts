/** Public surface of the customer-link module — import '@/modules/customer-link'. */

export * from './customer-link.module';
export * from './customer-link.service';
export * from './customer-link.constants';
// [FEAT-20260814-MINTBLOCKLINKED] Exported so the mint-block spec can drive the
// handler directly — same shape as `AuditLogController` / `ModelController` in
// their own barrels. Named export only: the module stays the wiring surface.
export { CustomerLinkController } from './customer-link.controller';
