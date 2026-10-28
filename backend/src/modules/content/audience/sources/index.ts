/**
 * [FEAT-20260822-BCASTAUDSRC] Barrel for the selectable member fields.
 *
 * RULES OF THIS FOLDER
 *  · one selectable field = one registry entry; the filter builder never learns
 *    a field name
 *  · every entry declares `indexed` and `scope_by_hook` — both checked against
 *    the live database, not against the schema file
 *  · an unknown key fails closed: a dropped filter widens the audience
 *
 * revert: delete this folder and its line in the audience barrel.
 */
export * from './audience-source.types';
export * from './audience-source.registry';
export * from './audience-filter';
