import { Injectable, Logger } from '@nestjs/common';

/**
 * [FEAT-20260808-P3CFGINVAL] Immediate invalidation of in-memory readers of a
 * system_configs value.
 *
 * Legacy funnels every config create/update/delete through
 * `systemConfigService.refreshConfigCache()`, which calls
 * `aiCategoryConfig.invalidate()` so an operator toggling the flag takes effect
 * AT ONCE rather than waiting out the 60s TTL (systemConfigService.js:40-51 +
 * aiCategoryConfigService.js:9-11). Without this, the NestJS AI-category cache
 * (WebhookService, 60s TTL) is only refreshed by its own TTL, so a toggle could
 * be up to 60s stale — a behavioural gap vs legacy.
 *
 * This is a leaf-safe way to reproduce it WITHOUT a system→webhook module
 * dependency (which would create a cycle and break SystemModule's leaf
 * invariant): the reader (WebhookService) REGISTERS its own invalidation
 * callback here, and SystemConfigService only fires the callbacks it holds. The
 * dependency direction stays webhook→system.
 *
 * DB-EFFECT: none — this only clears in-process caches; no schema/write change.
 */
@Injectable()
export class ConfigCacheInvalidator {
  private readonly logger = new Logger(ConfigCacheInvalidator.name);
  private readonly listeners = new Set<() => void>();

  /**
   * Register an in-memory cache to be invalidated on any config write. Returns
   * an unsubscribe fn (unused today, but keeps the contract honest for tests).
   */
  register(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Called by SystemConfigService after every create/update/delete. Each
   * listener is isolated: one throwing must not stop the others, and must never
   * fail the originating config write (legacy invalidate is likewise best-effort).
   */
  fire(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        this.logger.warn(
          `config-cache listener threw during invalidate: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}
