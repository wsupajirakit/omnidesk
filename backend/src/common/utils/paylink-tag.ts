/**
 * [FEAT-20260831-MENUVARSET] The `{{paylink.*}}` grammar, in ONE place.
 * ===========================================================================
 * WHY THIS FILE EXISTS. Two sides need the same spelling and they cannot import
 * each other:
 *   · the MINTER (`webhook/payment-reply/payment-action-mint.ts`) turns a tag
 *     into a working button at send time;
 *   · the GUIDE (`content/flex-var/paylink-guidelines.ts`) offers the tag to
 *     an operator on the flex editor, and that table doubles as the save-time
 *     allowlist.
 * `content` cannot import `payment`/`webhook`: both already import `content`
 * (`payment.module.ts:19`, `payment-runner.service.ts:151`), so the dependency
 * would close a runtime cycle. A leaf under `common/` is reachable from both
 * with nothing pointing back. ห้ามให้ content เรียก payment — วนกลับ.
 *
 * WHY NOT LET EACH SIDE SPELL IT. A guide that prints a tag the minter does not
 * accept is worse than no guide: the card saves, and the customer reads
 * `{{paylink.…}}` on their phone. Two spellings drift the day an action is
 * renamed; one derivation cannot. This is the same rule
 * `menu-postback-guidelines.ts` follows for the menu payloads.
 *
 * revert: move `PAYLINK_TAG_FIELD` back into `payment-action-mint.ts` and
 *         delete this file plus the guide that reads it.
 */

/** The namespace every paylink tag carries. Used to BUILD and to MATCH. */
export const PAYLINK_NS = 'paylink';

/**
 * WHERE THE OPERATOR WRITES THE TAG — not where its payload ends up.
 *
 * 🔴 [FEAT-20260902-ADMINPOSTBACK] READ THIS BEFORE CHANGING A ROW. This map used
 * to mean both things at once, because every tag happened to be minted into the
 * same field it was authored in. That stopped being true when the contact buttons
 * became postback-only: they are still AUTHORED as `action.text` on a
 * `type: "message"` button — that is what every stored card, every seeded card and
 * every guide row says — but they are MINTED into a `type: "postback"` action.
 * The minter owns that rewrite (`payment-action-mint.ts`, `resolveTag`).
 *
 * Keeping the authored field unchanged is deliberate and load-bearing: flipping a
 * row here to `'data'` would make the minter refuse every card already in the
 * database — `TAG_FIELD[name] !== field` drops the whole button node, silently, so
 * the card ships with the button simply missing. There is no deploy order that
 * avoids that window, which is why the rewrite lives in the minter instead.
 * ⇒ แถวนี้ = ที่ที่คนเขียน tag ไม่ใช่ที่ที่ payload ไปลง ห้ามสลับเป็น 'data'
 */
export const PAYLINK_TAG_FIELD: Record<string, 'data' | 'text'> = {
  // postback payload — the resume contract. Authored AND minted in `data`.
  retry: 'data',
  // authored in `text`; minted into a postback (see PAYLINK_MINTS_POSTBACK).
  contact_admin: 'text',
  /* [FEAT-20260831-ADMINVIAWITHDRAW] the same button with one extra step: the
     withdraw notice lane is screened FIRST, and the customer reaches an admin
     only when nothing there fires. Same authored field, same kind of button —
     the difference is entirely in what the tap triggers on the way in, which is
     why this is a row here and not a mechanism of its own. */
  contact_admin_via_withdraw: 'text',
};

/**
 * [FEAT-20260902-ADMINPOSTBACK] Which tags mint into a `paylink:` POSTBACK.
 * ===========================================================================
 * WHY THIS EXISTS AT ALL. A LINE `message` button posts ordinary text, so the
 * server cannot tell a BUTTON PRESS from a customer typing the same words. The
 * old doors compared the posted text against a copy constant, which meant anyone
 * typing "ติดต่อแอดมิน" opened a case. Owner, 02/09: the behaviour must fire on a
 * real press and on nothing else. A postback is the only LINE action that carries
 * that proof, so these tags mint one.
 * ⇒ ต้องมาจากการกดปุ่มเท่านั้น พิมพ์เองต้องไม่ทำงาน
 *
 * ⚠️ `retry` is NOT here even though it is also a postback: its payload is the
 *    payment resume contract (`pay:resume:<runId>:<idx>`), minted by
 *    `payment-postback.handler.ts`, which carries per-run state this namespace
 *    has no way to express. Two postback grammars, deliberately separate.
 *
 * SCOPE — what to change if this ever moves:
 *   · a NEW tag that should be button-only  → add its name to BOTH this set and
 *     `PAYLINK_TAG_FIELD`, add its action patch in `payment-action-mint.ts`,
 *     and give it a door in `webhook.service.ts`. A name in this set with no door
 *     is a button that does nothing at all.
 *   · reverting ONE tag to a plain message button → drop it from this set only;
 *     the minter falls back to substituting the copy text in place, which is the
 *     pre-02/09 behaviour, and its door stops matching.
 */
export const PAYLINK_MINTS_POSTBACK: ReadonlySet<string> = new Set([
  'contact_admin',
  'contact_admin_via_withdraw',
]);

/**
 * The postback payload namespace for the tags above.
 *
 * ⚠️ IT MAY NOT START WITH `pay:` AND THIS IS MEASURED, NOT STYLISTIC. `pay` is a
 *    latin entry in BOTH `DEPOSIT_WORDS` and `WITHDRAW_WORDS`
 *    (`notice-word-match.ts`), matched on `\b…\b` boundaries — and `:` is a
 *    non-word character, so the payload `pay:…` matches `\bpay\b` and would trip
 *    the notice guard, where the DEPOSIT cases are screened first. The customer
 *    would get a deposit card for pressing an admin button. `paylink:` cannot
 *    match, because the character after `pay` is a word character.
 * ⚠️ It must also not start with `menu:v1:` (the menu engine claims that) — the
 *    two namespaces are checked by prefix and never overlap.
 *
 * The `v1` segment is here so a future payload can carry arguments without
 * ambiguity; today the whole payload is prefix + tag name and nothing else.
 */
export const PAYLINK_POSTBACK_PREFIX = `${PAYLINK_NS}:v1:`;

/** `contact_admin` → `paylink:v1:contact_admin`. The only way to build one. */
export function payLinkPostbackData(name: string): string {
  return `${PAYLINK_POSTBACK_PREFIX}${name}`;
}

/**
 * Read a paylink postback payload back into its tag name.
 *
 * Builder and parser live together on purpose — the same rule
 * `payment-postback.handler.ts` follows — so the two can never drift apart.
 *
 * @returns the tag name, or `null` when this payload is not ours. `null` must be
 *   treated as "not mine, fall through untouched": the menu engine and the
 *   payment retry both claim their own prefixes the same way, and a payload no
 *   one claims continues down the ordinary pipeline.
 *
 * ⚠️ An unknown name inside our OWN namespace answers `null` too. That is the
 *    safe direction: a tag that was renamed or removed stops matching its door
 *    rather than falling into a neighbouring one.
 */
export function payLinkFromPostback(data: unknown): string | null {
  if (typeof data !== 'string') return null;
  if (!data.startsWith(PAYLINK_POSTBACK_PREFIX)) return null;
  const name = data.slice(PAYLINK_POSTBACK_PREFIX.length).trim().toLowerCase();
  return PAYLINK_MINTS_POSTBACK.has(name) ? name : null;
}

/** `contact_admin` → `{{paylink.contact_admin}}`. The only way to spell one. */
export function payLinkTag(name: string): string {
  return `{{${PAYLINK_NS}.${name}}}`;
}

/**
 * [FIX-20260831-PAYLINKGUIDE] Which paylink tags an OPERATOR may be offered
 * on the flex editor — and therefore which ones the save-time allowlist accepts.
 *
 * 🔴 WHY THIS LIST EXISTS. `buildPayLinkGuidelines` used to hard-code the one
 * name it knew (`const CONTACT_ADMIN = 'contact_admin'`), so adding a row to
 * `PAYLINK_TAG_FIELD` above changed the MINTER and nothing else: the new tag
 * never appeared in the guide, and the guide doubles as the allowlist, so the
 * card was REFUSED on save — *"ตรวจพบ Tag ที่ไม่มีในระบบ"*. Found by the owner
 * the same day the tag shipped. One list, read by both, is the fix.
 *
 * ⚠️ `retry` is deliberately NOT here. It is minted from a payment RUN's resume
 *    state, which a hand-drawn card outside that flow can never supply, so
 *    offering it would put a button on screen that is always dropped at send.
 * ⚠️ `example` is what an operator sees in the table, not what the minter
 *    produces — the real text is copy owned by `payment-reply-copy.ts`, which
 *    `content` cannot import (it would close a cycle). Keep them consistent by
 *    hand; the mint specs assert the real values.
 */
export const PAYLINK_OFFERED: readonly {
  name: string;
  label: string;
  example: string;
  /**
   * The flex types this tag may be pasted onto.
   *
   * ⚠️ `retry` is `slip` ONLY — it is minted from a payment RUN's resume state,
   * which a card outside that flow can never supply, so offering it elsewhere
   * would put a button on screen that is always dropped at send time.
   */
  types: readonly string[];
}[] = [
  {
    name: 'retry',
    label: 'ปุ่มลองใหม่ของสลิป — ระบบเติม payload ให้ตอนส่ง',
    example: 'pay:resume:6a79…:3',
    types: ['slip'],
  },
  {
    name: 'contact_admin',
    label: 'ปุ่มติดต่อแอดมิน',
    example: 'ติดต่อแอดมิน',
    types: ['slip', 'menu'],
  },
  {
    name: 'contact_admin_via_withdraw',
    label:
      'ปุ่มติดต่อแอดมินเรื่องถอน — ตรวจเงื่อนไข notice ฝั่งถอนก่อน ติดเงื่อนไขไหนส่งการ์ดนั้นแทน',
    example: 'ติดต่อแอดมินปัญหาการถอน',
    types: ['slip', 'menu'],
  },
];
