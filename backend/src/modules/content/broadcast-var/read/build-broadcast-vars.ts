/**
 * [FEAT-20260822-BCASTVARMAP] The whole variable map for one recipient.
 * ===========================================================================
 * A pure decision. Every row it needs is handed in.
 *
 * Assembles the four tag families the plan settled on (§V.2), in one place, so
 * a caller never has to remember which family comes from where:
 *
 *   profile.*      ← members.raw_profile_data          (per recipient)
 *   site_rules.*   ← hooks.raw_site_rules_data         (per OA — same for all)
 *   member.*       ← columns on the member row itself  (per recipient)
 *   hook_*         ← columns on the hook row           (per OA)
 *
 * ⚠️ ORDER MATTERS AND IS NOT ALPHABETICAL. Later families overwrite earlier
 *    ones on a key clash, and the un-prefixed profile aliases are written first
 *    so an explicit `member.*` can never be shadowed by them.
 *
 * ⚠️ THE `N/A` PASS RUNS HERE, at the very end (`return normalizeEmpties(out)`).
 *    It did NOT, and this header used to say so — for a while the comment said
 *    "not applied here" while line ~131 applied it, which is how a later reader
 *    deletes a fix and the file thanks them for it. An audit caught the
 *    contradiction. คอมเมนต์ที่ขัดกับโค้ด อันตรายกว่าไม่มีคอมเมนต์.
 *
 *    Each family is still built in UPSTREAM shape first — that is what the
 *    drift specs compare — and only the finished map is normalised. Two steps,
 *    in this order, in this file. สร้างให้เหมือนต้นทางก่อน แล้วค่อยแปลงตอนท้าย.
 */
import { normalizeEmpties } from '../checks/empty-value';
import {
  buildFlexProfileVarMap,
  buildSiteRulesVarMap,
} from '../format/build-var-map';
import { type TranslateFn } from '../format/value-format';
import { readProfileObject } from './raw-blob.reader';

/** The member columns a card may address as `{{member.*}}`. */
export const MEMBER_COLUMNS = [
  'display_name',
  'full_name',
  'nickname',
  'phone_number',
] as const;

/** The hook columns the context family reads, and the tag each becomes. */
export const HOOK_CONTEXT_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['domain_name', 'hook_domain'],
  ['company_name', 'hook_name'],
  ['description', 'hook_detail'],
];

export interface BroadcastVarInput {
  /** `members.raw_profile_data` for THIS recipient. */
  readonly storedProfile: unknown;
  /** `hooks.raw_site_rules_data` for the OA being sent to. */
  readonly storedSiteRules: unknown;
  /** The member row — only the columns in `MEMBER_COLUMNS` are read. */
  readonly member: Record<string, unknown> | null;
  /** The hook row — only the columns in `HOOK_CONTEXT_COLUMNS` are read. */
  readonly hook: Record<string, unknown> | null;
  readonly translate: TranslateFn;
  /**
   * [FEAT-20260903-BCASTOASCOPE] The dictionary scope, when the CALLER knows it
   * and this function cannot work it out.
   *
   * Omit it and nothing changes: the scope is still read from the profile blob
   * exactly as before, which is what every multicast caller wants. It is passed
   * only by the OA path, where there is no profile to read one from and the
   * hook's own web code is the right answer (`site-rules-scope.ts`).
   * ไม่ส่งมา = พฤติกรรมเดิมทุกอย่าง.
   */
  readonly scope?: string;
}

/**
 * Build every variable a broadcast card can use.
 *
 * Never throws: a family that cannot be built contributes nothing and the rest
 * still render. One bad blob must not cost a campaign its card.
 */
export function buildBroadcastVars(
  input: BroadcastVarInput,
): Record<string, string> {
  const out: Record<string, string> = {};

  const profile = readProfileObject(input.storedProfile);
  const webCode = profile?.['web_code'];
  /**
   * [FEAT-20260903-BCASTOASCOPE] The profile's own web code still WINS.
   *
   * On a multicast a recipient row is in hand and their `web_code` is the truth
   * about which site's wording to use; `input.scope` is the fallback for the
   * broadcast path, which has no recipient at all and therefore always reached
   * here with `null` — translating every site-specific word into nothing.
   * ⚠️ ORDER MATTERS: putting the caller's value first would let an OA-level
   *    scope override a real person's on a multicast. โปรไฟล์มาก่อนเสมอ.
   */
  const opts = {
    tool: null,
    scope: typeof webCode === 'string' ? webCode : (input.scope ?? null),
  };

  // profile.* — and the un-prefixed aliases upstream also emits.
  try {
    const map = buildFlexProfileVarMap(profile, opts, input.translate);
    for (const [k, v] of Object.entries(map)) {
      out[k] = v;
      out[`profile.${k}`] = v;
    }
  } catch {
    // A broken blob costs this family, not the card.
  }

  // site_rules.* — always prefixed, exactly as upstream requires.
  try {
    const map = buildSiteRulesVarMap(
      input.storedSiteRules,
      opts,
      input.translate,
    );
    for (const [k, v] of Object.entries(map)) {
      out[`site_rules.${k}`] = v;
    }
  } catch {
    // Same reasoning.
  }

  // member.* — plain columns, no spec involved.
  for (const col of MEMBER_COLUMNS) {
    out[`member.${col}`] = textOf(input.member?.[col]);
  }
  out['member.name'] = bestName(input.member);

  // hook_* — the context family, read straight off the hook row.
  for (const [col, tag] of HOOK_CONTEXT_COLUMNS) {
    out[tag] = textOf(input.hook?.[col]);
  }

  /**
   * 🔴 THE `N/A` RULE, APPLIED. This line was missing and the rule was only
   * half true.
   *
   * The owner's instruction was that a value we do not have becomes `N/A`
   * ("ถ้ามันไม่มีค่า หรือ หาไม่เจอ" — §V). `isEmptyForBroadcast` knew that `''`
   * and `-` both mean "missing", and NOTHING CALLED IT. The empty string was
   * saved by accident — `substitute.ts` rejects `''` and falls back on its own —
   * but the upstream formatter's own marker for "no value" is `-`, and a dash
   * is a perfectly good string, so it sailed through and would have been
   * substituted into a customer's card as a literal `-`.
   *
   * Applied HERE, at the boundary where our map is finished, rather than in
   * `substitute.ts`: the clone's formatter must keep answering exactly what
   * upstream answers (that is what the drift specs pin), so the normalisation
   * belongs after the copy, not inside it.
   * ค่าที่แปลว่า "ไม่มี" ต้องกลายเป็น N/A ก่อนออกจากที่นี่ ไม่ใช่หวังให้ปลายทางจับได้เอง.
   */
  return normalizeEmpties(out);
}

/**
 * "The best name we have", in the order the ticket console already settled on
 * (full name → phone → LINE display name → the word for a member).
 *
 * ⚠️ The fallback ORDER is the product decision, not the code's: an admin who
 * writes `{{member.display_name}}` gets exactly that column and an empty result
 * if it is blank. This tag is the one that promises to always say something.
 */
function bestName(member: Record<string, unknown> | null): string {
  const full = textOf(member?.['full_name']);
  if (full) return full;
  const phone = textOf(member?.['phone_number']);
  if (phone) return phone;
  const display = textOf(member?.['display_name']);
  if (display) return display;
  return 'member';
}

/** Only primitives become text — an object here would ship `[object Object]`. */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return '';
}
