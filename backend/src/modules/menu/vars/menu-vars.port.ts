/**
 * ==== [FEAT-20260828-MENUTAG-S6] variables — the menu IMPLEMENTS NONE ====
 *
 * PLAN §3e, tier 1: every function below is CENTRAL code that already exists and
 * that other features depend on. The menu neither edits nor copies it — the
 * patch-carried call site (S3) closes each one over what it already has in
 * scope and hands it in. That is also what keeps the menu module free of any
 * import from `webhook/` (no TS cycle, and no deep-import fence violation —
 * eslint bans `@/modules/<name>/<file>`; only barrels are legal).
 *
 * The four, with the source verified at e76a4dd:
 *
 *   buildDataVars      ← `buildFlexVarMaps`      flex-data-vars.util.ts:582
 *                        (closed over TranslationDictCacheService.translate,
 *                         exactly as webhook.service.ts:5179-5189 already does)
 *   applyVars          ← `applyFlexProfileVars`  flex-render.util.ts:240
 *   substituteCtxVars  ← `substituteCtxVars`     prompt-context.util.ts:291
 *   renderFlexDoc      ← `renderFlexDoc`         flex-render.util.ts:516
 *
 * 🔴 WHY NO NEW SUBSTITUTION CODE EXISTS HERE. `applyFlexProfileVars` walks its
 * argument and its FIRST branch is `if (typeof n === 'string') return
 * replaceIn(n)` — so it already substitutes a bare STRING, not only a flex
 * document. The plan had allowed a text substituter to be written in menu code
 * ("the one place a substitution call is ADDED"); the dive found that would have
 * been a second dialect for a job the central applier already does. It was not
 * written. One grammar, one lowercase rule, one unknown-tag rule, for every
 * shape the menu can answer with.
 *
 * Signatures are declared STRUCTURALLY (not imported) on purpose: the menu must
 * compile and be tested with no webhook dependency at all. They are copied from
 * the real declarations and pinned by menu-vars-resolve.spec.ts.
 *
 * ── WHO OWNS THESE FOUR ────────────────────────────────────────────────────
 * Not us. Each one is live production code with other callers: flex cards, the
 * AI reply path, the notice runtime. We only DECLARE their shapes so the menu
 * can be typed and tested without importing them.
 *
 * DO NOT edit them. DO NOT copy them. DO NOT write a fifth applier or a second
 * substitution dialect. If a value seems unreachable through these, that is a
 * question for the owner before any code is written (STANDING ORDER #1) — the
 * plan's tier rule is: use as-is injected, then ask, and only then inherit by
 * wrapping the OUTPUT. Re-implementing a builder is forbidden outright.
 *
 * A worked example of that rule paying off: this port originally allowed a
 * small text substituter to be written here, because plain-text replies do no
 * substitution today. Reading the central applier showed it already handles a
 * bare string, so nothing was written. One grammar, not two.
 *
 * revert: delete src/modules/menu/ whole.
 */

/** `buildFlexVarMaps(doc, profileData, hook, translate)` with translate closed over. */
export type MenuBuildDataVars = (
  doc: { source_roles?: unknown; source_role?: unknown } | null | undefined,
  profileData: unknown,
  hook: Record<string, unknown> | null | undefined,
) => Record<string, string>;

/** `applyFlexProfileVars(node, vars)` — substitutes `{{…}}` in a string OR a tree. */
export type MenuApplyVars = (
  node: unknown,
  vars: Record<string, string> | null | undefined,
) => unknown;

/** `substituteCtxVars(text, hook, content)` — the hook.x names, in plain text. */
export type MenuSubstituteCtxVars = (
  text: string,
  hook: Record<string, unknown> | null | undefined,
  content: string,
) => string;

/** `renderFlexDoc(doc, dataVars, content, hook)` — the FULL card applier. */
export type MenuRenderFlexDoc = (
  doc: { content_json?: unknown; content_tags?: unknown },
  dataVars: Record<string, string>,
  content: unknown,
  hook: Record<string, unknown> | null | undefined,
) => unknown;

export interface MenuVarDeps {
  readonly buildDataVars: MenuBuildDataVars;
  readonly applyVars: MenuApplyVars;
  readonly substituteCtxVars: MenuSubstituteCtxVars;
  readonly renderFlexDoc: MenuRenderFlexDoc;
}

/**
 * What the engine holds. ABSENT ⇒ every string passes through untouched, which
 * is exactly today's behaviour — that is what makes S6 zero-impact on its own.
 */
export interface MenuVars {
  /** Data vars then context vars, the order renderFlexDoc documents as load-bearing. */
  resolveText(text: string, ctx: MenuVarContext): string;
  /** An operator-authored card goes through the FULL applier (the helper-card trap). */
  resolveFlex(flex: Record<string, unknown>, ctx: MenuVarContext): unknown;
  /**
   * Title + every item label, resolved BEFORE the renderer builds the bubble.
   * Resolving the definition rather than the finished message keeps the
   * postback payloads (`menu:v1:…`) away from any substitution pass.
   */
  resolveDefinition<T extends MenuResolvableDefinition>(
    definition: T,
    ctx: MenuVarContext,
  ): T;
}

/** The shape resolveDefinition touches — declared here so vars/ needs no import. */
export interface MenuResolvableDefinition {
  readonly title: string;
  readonly items: ReadonlyArray<{ readonly label: string }>;
}

/** The two values every central function needs, and nothing else. */
export interface MenuVarContext {
  readonly hook: Record<string, unknown> | null | undefined;
  readonly rawProfile: unknown;
}
