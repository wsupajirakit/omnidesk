/**
 * ==== [FEAT-20260828-MENUTAG-S1] the menu tag grammar — single source ====
 *
 * PLAN: todo/task/28082026/todo1_28082026_menu-primary-tag.md §3b.
 * Every regex in the menu family is DERIVED from the constants below — the
 * plan forbids a second hand-written literal (R2), because two spellings of
 * the same grammar is how the inbound and outbound halves drift apart.
 *
 * Case-sensitive LOWERCASE-ONLY on purpose: an uppercase spelling is NOT a
 * menu tag (it falls to the existing reply-tags catch-all like any unknown
 * marker), which keeps tag ↔ scenario key ↔ file name byte-identical with
 * zero normalisation.
 *
 * `default` is RESERVED: `menu-<level>-default` parses to null. The
 * `default.ts` scenario file belongs exclusively to the bare-level key
 * (`primary`, `second`), so the registry-completeness diff stays decidable.
 *
 * ── DO NOT ─────────────────────────────────────────────────────────────────
 *   · DO NOT write a second regex for this family anywhere — not in a service,
 *     not in a spec, not in the outbound half. Everything is derived from the
 *     constants above, so widening the charset or adding a level is ONE edit
 *     that every consumer inherits. A hand-written copy is how the inbound and
 *     outbound halves drift apart and a marker reaches a customer.
 *   · DO NOT make the tap match case-insensitively or as a substring. Both are
 *     load-bearing: an uppercase or embedded spelling must fall through to the
 *     existing catch-all exactly as any unknown marker does.
 *   · DO NOT free the `default` variant. `default.ts` belongs to the bare-level
 *     key alone, which is what keeps the registry diff decidable.
 *
 * revert: delete src/modules/menu/ whole — nothing outside the module
 * imports this file until the S3 patch lands.
 */

/** The levels that exist. A new level = one entry here + one folder. */
export const MENU_LEVELS = ['primary', 'second'] as const;
export type MenuLevel = (typeof MENU_LEVELS)[number];

/** Variant charset — also the file-name charset (plan §3a path rule). */
export const VARIANT_CHARSET = 'a-z0-9_-';

/** Reserved word: the bare-level key owns default.ts. */
export const RESERVED_VARIANT = 'default';

/**
 * Postback item-id charset. Same alphabet as a variant and stated ONCE:
 * the codec, the scenario contract and their specs all read it from here, so
 * widening the alphabet can never be a half-applied change.
 */
export const ITEM_ID_CHARSET = VARIANT_CHARSET;

const LEVEL_ALT = MENU_LEVELS.join('|');

/** Whole-text tap form: the ENTIRE trimmed text is the tag. No /i flag. */
const STRICT_TAG_RE = new RegExp(
  `^\\[\\[\\[menu-(${LEVEL_ALT})(?:-([${VARIANT_CHARSET}]+))?\\]\\]\\]$`,
);

/** Substring form for OUTBOUND detection inside answers (S5 consumes it). */
const OUTBOUND_TAG_RE = new RegExp(
  `\\[\\[\\[menu-(${LEVEL_ALT})(?:-([${VARIANT_CHARSET}]+))?\\]\\]\\]`,
);

/**
 * Tolerant strip (R2): the legacy catch-all's unclosed-marker class has no
 * hyphen, so a broken `[[[menu-primary-x` would leave the literal residue
 * `-primary-x` on the customer's screen. This form removes a broken menu
 * marker WHOLE. Derived from the same constants — never a second literal.
 */
const TOLERANT_STRIP_RE = new RegExp(
  `\\[{2,3}menu-(?:${LEVEL_ALT})[${VARIANT_CHARSET}]*\\]{0,3}`,
  'g',
);

export interface ParsedMenuTag {
  readonly level: MenuLevel;
  readonly variant: string | null;
}

/** The ONE spelling of a scenario key, shared by every layer (plan §3a). */
export function scenarioKey(level: MenuLevel, variant: string | null): string {
  return variant ? `${level}-${variant}` : level;
}

/**
 * The (level, variant) → FILE NAME half of the mechanical path rule
 * (plan §3a): `default.ts` belongs to the bare-level key, every other variant
 * is its own file name. Stated here so a loader, a spec, or a future dynamic
 * source can never each invent their own spelling of it.
 */
export function scenarioFileName(variant: string | null): string {
  return variant ?? RESERVED_VARIANT;
}

/** The inverse: a scenario file name → its variant (`default.ts` → null). */
export function variantFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.ts$/, '');
  return base === RESERVED_VARIANT ? null : base;
}

/** Inverse of `scenarioKey`. Null = not a well-formed key. */
export function parseScenarioKey(key: string): ParsedMenuTag | null {
  for (const level of MENU_LEVELS) {
    if (key === level) return { level, variant: null };
    if (key.startsWith(`${level}-`)) {
      const variant = key.slice(level.length + 1);
      if (
        variant.length > 0 &&
        variant !== RESERVED_VARIANT &&
        new RegExp(`^[${VARIANT_CHARSET}]+$`).test(variant)
      ) {
        return { level, variant };
      }
      return null;
    }
  }
  return null;
}

/** Inbound tap: whole trimmed text must BE the tag. */
export function parseMenuTag(text: unknown): ParsedMenuTag | null {
  if (typeof text !== 'string') return null;
  const m = STRICT_TAG_RE.exec(text.trim());
  if (!m) return null;
  const variant = m[2] ?? null;
  if (variant === RESERVED_VARIANT) return null; // reserved (plan §3b)
  return { level: m[1] as MenuLevel, variant };
}

/** Outbound: first menu tag ANYWHERE in the text (S5's detector). */
export function findMenuTag(text: unknown): ParsedMenuTag | null {
  if (typeof text !== 'string') return null;
  const m = OUTBOUND_TAG_RE.exec(text);
  if (!m) return null;
  const variant = m[2] ?? null;
  if (variant === RESERVED_VARIANT) return null;
  return { level: m[1] as MenuLevel, variant };
}

export function hasMenuTag(text: unknown): boolean {
  return findMenuTag(text) !== null;
}

/** Strips menu markers INCLUDING broken/unclosed ones, whole (R2). */
export function stripMenuTags(text: unknown): string {
  /* Only a string can carry a marker; anything else has nothing to strip and
     must not be coerced (an object would stringify to "[object Object]"). */
  if (typeof text !== 'string') return '';
  return text.replace(TOLERANT_STRIP_RE, '').trim();
}
