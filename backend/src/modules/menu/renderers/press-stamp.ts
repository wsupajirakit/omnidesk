/**
 * ==== [FEAT-20260902-MENUPRESSONCE] stamping a rendered card ====
 *
 * Walk a drawn bubble and give every button that is OURS the same render id, so
 * a press can later be traced back to THE CARD IT CAME FROM. That identity
 * cannot come from anywhere else: a LINE postback carries no reference to its
 * message, and LINE has no API to edit or disable a card once sent.
 *
 * WHAT IT TOUCHES, and nothing else:
 *   · a payload that parses as one of this module's three forms → stamped
 *   · everything else → returned byte-identical. A `uri` button, a `message`
 *     button, an operator's own link, a `pay:` / `hoc:` / `paylink:` payload:
 *     all untouched.
 *
 * ⚠️ `uri` AND `message` BUTTONS CANNOT BE COVERED, EVER — owner informed and
 * accepted 02/09 (*"ปล่อยได้เคสนี้"*). A `uri` opens its link on LINE's side and
 * never reaches this server; a `message` button makes the CUSTOMER send text, so
 * limiting it would mean matching their own words — the exact trap the
 * contact-admin button had to be rescued from. The boundary is inherited, not
 * invented: `mintButtons` already leaves both action types exactly as the
 * operator drew them, so this pass and that one agree by construction.
 * 🔴 Operator-facing consequence: a button that must be limited HAS to be a
 * postback. A link button silently will not be.
 *
 * ⚠️ ORDER: this runs AFTER `mintButtons`, so it sees final payloads. It must
 * also run after variable substitution — two specs assert that no substitution
 * pass ever sees a minted payload, and stamping earlier would put one in front
 * of them.
 *
 * revert: stop passing `renderStamp` to the stored renderer. Nothing else has to
 * change; an unstamped payload parses exactly as it did before this file.
 */
import { randomBytes } from 'node:crypto';
import {
  parseMenuOpenFlexPostback,
  parseMenuOpenPostback,
  parseMenuPostback,
  stampMenuPostback,
} from '../menu-postback.util';

/**
 * True when the payload is one this module minted or owns. Asked through the
 * REAL parsers rather than a prefix test, so a foreign string that merely starts
 * with `menu:v1:` — the coexistence suite keeps a list of them — is not ours and
 * is left alone.
 */
function isOurs(data: unknown): boolean {
  return (
    parseMenuOpenFlexPostback(data) !== null ||
    parseMenuOpenPostback(data) !== null ||
    parseMenuPostback(data) !== null
  );
}

/**
 * Return a copy of `contents` whose menu postbacks carry `render`.
 *
 * DEEP-COPIED first for the same reason `mintButtons` copies: `content_json` is
 * a shared document, and a pass that mutated it would poison the next customer's
 * card with this one's render id — which would hand them a card whose buttons
 * were already spent.
 *
 * A payload that is ALREADY stamped is re-stamped with the new id, not
 * double-stamped: `stampMenuPostback` appends to the parsed body, and the
 * parsers peel a stamp before judging shape, so re-rendering the same card is
 * always a fresh budget.
 */
export function stampCardButtons(
  contents: unknown,
  render: string,
): Record<string, unknown> {
  const doc = JSON.parse(JSON.stringify(contents)) as Record<string, unknown>;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;

    const obj = node as Record<string, unknown>;
    const action = obj['action'] as Record<string, unknown> | undefined;
    if (action && typeof action === 'object' && isOurs(action['data'])) {
      const parsed =
        parseMenuOpenFlexPostback(action['data']) ??
        parseMenuOpenPostback(action['data']) ??
        parseMenuPostback(action['data']);
      /* Rebuild from the payload MINUS any stamp it already carries, so a
         re-render replaces the id instead of appending a second one. */
      const bare = stripStamp(String(action['data']), parsed?.render);
      obj['action'] = { ...action, data: stampMenuPostback(bare, render) };
    }

    for (const [k, v] of Object.entries(obj)) {
      if (k === 'action') continue;
      obj[k] = walk(v);
    }
    return obj;
  };

  return walk(doc) as Record<string, unknown>;
}

/** Remove a stamp the parsers already recognised. No stamp ⇒ unchanged. */
function stripStamp(data: string, render?: string): string {
  return render ? data.slice(0, data.length - render.length - 1) : data;
}

/**
 * Which button a press was on. It is the payload's own destination — the tag,
 * the slug, or `<scenarioKey>:<itemId>` — so the key needs no extra bytes on the
 * wire and cannot disagree with what the button actually points at.
 *
 * `null` = not one of ours, so there is nothing to charge.
 */
export function pressItemOf(data: unknown): string | null {
  const flex = parseMenuOpenFlexPostback(data);
  if (flex) return flex.tag;
  const link = parseMenuOpenPostback(data);
  if (link) return link.slug;
  const pb = parseMenuPostback(data);
  if (pb) return `${pb.scenarioKey}:${pb.itemId}`;
  return null;
}

/**
 * The stamp a press carries, or `undefined` for a card sent before this feature
 * existed. Read through the parsers so there is one definition of the shape.
 */
export function pressRenderOf(data: unknown): string | undefined {
  return (
    parseMenuOpenFlexPostback(data)?.render ??
    parseMenuOpenPostback(data)?.render ??
    parseMenuPostback(data)?.render
  );
}

/**
 * A fresh render id: 8 hex characters, 4 bytes of `randomBytes`.
 *
 * WHY RANDOM AND NOT A COUNTER: a counter needs shared state, which is the very
 * thing this feature is trying to keep to one small collection — and a counter
 * that resets (a redeploy, a second instance) would re-issue ids that are still
 * live. Random needs nothing and cannot reset.
 *
 * WHY 8 IS ENOUGH: a claim is keyed by (render, button, PERSON, OA), so a
 * collision has to be the same id, the same button, the same customer and the
 * same OA inside the same TTL window. Against ~4 billion values and a handful of
 * renders per person per window, that is not a risk being taken — it is a risk
 * that does not exist. Hex keeps the alphabet safe (see the codec's note).
 */
export function mintRenderId(): string {
  return randomBytes(4).toString('hex');
}
