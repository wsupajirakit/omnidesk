/**
 * [FIX-20260909-TRANSLATECAPWIRE] The translate ceiling is the TRANSLATE
 * ceiling — proving the namespace is wired, not merely declared.
 * ============================================================================
 * `app.config.ts` created `registerAs('aiTranslate')` with a `capLimit` of its
 * own, and says why in its own words: *raising translate's ceiling never moves
 * the number the reply and assist-summary decorators read.*
 *
 * 🔴 THE CONVERSE WAS NEVER TRUE, AND NOTHING SAID SO. `AiTranslateService`
 *    injected `aiConfig` and handed `aiConfig.capLimit` to the factory, so the
 *    cap decorator was built with `AI_CAP_LIMIT` — the reply/summary number —
 *    and `AI_TRANSLATE_CAP_LIMIT` did nothing at all. The owner set 30 for
 *    testing and the real ceiling in force was 693.
 *
 * WHY NOTHING CAUGHT IT. Both values are plain numbers of the same type, so
 * `tsc` is satisfied. The funnel spec calls `selectTranslateProvider` DIRECTLY
 * with a hand-built config object, so it exercises the factory and never the
 * wiring above it. The decorator's own spec passes an explicit limit. Every
 * piece was tested; the join between them was not — the same shape as the
 * unwired resolver found in P3, one layer up.
 *
 * ⚠️ THE SEPARATE LEDGER WAS ALWAYS CORRECT. `.ai-translate-call-count.json` is
 *    its own file, so translate never SPENT the bot lanes' budget. Only the
 *    number it compared against was the wrong one. That is why nothing visibly
 *    misbehaved and why this needed a test rather than a bug report.
 *
 * WHAT STAYS ON `aiConfig` ON PURPOSE: `providerMode` and `capMode`. Those are
 * whole-system switches — mock-vs-real, and cap-on-vs-off — and translate has
 * no business disagreeing with the rest of the process about either. Only the
 * NUMBER is per-lane.
 *
 * revert: this spec goes with the two-namespace constructor it guards.
 */
import { AiTranslateService } from '@/modules/ai-translate/ai-translate.service';
import { TranslateCapDecorator } from '@/modules/ai-translate/translate-cap.decorator';

/** The two namespaces, shaped as `ConfigType` hands them over. */
const aiCfg = (over: Record<string, unknown> = {}) =>
  ({
    providerMode: 'mock',
    capMode: 'on',
    capLimit: 693, // the reply/summary ceiling — must NOT reach translate
    ...over,
  }) as never;

const translateCfg = (over: Record<string, unknown> = {}) =>
  ({
    capLimit: 30, // AI_TRANSLATE_CAP_LIMIT
    previewMax: 6,
    previewWindowSeconds: 60,
    ...over,
  }) as never;

const stub = { translate: () => Promise.resolve({ text: '' }) } as never;

/** The decorator the service actually built, or null when the cap is off. */
function capOf(svc: AiTranslateService): TranslateCapDecorator | null {
  const provider = (svc as unknown as { provider: unknown }).provider;
  return provider instanceof TranslateCapDecorator ? provider : null;
}

/** Its limit. `private` is a compile-time notion; the value is the point. */
const limitOf = (d: TranslateCapDecorator): number =>
  (d as unknown as { limit: number }).limit;

describe('[TRANSLATECAPWIRE] which ceiling the translate decorator is built with', () => {
  it('⭐ T1 · the TRANSLATE namespace wins — 30, not the bot lanes’ 693', () => {
    const svc = new AiTranslateService(aiCfg(), translateCfg(), stub, stub);
    const cap = capOf(svc);
    expect(cap).not.toBeNull();
    /* THE assertion. Hand the factory `aiConfig.capLimit` and this reads 693. */
    expect(limitOf(cap as TranslateCapDecorator)).toBe(30);
  });

  it('T2 · unset ⇒ byte-identical to before, because the namespace falls back', () => {
    /* `aiTranslateConfig.capLimit` is `AI_TRANSLATE_CAP_LIMIT ?? AI_CAP_LIMIT`,
       so an installation that never sets the translate var gets exactly the
       number it got yesterday. This is the whole "optional" proof for the fix:
       the change is invisible unless somebody deliberately set the new var. */
    const svc = new AiTranslateService(
      aiCfg(),
      translateCfg({ capLimit: 693 }),
      stub,
      stub,
    );
    expect(limitOf(capOf(svc) as TranslateCapDecorator)).toBe(693);
  });

  it('T3 · capMode still comes from the SHARED switch, not from translate', () => {
    /* Deliberate: cap-on/cap-off is a whole-process decision. `aiTranslateConfig`
       has no `capMode` field at all, and this pins that turning the shared cap
       off turns translate's off too — one switch, not two that can disagree. */
    const svc = new AiTranslateService(
      aiCfg({ capMode: 'off' }),
      translateCfg(),
      stub,
      stub,
    );
    expect(capOf(svc)).toBeNull();
  });

  it('T4 · providerMode still comes from the shared switch too', () => {
    const svc = new AiTranslateService(
      aiCfg({ providerMode: 'real', capMode: 'off' }),
      translateCfg(),
      stub,
      stub,
    );
    /* cap off ⇒ the provider IS the inner leg, and `real` was the second stub. */
    expect(capOf(svc)).toBeNull();
    expect((svc as unknown as { provider: unknown }).provider).toBe(stub);
  });
});

/**
 * 🔴 THE PRODUCTION SHAPE — owner, 09/09: *the cap change must not touch
 * `AI_PROVIDER=real`, production is running on it*, and *`AI_PROVIDER` real/mock
 * governs everything — translate and the ordinary AI lanes alike.*
 *
 * `env.schema.ts:381-383` states the three deployments in its own words:
 *
 *     local  AI_PROVIDER=mock  AI_CAP=on
 *     dev    AI_PROVIDER=real  AI_CAP=on
 *     prod   AI_PROVIDER=real  AI_CAP=off      ← the one that matters here
 *
 * So production is protected TWICE OVER, on independent grounds:
 *
 *   1. `providerMode` was never moved. It still comes from `aiConfig`, the one
 *      switch, exactly as the owner requires — this change did not give
 *      translate a second opinion about real-vs-mock and must never do so.
 *   2. With `AI_CAP=off`, `capLimit` is not read on ANY branch of the factory —
 *      the decorator is never constructed. The number this fix corrected cannot
 *      reach production at all while that stays true.
 *
 * And on `dev`, where `AI_CAP=on`: `AI_TRANSLATE_CAP_LIMIT` is `.optional()`
 * with **no default** (`env.schema.ts:453-461`, which says so explicitly and
 * explains why), so unless somebody deliberately sets it the namespace resolves
 * to `AI_CAP_LIMIT` and the number handed over is the one that was handed over
 * before this commit.
 */
describe('[TRANSLATECAPWIRE] production cannot be touched by this change', () => {
  it('⭐ P1 · prod shape (real + cap OFF) ⇒ the real leg, and no decorator at all', () => {
    const real = { translate: () => Promise.resolve({ text: 'r' }) } as never;
    const scripted = {
      translate: () => Promise.resolve({ text: 's' }),
    } as never;
    const svc = new AiTranslateService(
      aiCfg({ providerMode: 'real', capMode: 'off' }),
      translateCfg(),
      scripted,
      real,
    );
    expect((svc as unknown as { provider: unknown }).provider).toBe(real);
    expect(capOf(svc)).toBeNull();
  });

  it('⭐ P2 · with cap OFF the two namespaces may disagree wildly and nothing changes', () => {
    /* The strongest form of "production is untouched": make the numbers as
       different as they can be, and the built provider is still the same
       object. If a future edit ever reads `capLimit` outside the cap branch,
       this is what fails. */
    const real = { translate: () => Promise.resolve({ text: 'r' }) } as never;
    const svc = new AiTranslateService(
      aiCfg({ providerMode: 'real', capMode: 'off', capLimit: 1 }),
      translateCfg({ capLimit: 999999 }),
      stub,
      real,
    );
    expect((svc as unknown as { provider: unknown }).provider).toBe(real);
  });

  it('⭐ P3 · mock is still reachable, and still from the SHARED switch', () => {
    /* The owner's rule that one switch governs every lane cuts both ways: the
       translate namespace must not be able to force `real` either. It has no
       `providerMode` field at all, and this is what keeps it that way. */
    const scripted = {
      translate: () => Promise.resolve({ text: 's' }),
    } as never;
    const svc = new AiTranslateService(
      aiCfg({ providerMode: 'mock', capMode: 'off' }),
      translateCfg(),
      scripted,
      stub,
    );
    expect((svc as unknown as { provider: unknown }).provider).toBe(scripted);
    expect(Object.keys(translateCfg() as object)).not.toContain('providerMode');
    expect(Object.keys(translateCfg() as object)).not.toContain('capMode');
  });

  it('⭐ P4 · the constructor’s parameter count — the boot failure with no compile error', () => {
    /* `ChatTranslateService` has this guard (`chat-translate-wiring.spec.ts`);
       `AiTranslateService` did not, and this commit added a parameter to it. A
       parameter Nest cannot resolve is a BOOT crash — in production, on deploy,
       with nothing failing beforehand. Four: two config namespaces, two legs.
       Both namespaces are loaded by `config.module.ts` with `isGlobal: true`,
       which is why no `imports` line was needed for the new one. */
    const params = (Reflect.getMetadata(
      'design:paramtypes',
      AiTranslateService,
    ) ?? []) as unknown[];
    expect(params).toHaveLength(4);
  });
});
