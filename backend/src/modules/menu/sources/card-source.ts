/**
 * ==== [FEAT-20260829-MENUDYNSCEN] a scenario LOADED FROM A CARD ====
 *
 * PLAN §3f. A front source that answers `get(level, variant)` by reading a
 * stored menu card, so a menu can exist with NO scenario file at all: an
 * operator makes the card in the FE and it is live. The code registry still
 * answers last, so a scenario that DOES have a file keeps working untouched —
 * the two coexist and the owner picks per menu.
 *
 * ── WHY THE SLUG RULE IS INJECTED, NOT BAKED IN ─────────────────────────────
 * The obvious shortcut is "the scenario key IS the slug". It is wrong here, and
 * the live data says so: the collection already holds `1234` next to
 * `menu-seed-primary-a` (read 29/08). A slug lives in the DB where an operator
 * renames it freely; a scenario key lives in code behind a deploy. Welding them
 * would mean an operator renaming a card silently breaks a menu — the exact
 * coupling the owner rejected ("dynamic อิสระเลือกได้").
 *
 * So `slugFor` is a DEPENDENCY. The caller states the rule, and can state a
 * different one per hook, per OA, or from a stored mapping, without this file
 * changing. Returning `null` means "no card is meant to serve this scenario" —
 * the chain then falls through to the next source, which is how a file-backed
 * scenario keeps priority over a card that happens to share a name.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 *   · DO NOT read `enabled` here. Whether a definition is usable is the
 *     ENGINE's decision (definition-source.port.ts), so a front source can
 *     disable something the registry still defines.
 *   · DO NOT send, log, or mutate. A source answers a question.
 *   · DO NOT invent items. The card's own buttons already carry their
 *     destinations (`menu:v1:open:<slug>` or `menu:v1:<scenario>:<item>`), so
 *     the stored renderer leaves them exactly as the operator drew them. An
 *     item list invented here would be minted OVER those buttons and would
 *     silently re-point every one of them.
 *
 * revert: delete this file + drop it from the source chain. Every menu with a
 *         scenario file keeps working, because the registry never moved.
 */
import type { MenuLevel } from '../menu-tag.util';
import { scenarioKey } from '../menu-tag.util';
import type { MenuContext } from '../menu-context';
import type { MenuDefinition } from '../scenarios/scenario.types';
import type { MenuDefinitionSource } from './definition-source.port';
import type { StoredMenuCardSource } from '../renderers/stored-card.port';

/**
 * Which card serves this scenario. `null` ⇒ none, fall through to the next
 * source. Async on purpose: a real rule may read a hook field or a mapping row.
 */
export type MenuSlugResolver = (
  scenarioKeyValue: string,
  context: MenuContext,
) => string | null | Promise<string | null>;

export interface CardSourceDeps {
  readonly cards: StoredMenuCardSource;
  readonly slugFor: MenuSlugResolver;
  /** The flex type to look up. Injected — the value is owned by `content`. */
  readonly flexType?: string;
  /** Fire-and-forget; a logging failure must never cost a menu. */
  readonly warn?: (detail: string) => void;
}

/** What `content` ships today. Overridable via `deps.flexType`. */
const DEFAULT_FLEX_TYPE = 'menu';

export class CardDefinitionSource implements MenuDefinitionSource {
  public constructor(private readonly deps: CardSourceDeps) {}

  public async get(
    level: MenuLevel,
    variant: string | null,
    context: MenuContext,
  ): Promise<MenuDefinition | null> {
    const key = scenarioKey(level, variant);

    let slug: string | null = null;
    try {
      slug = await this.deps.slugFor(key, context);
    } catch (err) {
      /* A rule that throws must not take the menu down — fall through to the
         next source, which is the behaviour as if no card were mapped. */
      this.safeWarn(`slug rule failed for ${key}: ${(err as Error)?.message}`);
      return null;
    }
    if (!slug) return null;

    let card = null;
    try {
      card = await this.deps.cards.find({
        flexType: this.deps.flexType ?? DEFAULT_FLEX_TYPE,
        slug,
      });
    } catch (err) {
      this.safeWarn(`card read failed for ${key}: ${(err as Error)?.message}`);
      return null;
    }
    /* No card under that slug ⇒ fall through rather than answer an empty menu.
       A deleted card must not shadow the file-backed scenario behind it. */
    if (!card || card.deleted_at || !card.content_json) return null;

    return {
      key,
      level,
      variant,
      /* Enabled because a card that EXISTS is the operator saying "use this".
         Removing the card, or pointing the rule elsewhere, is how it is turned
         off — there is no second switch to keep in sync. */
      enabled: true,
      /* The card supplies the look; `title` is only the LINE alt-text, so the
         card's own name is the honest value rather than an invented string. */
      title:
        typeof card.name === 'string' && card.name.trim() ? card.name : key,
      /* Deliberately EMPTY — see the header. The card's buttons already carry
         their own destinations, and any item here would be minted over them. */
      items: [],
      render: 'stored',
      card: { flexType: this.deps.flexType ?? DEFAULT_FLEX_TYPE, slug },
    };
  }

  private safeWarn(detail: string): void {
    try {
      this.deps.warn?.(detail);
    } catch {
      /* observability must never break a reply */
    }
  }
}
