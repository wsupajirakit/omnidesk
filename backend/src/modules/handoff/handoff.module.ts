import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { User, UserSchema } from '@/modules/admin';
import { AuthModule } from '@/modules/auth/auth.module';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { Member, MemberSchema } from '@/modules/chat';
import { Hook, HookSchema } from '@/modules/hooks';
import { SlipVerification, SlipVerificationSchema } from '@/modules/slip';

import { CallbackPublicGuard } from './callback-public.guard';

import { HandoffCallbackController } from './handoff-callback.controller';
import { HandoffCallbackService } from './handoff-callback.service';
import { HandoffChainController } from './handoff-chain.controller';
import { HandoffChainService } from './handoff-chain.service';
import { HandoffJobController } from './handoff-job.controller';
import { HandoffJobService } from './handoff-job.service';
import { HandoffOaAccessService } from './handoff-oa-access.service';
import { HandoffBindingSwitchService } from './handoff-binding-switch.service';
import { HandoffTargetController } from './handoff-target.controller';
import { HandoffTargetService } from './handoff-target.service';
import {
  HandoffCallback,
  HandoffCallbackSchema,
} from './schemas/handoff-callback.schema';
import {
  HandoffChain,
  HandoffChainSchema,
} from './schemas/handoff-chain.schema';
import {
  HandoffChainRun,
  HandoffChainRunSchema,
} from './schemas/handoff-chain-run.schema';
import {
  HandoffHookOverride,
  HandoffHookOverrideSchema,
} from './schemas/handoff-hook-override.schema';
import { HandoffJob, HandoffJobSchema } from './schemas/handoff-job.schema';
import {
  HandoffResult,
  HandoffResultSchema,
} from './schemas/handoff-result.schema';
import {
  HandoffTarget,
  HandoffTargetSchema,
} from './schemas/handoff-target.schema';

/**
 * Handoff: outbound targets, dispatched jobs, inbound callbacks, and the chain
 * feature with its run history.
 *
 * Controller ordering matters. `HandoffTargetController` declares
 * `GET /api/handoff/config-schema` and must be registered before anything that
 * could capture `config-schema` as a `:id` — the same constraint the legacy
 * router carries a comment about.
 *
 * `Hook`, `Member` and `SlipVerification` are registered because handoff reads
 * them: OA scoping resolves hooks, run history attaches member profiles, and a
 * run detail links the slip that started it. Their schemas stay owned by their
 * own modules.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HandoffTarget.name, schema: HandoffTargetSchema },
      { name: HandoffJob.name, schema: HandoffJobSchema },
      { name: HandoffResult.name, schema: HandoffResultSchema },
      { name: HandoffCallback.name, schema: HandoffCallbackSchema },
      { name: HandoffChain.name, schema: HandoffChainSchema },
      { name: HandoffChainRun.name, schema: HandoffChainRunSchema },
      { name: HandoffHookOverride.name, schema: HandoffHookOverrideSchema },
      { name: Hook.name, schema: HookSchema },
      { name: Member.name, schema: MemberSchema },
      { name: SlipVerification.name, schema: SlipVerificationSchema },
      /*
       * `User` is registered for JwtAuthGuard, which CallbackPublicGuard
       * delegates to (see that file). The guard re-checks the account is still
       * active and that `token_version` matches, so it needs the collection.
       * The schema stays owned by the admin module; this is a read-only reuse.
       */
      { name: User.name, schema: UserSchema },
    ]),
    // For TokenService, the other JwtAuthGuard dependency.
    AuthModule,
  ],
  controllers: [
    HandoffTargetController,
    HandoffJobController,
    HandoffCallbackController,
    HandoffChainController,
  ],
  providers: [
    /*
     * Declared providers, not left to `@UseGuards` to construct: both now take
     * constructor dependencies, and a guard Nest instantiates from the
     * decorator alone would receive none of them.
     */
    JwtAuthGuard,
    CallbackPublicGuard,
    HandoffOaAccessService,
    HandoffTargetService,
    // Shared with HooksModule, which provides its own instance for
    // PATCH /hook/handoff/bulk; stateless, so the two cannot diverge.
    HandoffBindingSwitchService,
    HandoffJobService,
    HandoffCallbackService,
    HandoffChainService,
  ],
})
export class HandoffModule {}
