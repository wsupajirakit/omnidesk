// [REFACTOR-20260808-SVCGROUP] Barrel for the `admin` service group (identity / access / settings:
// auth, roles, users, groups, preferences, permission labels, visible-group resolver, system config,
// audit log). App code imports `../services/admin`; TESTS mock the underlying module path
// (`../services/admin/<file>`) so granular mocks still flow through this `export *` and also cover
// the intra-group `visibleGroups → ./groupService` edge. Members are side-effect-free named exports.
// revert: `git mv services/admin/*.ts services/`, delete this folder, repoint importers back to
// `../services/<file>`, and restore the moved files' `../apiClient` / `../authStorage` / `../../types`
// paths (the internal `visibleGroups → ./groupService` edge is unchanged — same group).
export * from './authService';
export * from './roleService';
export * from './userService';
export * from './groupService';
export * from './preferencesService';
export * from './permissionLabels';
export * from './visibleGroups';
export * from './configService';
export * from './auditService';
// [FEAT-20260816-GROUPSCOPECLONE] group scope copy/clone (preview + apply + undo)
export * from './groupScopeService';
