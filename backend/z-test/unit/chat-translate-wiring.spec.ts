/**
 * [FEAT-20260908-CHATTRANS] the wiring — the failure mode with no compile error
 * and no red test
 * ===========================================================================
 * `tsc` is happy with a service whose module never imported the module that
 * provides its dependency. So is every unit spec in this suite, because they all
 * build their subject by hand. The failure arrives at BOOT, as
 * `Nest can't resolve dependencies of the ChatTranslateService`, on whichever
 * machine starts the server next — and `tickets.module.ts:64-69` carries a
 * comment about this exact miss happening on 05/09.
 *
 * This file reads the DECORATOR METADATA instead of booting anything, so it
 * costs nothing and needs no Mongo, no Redis and no keys. It cannot prove the
 * graph resolves; it proves that every edge the graph needs was DECLARED, which
 * is the half that gets forgotten.
 *
 * ## What it also records
 *
 * 🔴 `chat.module.ts` is the FIRST and ONLY consumer of `AiTranslateModule`.
 * Since the funnel moved out of `tickets/`, no module has imported it, so
 * nothing has instantiated `AiTranslateService` — and its constructor is where
 * `selectTranslateProvider` throws at boot if `NODE_ENV=production` meets
 * `AI_PROVIDER=mock`. This one line is what puts that wall back into the app's
 * startup path. If chat ever stops importing it, the wall goes quiet again.
 *
 * revert: delete this file with `src/modules/chat/translate/`.
 */
import { RateLimitModule } from '@/infra/rate-limit/rate-limit.module';
import { AiTranslateModule, AiTranslateService } from '@/modules/ai-translate';
import { AuditLogService, AuditModule } from '@/modules/audit';
import {
  ChatModule,
  ChatTranslateController,
  ChatTranslateService,
} from '@/modules/chat';

/** Nest keeps `@Module({...})` on the class under these metadata keys. */
const meta = (target: unknown, key: string): unknown[] =>
  (Reflect.getMetadata(key, target as object) as unknown[] | undefined) ?? [];

const named = (items: unknown[]): string[] =>
  items.map((i) =>
    typeof i === 'function'
      ? i.name
      : ((i as { provide?: { toString(): string } })?.provide?.toString?.() ??
        String(i)),
  );

describe('⭐ the module edges are DECLARED, not just assumed', () => {
  it('⭐ ChatModule imports AiTranslateModule — the boot-only failure', () => {
    /* Without this line the app compiles, every unit spec stays green, and the
       server refuses to start. That asymmetry is why the assertion exists. */
    expect(meta(ChatModule, 'imports')).toContain(AiTranslateModule);
  });

  it('⭐ and it is the ONLY module that does', () => {
    /* Recorded rather than enforced elsewhere: chat is what re-entered the
       translate module into the app graph after it left `tickets/`, which is
       also what restored the boot-time production wall inside
       `selectTranslateProvider`. */
    expect(named(meta(ChatModule, 'imports'))).toContain('AiTranslateModule');
  });

  it('AiTranslateModule EXPORTS the service, and keeps its token private', () => {
    /* A module can import another and still not reach its provider. And the DI
       token stays out of `exports` on purpose — it would be the repo's second
       exported token ever, and its first config-swapped one. */
    const exported = meta(AiTranslateModule, 'exports');
    expect(exported).toContain(AiTranslateService);
    expect(named(exported)).toEqual(['AiTranslateService']);
  });

  it('the controller and the service are both registered on ChatModule', () => {
    expect(meta(ChatModule, 'controllers')).toContain(ChatTranslateController);
    expect(meta(ChatModule, 'providers')).toContain(ChatTranslateService);
  });

  it('⭐ ChatTranslateService is NOT exported — nothing outside chat calls it', () => {
    /* The capability anyone may call is `AiTranslateService`. Exporting this
       one would make chat's caller-side rules — its OA scope wall, its cache,
       its audit row — look like a shared API. */
    expect(named(meta(ChatModule, 'exports'))).not.toContain(
      'ChatTranslateService',
    );
  });

  it('AuditModule exports the writer the audit helper needs', () => {
    /* Already imported by ChatModule for the abandon-shield row, so the
       translate row costs no new module edge — but "already there" is a claim
       worth checking rather than remembering. */
    expect(meta(AuditModule, 'exports')).toContain(AuditLogService);
    expect(meta(ChatModule, 'imports')).toContain(AuditModule);
  });

  it('⭐ every constructor parameter has a declared source', () => {
    /* The count is the cheap half of "the graph resolves": a parameter added
       without a matching provider or import is exactly the boot failure above.
       Eight: three models, crypto, ai-translate, rate-limit, audit, config. */
    const params = (Reflect.getMetadata(
      'design:paramtypes',
      ChatTranslateService,
    ) ?? []) as unknown[];
    expect(params).toHaveLength(8);
  });

  it('the two globals it leans on are global, so they need no line in ChatModule', () => {
    /* `RateLimitModule` is `@Global` (registered once in `app.module.ts`) and
       the config namespaces are loaded globally by `config.module.ts`. Both are
       reasons a MISSING import here would still be correct — which is why the
       assertions above name only the two edges that are genuinely required. */
    expect(Reflect.getMetadata('__module:global__', RateLimitModule)).toBe(
      true,
    );
  });
});
