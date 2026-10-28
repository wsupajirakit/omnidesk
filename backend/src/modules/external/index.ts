/** Public surface of the external module — import '@/modules/external'. */

export * from './external.module';
export * from './external-api.service';
export * from './custom-tool.service';
export * from './hook-outbound.service';
export * from './hook-outbound.controller';
// [FEAT-20260814-SITERULESCACHE] Exported so specs can import them through the
// barrel (the repo forbids reaching into a module's internal files).
export * from './site-rules/site-rules-cache.policy';
export * from './site-rules/site-rules-single-flight';
// [FEAT-20261016-CUSTCACHE] per-customer answer cache (policy + fail-open store)
export * from './customer-cache/customer-cache.policy';
export * from './customer-cache/customer-cache.store';

export * from './utils/raw-data-stamp';
export * from './utils/result-rules';
export * from './utils/header-safe-token';
export * from './utils/hmac-signer';
export * from './utils/circuit-open';

// [FIX-20260818-SSRFBRACKET] plan §2.4 B2 = T1-4 — exported so the guard can be
// asserted directly; a deep path into a module's internals is an eslint error.
