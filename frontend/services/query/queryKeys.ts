/**
 * [FEAT-20261027-TANSTACK] Root of every query key.
 *
 * Each service group builds its keys under ONE root from this list
 * (`services/<module>/queries/<module>Keys.ts`), so two modules can never
 * collide on a key and `invalidateQueries({ queryKey: [root] })` reaches exactly
 * one module. Add a root here before adding a new module's keys.
 */
export const QUERY_ROOT = {
  hook: 'hook',
  admin: 'admin',
  media: 'media',
  chat: 'chat',
  messaging: 'messaging',
} as const;

export type QueryRoot = (typeof QUERY_ROOT)[keyof typeof QUERY_ROOT];
