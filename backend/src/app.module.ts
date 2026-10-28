import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter } from '@/common';
import { ConfigModule } from '@/config/config.module';
import { LoggerModule } from '@/infra/logger/logger.module';
import { MongoModule } from '@/infra/mongo/mongo.module';
import { RateLimitModule } from '@/infra/rate-limit/rate-limit.module';
import { RealtimeModule } from '@/infra/realtime/realtime.module';
import { QueryCacheModule } from '@/infra/query-cache/query-cache.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { AdminModule } from '@/modules/admin';
import { AuditModule } from '@/modules/audit';
import { AuthModule } from '@/modules/auth';
import { ChatModule } from '@/modules/chat';
import { ContentModule } from '@/modules/content';
import { CustomerLinkModule } from '@/modules/customer-link';
import { HandoffModule } from '@/modules/handoff';
import { ExternalModule } from '@/modules/external';
// [FEAT-20260808-PAYTOOL-P2] revert: drop this import.
import { PaymentModule } from '@/modules/payment/payment.module';
import { HealthModule } from '@/modules/health';
import { CustomerProviderModule } from '@/modules/customer-provider';
import { FieldOptionsModule } from '@/modules/options';
import { HooksModule } from '@/modules/hooks';
import { SlipModule } from '@/modules/slip';
// [FEAT-20260824-STRIKESESSION] revert: drop this import and the entry below.
import { StrikeModule } from '@/modules/strike';
import { SystemModule } from '@/modules/system';
import { TicketsModule } from '@/modules/tickets';
import { WebhookModule } from '@/modules/webhook';

/**
 * Composition root.
 *
 * Layering rule enforced by lint (see eslint.config.mjs):
 *   config  <- infra  <- modules
 * A feature module may depend on infra and common; infra never depends on a
 * feature module. That is what keeps modules independently movable as the
 * service grows.
 *
 * The global authentication guard is registered here once the auth module
 * lands (P2). Until then only public routes exist.
 */
@Module({
  imports: [
    // Infrastructure — order is irrelevant (all are @Global), but config must
    // be importable before anything reads it, so it stays first for clarity.
    ConfigModule,
    /**
     * [FEAT-20260823-BCASTCRON] Starts the `@Cron` scheduler used by
     * `BroadcastSchedulerDriver` — the only timer in this codebase.
     *
     * ⚠️ Registering it starts NOTHING on its own: a `@Cron` fires only where
     *    one is declared, and the single declaration refuses unless a job
     *    carries both `next_run_at` and `send_kind`. Adding this module to a
     *    deployment therefore changes no behaviour by itself.
     *    ใส่โมดูลนี้เฉย ๆ ไม่ทำให้มีอะไรรัน.
     *
     * revert: remove this line; the driver's `@Cron` then never fires and the
     * scheduler is inert without any other edit.
     */
    ScheduleModule.forRoot(),
    LoggerModule,
    MongoModule,
    RedisModule,
    RateLimitModule,
    RealtimeModule,
    // [FEAT-20260808-QCACHE] shared, scope-keyed Redis read cache (opt-in per
    // endpoint). @Global — feature modules inject ScopedQueryCacheService without
    // importing it. DB-EFFECT: no Mongo schema/write; Redis read cache only.
    QueryCacheModule,

    // Feature modules
    AdminModule,
    AuditModule,
    AuthModule,
    ChatModule,
    ContentModule,
    CustomerLinkModule,
    HandoffModule,
    ExternalModule,
    HealthModule,
    HooksModule,
    /* [FEAT-20260903-FIELDOPTIONS] "what may this field be set to?", answered from
       the live registry so a dashboard can never offer a value the server cannot
       act on. A LEAF: it reads `@/modules/slip` and nothing imports it back, which
       is why it is not hung off HooksModule — `slip` already imports `hooks`, so
       that would close a cycle. revert: drop this line and `src/modules/options/`. */
    CustomerProviderModule,
    FieldOptionsModule,
    // [FEAT-20260808-PAYTOOL-P2] payment runner (not webhook-wired). revert: drop.
    PaymentModule,
    SlipModule,
    /**
     * [FEAT-20260824-STRIKESESSION] Strike tracking. 📖 docs/strike-session.md
     *
     * ⚠️ This line DOES touch the database at boot: Mongoose builds the module's
     * indexes, which creates `member_strike_sessions` and `member_strike_events`
     * as EMPTY collections. Nothing existing is read or written, and nothing is
     * inserted until the rate ladder actually blocks somebody.
     *
     * The write tap lives in WebhookModule, not here — removing this line leaves
     * the tap working and only takes the REST routes away.
     */
    StrikeModule,
    SystemModule,
    TicketsModule,
    WebhookModule,
  ],
  providers: [
    // Single error shape for the whole API — see AllExceptionsFilter.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },

    /**
     * The global authentication and permission guards are registered by
     * AuthModule, not here. A guard bound with APP_GUARD is instantiated by the
     * module that declares it, and JwtAuthGuard needs the User model — which is
     * registered in AuthModule. Declaring it here fails at boot.
     */
  ],
})
export class AppModule {}
