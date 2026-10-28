/**
 * [FEAT-20260822-BCASTPERRECIP] Does this card need per-recipient values, and
 * does that agree with the type the admin ticked?
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock.
 *
 * The admin's tick DECIDES how the run is sent (owner, 22/08). This file does
 * not overrule it — it CHECKS it, because the failure it prevents is silent:
 *
 *   ticked "plain" + card contains {{member.display_name}}
 *      → rendered once per OA → the send succeeds, no error anywhere,
 *        and EVERY customer sees `N/A` where their own name should be.
 *
 * The reverse mismatch is not wrong, only wasteful: a personalised send of a
 * card that needs nothing per person costs one request per person for no
 * reason, so it warns instead of refusing.
 *
 * ⚠️ Must run BEFORE substitution — afterwards the tag names are gone.
 *
 * revert: delete this file with the rest of `checks/`.
 */

/**
 * Tag families whose value differs from one recipient to the next.
 *
 * ⚠️ THE ONE DEFINITION. `send-profile.registry.ts` lists the same two families
 * in glob form for its `allows_tags`, and review flagged the pair as two hand-
 * maintained copies. A spec now pins them together, so adding a third family to
 * one and forgetting the other cannot happen quietly.
 * เพิ่มตระกูลใหม่ต้องแก้สองที่ — เทสบังคับให้แก้ครบ.
 */
export const PER_RECIPIENT_PREFIXES = ['member.', 'profile.'] as const;

const TAG_RE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/** Every `{{tag}}` in the card, de-duplicated, in first-seen order. */
export function collectTags(cardJson: unknown): string[] {
  let text: string;
  try {
    text = typeof cardJson === 'string' ? cardJson : JSON.stringify(cardJson);
  } catch {
    return []; // a card we cannot read is not a card with tags
  }
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[1];
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/** The per-recipient tags this card uses — empty means it needs none. */
export function perRecipientTags(cardJson: unknown): string[] {
  return collectTags(cardJson).filter((t) =>
    PER_RECIPIENT_PREFIXES.some((p) => t.startsWith(p)),
  );
}

/** Shorthand: does this card read anything that differs per person? */
export function needsPerRecipient(cardJson: unknown): boolean {
  return perRecipientTags(cardJson).length > 0;
}

export type ProfileMatchVerdict =
  | { readonly kind: 'ok' }
  /** Ticked plain, card needs per-recipient values ⇒ refuse. */
  | { readonly kind: 'refuse'; readonly tags: string[] }
  /** Ticked personal, card needs nothing per person ⇒ allow, but say so. */
  | { readonly kind: 'wasteful' };

/**
 * Compare the ticked type against what the card actually reads.
 *
 * Returns a verdict; the caller owns the wording and the HTTP status. This file
 * never throws and never decides policy.
 */
export function checkProfileMatch(
  cardJson: unknown,
  tickedPerRecipient: boolean,
): ProfileMatchVerdict {
  const tags = perRecipientTags(cardJson);
  if (tags.length > 0 && !tickedPerRecipient) return { kind: 'refuse', tags };
  if (tags.length === 0 && tickedPerRecipient) return { kind: 'wasteful' };
  return { kind: 'ok' };
}
