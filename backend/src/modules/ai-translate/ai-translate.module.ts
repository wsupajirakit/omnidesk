/**
 * [FEAT-20260908-CHATTRANS] The translate capability as a module anyone may
 * call — chat, tickets, or whatever comes next. It is NOT part of chat and it is
 * NOT part of tickets; both are callers.
 *
 * 🔴 NO `imports` KEY, AND THAT IS THE POINT. This module depends on no other
 * feature module, so it can never sit on the wrong side of an arrow in a graph
 * that already cycles (`chat → webhook` and `webhook → chat` both exist). That
 * is precisely the wall this funnel used to be stuck behind when it lived inside
 * `tickets/`. `health.module.ts` is the existing precedent for a Nest module
 * with no `imports` array at all, so this is not a first here.
 *
 * The rule is not documented, it is ENFORCED — `z-test/unit/
 * ai-translate-isolation.spec.ts` fails if any file under this directory imports
 * a module other than `@/modules/ai-vendor`. The allowed edges are exactly:
 *
 *     @/modules/ai-vendor   the shared door — CALL it, never CHANGE it
 *     @/config/*            config sits below modules (type-only here)
 *     @/common              the same rule every module follows
 *     node_modules          @nestjs/*, and axios only behind the door
 *
 * 🔴 THE TOKEN IS PRIVATE. `AI_TRANSLATE_PROVIDER` is not in `index.ts` and is
 * not in `exports` below. A consumer writes `imports: [AiTranslateModule]` and
 * takes `AiTranslateService` as an ordinary constructor parameter — the shape
 * `menu-press.module.ts:23-38` uses (token private at :33, service exported at
 * :36, consumed by one line at `webhook.module.ts:258`).
 *
 * ⚠️ This module is deliberately absent from `app.module.ts`. It has no
 * controller and no global side effect, so it enters the graph only when a
 * caller imports it — nothing boots that nobody asked for.
 *
 * revert: delete `src/modules/ai-translate/` whole. Nothing else in the tree
 * imports it yet; the isolation spec above is what keeps that claim checkable.
 */
import { Module } from '@nestjs/common';

import { AiTranslateService } from './ai-translate.service';
import { ScriptedTranslateProvider } from './scripted-translate.provider';
import { RealTranslateProvider } from './translate.provider';

@Module({
  providers: [
    /* Both legs are registered so the factory in `AiTranslateService` can pick
       either one. Only the chosen leg is ever called; the other is an idle
       instance, exactly as it was under `tickets.module.ts`. */
    RealTranslateProvider,
    ScriptedTranslateProvider,
    AiTranslateService,
  ],
  exports: [AiTranslateService],
})
export class AiTranslateModule {}
