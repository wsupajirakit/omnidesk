// [REFACTOR-20260808-TYPESPLIT] Barrel for the `types/` folder: the former 838-line
// monolith was split into flat per-domain modules (`types/<name>.ts`) for readability,
// then foldered to keep the repo root clean. As the directory index, this file makes
// `import { X } from '.../types'` resolve here (types/index.ts) so every existing import
// path keeps working unchanged — pure code organization, zero runtime/behavior change
// (all exports are types only).
// revert: paste the module contents back inline into a root `types.ts` and delete the
// `types/` folder — every `../types` / `./types` import keeps resolving either way.
export * from './common';
export * from './auth';
export * from './hook';
export * from './audit';
export * from './config';
export * from './webhook';
export * from './user';
export * from './campaign';
export * from './media';
export * from './slip';
export * from './dynamic-tag';
export * from './assign';
