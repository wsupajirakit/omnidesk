// [REFACTOR-20260808-SVCGROUP] Barrel for the `insight` service group (analytics/reporting:
// insight report + dashboard stats). Importers target `../services/insight`. Re-exports the
// group's services AND their response types (e.g. InsightReportResponse). Members are
// side-effect-free named exports, so `export *` is behavior-identical.
// revert: `git mv services/insight/*.ts services/`, delete this folder, repoint importers back
// to `../services/<file>`, and restore the moved files' `./apiClient` paths.
export * from './insightReportService';
export * from './statsService';
