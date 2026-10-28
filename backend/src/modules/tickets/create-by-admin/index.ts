/** [FEAT-20260817-REOPENBYADMIN] barrel — see create-ticket-by-admin.helper.ts */
export {
  createTicketByAdmin,
  // [FEAT-20260819-OPENFROMROOM] first case for a room that never had one
  openTicketFromRoom,
  // [FEAT-20260820-OPENBYSYSTEM] a case a rule opened, waiting, owned by nobody
  openTicketBySystem,
  type CreateTicketByAdminAuth,
  type CreateTicketByAdminDeps,
  type CreateTicketByAdminResult,
} from './create-ticket-by-admin.helper';
export * from './open-by-system.constants';
