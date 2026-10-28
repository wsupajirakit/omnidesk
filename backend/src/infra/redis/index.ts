export { RedisModule } from './redis.module';
// [FIX-20260905-REDISNS] exported so any shared-key caller reaches ONE copy of
// the rule; a second inline copy is how the two drift apart.
export { redisEnvNamespace } from './redis-namespace';
export { RedisService } from './redis.service';
