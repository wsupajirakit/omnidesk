/**
 * [FEAT-20260822-BCASTAUDIENCE] Barrel for audience scoping.
 *
 * RULES OF THIS FOLDER
 *  · pure only — query SHAPES, never a database call
 *  · every recipient list must pass through `buildOaScopeQueries` unless its
 *    source scopes by `hook_id` itself
 *
 * NOT WIRED YET — nothing in the running system imports this barrel.
 *
 * revert: delete this folder and its line in `content/index.ts`.
 */
export * from './oa-scope';
/* [FEAT-20260824-BCASTMULTIOA] which OAs one job addresses (hooks + groups) */
export * from './oa-selection';
export * from './sources';
/* [FEAT-20260824-BCASTTAGPRE] rules answered by another collection BEFORE the
   `members` filter is built (customer tag today). Deletable as a folder — see
   its header. */
export * from './prefilter';
