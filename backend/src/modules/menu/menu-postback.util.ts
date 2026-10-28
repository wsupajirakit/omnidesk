/**
 * ==== [FEAT-20260828-MENUTAG-S1] the `menu:v1:` postback codec ====
 *
 * PLAN: §3c. The payload carries the scenario KEY VERBATIM — one string in
 * every layer, no decompose/recompose drift:
 *
 *     menu:v1:<scenario-key>:<item-id>
 *
 * 🔴 The codec REQUIRES the full versioned shape. A committed test fixture is
 * LITERALLY `menu:open` (room-bootstrap-before-pack S08, plan R16): anything
 * without the `v1` segment — bare `menu:open` included — parses as NOT OURS,
 * so the frozen snapshot can never flip and foreign payloads fall through
 * exactly like `pay:`/`hoc:` do today.
 *
 * ≤ 300 bytes (LINE's postback limit) enforced loudly at BUILD time — a
 * payload that would be truncated by LINE must never be minted at all.
 *
 * revert: delete src/modules/menu/ whole.
 */
import { ITEM_ID_CHARSET, parseScenarioKey } from './menu-tag.util';

export const MENU_POSTBACK_PREFIX = 'menu:v1:';

/** LINE caps postback data at 300 bytes. */
export const MENU_POSTBACK_MAX_BYTES = 300;

/* Derived, never a second literal — the charset lives in menu-tag.util.ts. */
const ITEM_ID_RE = new RegExp(`^[${ITEM_ID_CHARSET}]+$`);

export interface ParsedMenuPostback {
  readonly scenarioKey: string;
  readonly itemId: string;
  /** [FEAT-20260902-MENUPRESSONCE] present only on a stamped payload. */
  readonly render?: string;
}

/**
 * ==== [FEAT-20260902-MENUPRESSONCE] the render stamp ====
 *
 * `…<destination>@<render>` — "this payload came from THAT sent card".
 *
 * WHY IT HAS TO BE IN THE PAYLOAD AT ALL. Every payload above is a pure function
 * of its DESTINATION, so two presses on two different cards are byte-identical
 * events. A LINE postback carries no reference to the message the button sits on
 * (verified against the official reference and against a real captured event in
 * `webhook_logs`), and LINE has no API to edit or disable a sent message
 * (developers.line.biz FAQ) — the platform's own answer, used by Telegram, Slack
 * and Discord, is unavailable here. So the ONLY place a render identity can come
 * from is a value we mint before sending and carry in `data`.
 *
 * 🔴 `@` IS PROVEN UNCLAIMED, NOT ASSUMED. All three parsers below were run
 * against stamped strings before this was written:
 *   parseMenuOpenFlexPostback('menu:v1:open:flex:menu_main_00010@ab12') → null
 *   parseMenuOpenPostback    ('menu:v1:open:sub-a@ab12')                → null
 *   parseMenuPostback        ('menu:v1:primary-a:item-1@ab12')          → null
 * `-` and `_` were tried FIRST and are CLAIMED — they are inside
 * `ITEM_ID_CHARSET`, so `sub-a-ab12` parses as the slug `sub-a-ab12` and the
 * button would silently re-point at a card that does not exist. That near miss
 * is why the separator is measured rather than chosen.
 *
 * 🔴 HEX, DELIBERATELY. An unclaimed postback payload becomes chat text and
 * reaches the notice word screens (`webhook.service.ts` msgContent path), where
 * latin words match on `\b` boundaries — and a non-word separator CREATES a
 * boundary. Hex cannot spell the words those screens look for (they all contain
 * letters outside `a-f`), so a stamped payload that somehow failed to parse
 * still cannot trip a deposit/withdraw rule. อย่าเปลี่ยนเป็น base62.
 *
 * revert: stop calling `stampMenuPostback`. An UNSTAMPED payload parses exactly
 * as it did before this existed, so nothing has to be un-migrated.
 */
export const MENU_RENDER_SEPARATOR = '@';

/** 8 hex chars = 4 bytes. Scoped per person+hook, so collisions need all three. */
export const MENU_RENDER_ID_RE = /^[0-9a-f]{8}$/;

/**
 * Peel `@<render>` off the end. Returns the body unchanged and `undefined` when
 * there is no stamp — which is what makes every pre-existing payload keep
 * parsing byte-identically.
 *
 * ⚠️ A trailing `@` that is NOT a valid stamp is left ON the body on purpose, so
 * it fails the body's own charset test and the payload reads as NOT OURS. A
 * malformed stamp must never be silently treated as an unstamped payload — that
 * would be a way to opt out of the press budget by editing one character.
 */
function peelRender(rest: string): { body: string; render?: string } {
  const at = rest.lastIndexOf(MENU_RENDER_SEPARATOR);
  if (at < 0) return { body: rest };
  const render = rest.slice(at + 1);
  if (!MENU_RENDER_ID_RE.test(render)) return { body: rest };
  return { body: rest.slice(0, at), render };
}

/**
 * Append a render stamp to a payload this module minted. Throws on a malformed
 * render id — same rule as every other mint here: a broken payload fails at
 * BUILD time, never silently at the customer.
 *
 * Goes through `capped()`, so the 300 limit stays enforced in ONE place and a
 * stamp can never be the thing that pushes a payload over it.
 * (LINE counts 300 CHARACTERS in UTF-16 code units; `capped` counts BYTES, so it
 * is stricter than the platform — safe, never wrong.)
 */
export function stampMenuPostback(payload: string, render: string): string {
  if (!MENU_RENDER_ID_RE.test(render)) {
    throw new Error(`[MENU] not a valid render id: "${render}"`);
  }
  return capped(`${payload}${MENU_RENDER_SEPARATOR}${render}`);
}

/**
 * ==== [FEAT-20260829-MENUSLUGLINK] the slug-link form ====
 *
 * `menu:v1:open:<slug>` — "open the menu CARD whose `flex_slug` is <slug>".
 *
 * WHY a second form instead of reusing the scenario form: the owner's model is
 * that a card names its own destination, so an operator can point main `a` at
 * `sub-a` today and `sub-x` tomorrow by editing ONE button in the FE — no
 * deploy, no scenario file, no code. The scenario form addresses CODE
 * (`primary`, `second-b`); this one addresses DATA (a row's slug). They are
 * different namespaces and must not be confused, which is why the discriminator
 * `open` sits where a level would be: `parseScenarioKey('open')` is null, so
 * `open` can never be mistaken for a level and no existing payload changes
 * meaning. Verified before writing: `menu:v1:open:sub-a` parsed as NOT-OURS
 * (null) beforehand, so adding this form is purely additive.
 *
 * A button that should NOT go anywhere simply does not carry one of these — a
 * `uri` button, or no button at all. There is no "target" field to leave empty,
 * because a link that goes nowhere is the absence of a link, not a null one.
 */
export const MENU_OPEN_DISCRIMINATOR = 'open';

/** `{ slug }` for the slug-link form. */
export interface ParsedMenuOpen {
  readonly slug: string;
  /** [FEAT-20260902-MENUPRESSONCE] present only on a stamped payload. */
  readonly render?: string;
}

/** Throws on any malformed input — a bad payload must fail the BUILD, loudly. */
export function buildMenuPostback(
  scenarioKeyArg: string,
  itemId: string,
): string {
  if (!parseScenarioKey(scenarioKeyArg)) {
    throw new Error(`[MENU] not a scenario key: "${scenarioKeyArg}"`);
  }
  if (!ITEM_ID_RE.test(itemId)) {
    throw new Error(`[MENU] not a valid item id: "${itemId}"`);
  }
  return capped(`${MENU_POSTBACK_PREFIX}${scenarioKeyArg}:${itemId}`);
}

/**
 * The ONE place the 300-byte cap is enforced. Both payload forms mint through
 * it, so the cap can never drift between them — DO-NOT #5 of the module
 * contract (one spelling of anything; a copy drifts, a derived value cannot).
 */
function capped(payload: string): string {
  if (Buffer.byteLength(payload, 'utf8') > MENU_POSTBACK_MAX_BYTES) {
    throw new Error(
      `[MENU] postback payload exceeds ${MENU_POSTBACK_MAX_BYTES} bytes`,
    );
  }
  return payload;
}

/**
 * Null = NOT OURS (foreign payloads fall through untouched — the zero-impact
 * contract C1.3). Only the exact full shape parses.
 */
export function parseMenuPostback(data: unknown): ParsedMenuPostback | null {
  if (typeof data !== 'string' || !data.startsWith(MENU_POSTBACK_PREFIX))
    return null;
  /* [FEAT-20260902-MENUPRESSONCE] the stamp is peeled BEFORE the shape is
     judged, so the grammar below is exactly the grammar it always was. */
  const { body: rest, render } = peelRender(
    data.slice(MENU_POSTBACK_PREFIX.length),
  );
  const lastColon = rest.lastIndexOf(':');
  if (lastColon <= 0 || lastColon === rest.length - 1) return null;
  const scenarioKeyPart = rest.slice(0, lastColon);
  const itemId = rest.slice(lastColon + 1);
  if (!parseScenarioKey(scenarioKeyPart) || !ITEM_ID_RE.test(itemId))
    return null;
  return { scenarioKey: scenarioKeyPart, itemId, ...(render && { render }) };
}

/**
 * Mint `menu:v1:open:<slug>`. Throws on a malformed slug — a dead button must
 * fail at BUILD time, never silently at the customer (same rule as the scenario
 * form). The charset is the shared one, so a slug an operator can type in the FE
 * is exactly a slug this can carry.
 */
export function buildMenuOpenPostback(slug: string): string {
  if (!ITEM_ID_RE.test(slug)) {
    throw new Error(`[MENU] not a valid slug: "${slug}"`);
  }
  return capped(`${MENU_POSTBACK_PREFIX}${MENU_OPEN_DISCRIMINATOR}:${slug}`);
}

/**
 * Null = not a slug-link (a scenario payload, or not ours at all). Callers try
 * this FIRST and fall through to `parseMenuPostback`, so the two forms never
 * compete for the same string.
 */
export function parseMenuOpenPostback(data: unknown): ParsedMenuOpen | null {
  if (typeof data !== 'string' || !data.startsWith(MENU_POSTBACK_PREFIX))
    return null;
  const { body: rest, render } = peelRender(
    data.slice(MENU_POSTBACK_PREFIX.length),
  );
  const head = `${MENU_OPEN_DISCRIMINATOR}:`;
  if (!rest.startsWith(head)) return null;
  const slug = rest.slice(head.length);
  return ITEM_ID_RE.test(slug) ? { slug, ...(render && { render }) } : null;
}

/**
 * ==== [FEAT-20260831-OPENFLEXTAG] the flex-tag form ====
 *
 * `menu:v1:open:flex:<flex_tag>` — "open the flex card carrying this MINTED
 * tag", whatever type that card is: `flex_m00023`, `flex_pc00003`,
 * `menu_main_00010`. Owner 31/08: a menu button should be able to open a flex
 * card by the same tag that already names it in an AI prompt
 * (`[[[flex_m00023]]]` ⇒ `menu:v1:open:flex:flex_m00023`).
 *
 * 🔴 PROVEN UNCLAIMED BEFORE IT WAS WRITTEN, by running both existing parsers:
 *   parseMenuOpenPostback('menu:v1:open:flex:flex_m00023') → null
 *   parseMenuPostback    ('menu:v1:open:flex:flex_m00023') → null
 * because `flex:flex_m00023` contains a colon and the shared charset has none,
 * and `open:flex` is not a scenario key. So the string means NOTHING today and
 * adding it changes no payload that exists — the same argument, and the same
 * evidence, the slug-link form recorded above.
 *
 * ⚠️ WHY IT SITS UNDER `open:` RATHER THAN BESIDE IT: a slug and a tag both name
 * ONE stored card, so they are the same door with two keys. `flex` is the
 * discriminator that says which key follows. A slug can never collide with it —
 * a slug reaching this parser would have to be literally `flex:…`, and a colon
 * is not in the charset a slug may contain.
 */
export const MENU_OPEN_FLEX_DISCRIMINATOR = 'flex';

/** `{ tag }` for the flex-tag form. */
export interface ParsedMenuOpenFlex {
  readonly tag: string;
  /** [FEAT-20260902-MENUPRESSONCE] present only on a stamped payload. */
  readonly render?: string;
}

/**
 * The shape EVERY minted tag has: letters/underscores then digits
 * (`flex_m00023`, `menu_main_00010`). A shape, deliberately NOT a list of
 * prefixes — a list here would be a second spelling of one that already lives in
 * `FLEX_TAG_CONFIG`, and the two would drift the first time a family is added
 * (module contract DO-NOT #5). What it buys: `open:flex:` addresses minted tags
 * and nothing else, so the door cannot be pointed at free text.
 */
const MINTED_TAG_RE = /^[a-z][a-z_]*[0-9]+$/;

/**
 * Mint `menu:v1:open:flex:<tag>`. Throws on a malformed tag — a dead button must
 * fail at BUILD time, never silently at the customer.
 */
export function buildMenuOpenFlexPostback(tag: string): string {
  if (!MINTED_TAG_RE.test(tag)) {
    throw new Error(`[MENU] not a minted flex tag: "${tag}"`);
  }
  return capped(
    `${MENU_POSTBACK_PREFIX}${MENU_OPEN_DISCRIMINATOR}:` +
      `${MENU_OPEN_FLEX_DISCRIMINATOR}:${tag}`,
  );
}

/**
 * Null = not a flex-tag link. Tried FIRST by the engine because it is the most
 * specific shape; the other two answer null for it either way, which is asserted
 * rather than assumed so the order can never become load-bearing by accident.
 */
export function parseMenuOpenFlexPostback(
  data: unknown,
): ParsedMenuOpenFlex | null {
  if (typeof data !== 'string' || !data.startsWith(MENU_POSTBACK_PREFIX))
    return null;
  const { body: rest, render } = peelRender(
    data.slice(MENU_POSTBACK_PREFIX.length),
  );
  const head = `${MENU_OPEN_DISCRIMINATOR}:${MENU_OPEN_FLEX_DISCRIMINATOR}:`;
  if (!rest.startsWith(head)) return null;
  const tag = rest.slice(head.length);
  return MINTED_TAG_RE.test(tag) ? { tag, ...(render && { render }) } : null;
}
