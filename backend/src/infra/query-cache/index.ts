// [FEAT-20260808-QCACHE]
export { QueryCacheModule } from './query-cache.module';
export {
  ScopedQueryCacheService,
  type CacheEndpoint,
  type WrapOptions,
} from './scoped-query-cache.service';
export {
  computeScopeSignature,
  computeParamsSignature,
  SCOPE_ALL,
  SCOPE_NONE,
  type ScopeSet,
} from './scope-signature';
