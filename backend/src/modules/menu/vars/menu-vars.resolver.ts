/**
 * [FEAT-20260828-MENUTAG-S6] the resolver — orchestration only, zero grammar.
 *
 * PLAN §3e. Every substitution below is performed by CENTRAL code handed in
 * through `MenuVarDeps`. This file decides only WHICH central function applies
 * to WHICH shape, and in what order:
 *
 *   text   →  applyVars (data vars)  then  substituteCtxVars (hook.x)
 *   flex   →  renderFlexDoc — the FULL applier, never a partial one
 *   title/labels → resolveText, BEFORE the renderer builds the bubble
 *
 * The two-step order for text mirrors what renderFlexDoc documents for cards:
 * data-source variables first, context variables applied OVER them, because the
 * context names are reserved. Keeping the same order means a menu answer and a
 * card resolve `{{hook_domain}}` identically.
 *
 * ⚠️ `resolveDefinition` deliberately runs BEFORE `FixedFlexRenderer`, not after
 * it: the finished message carries the `menu:v1:…` postback payloads, and no
 * substitution pass may ever walk those. A tag inside a payload is not a
 * feature — it is a corrupted button.
 *
 * ⚠️ Sending a menu card through renderFlexDoc is SAFE for every shape a
 * scenario can ship: its first step, `dropEmptyPromoBubbles`, returns the node
 * untouched unless `type === 'carousel'` (verified at flex-render.util.ts), and
 * a carousel of empty promo slots SHOULD be pruned here exactly as it is for a
 * card. Nothing menu-specific is bypassed and nothing card-specific misfires.
 *
 * ⚠️ Nothing here throws. The central builders already swallow their own
 * failures per source, and a var failure must never turn a menu into silence —
 * the customer sees the raw `{{name}}`, which is visible and reportable.
 *
 * revert: delete src/modules/menu/ whole.
 */
import type {
  MenuResolvableDefinition,
  MenuVarContext,
  MenuVarDeps,
  MenuVars,
} from './menu-vars.port';

export class MenuVarResolver implements MenuVars {
  public constructor(private readonly deps: MenuVarDeps) {}

  public resolveText(text: string, ctx: MenuVarContext): string {
    /* No `{{` anywhere ⇒ return the ORIGINAL string, byte for byte. The same
       fast path substituteCtxVars states in its own header; stated here too so
       a menu answer with no variables costs nothing and cannot be altered. */
    if (typeof text !== 'string' || !text.includes('{{')) return text;
    try {
      const withData = this.deps.applyVars(text, this.dataVars(ctx));
      return this.deps.substituteCtxVars(
        typeof withData === 'string' ? withData : text,
        ctx.hook,
        '',
      );
    } catch {
      return text; // never silence the menu over a variable
    }
  }

  public resolveFlex(
    flex: Record<string, unknown>,
    ctx: MenuVarContext,
  ): unknown {
    try {
      return this.deps.renderFlexDoc(
        { content_json: flex },
        this.dataVars(ctx),
        '',
        ctx.hook,
      );
    } catch {
      return flex;
    }
  }

  public resolveDefinition<T extends MenuResolvableDefinition>(
    definition: T,
    ctx: MenuVarContext,
  ): T {
    const title = this.resolveText(definition.title, ctx);
    const items = definition.items.map((item) => {
      const label = this.resolveText(item.label, ctx);
      return label === item.label ? item : { ...item, label };
    });
    /* Identity when nothing moved — a scenario with no variables is handed to
       the renderer as the very same object it already was. */
    if (
      title === definition.title &&
      items.every((it, i) => it === definition.items[i])
    )
      return definition;
    return { ...definition, title, items };
  }

  /** One build per resolve call — the central builder walks every source. */
  private dataVars(ctx: MenuVarContext): Record<string, string> {
    try {
      return this.deps.buildDataVars(null, ctx.rawProfile, ctx.hook);
    } catch {
      return {};
    }
  }
}
