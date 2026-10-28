/**
 * `dynamic register` — pull a phone number and a bank account out of plain text.
 * ===========================================================================
 * Owner: "ให้หาชุดตัวเลข ที่ติดกัน · 10 ตัว นั้นคือเบอร์โทร · ถ้าขึ้นต้นด้วย 0 assume ว่าคือเบอร์
 * ไว้ก่อน แล้วค่อย priority อย่างอื่นทำเป็นเงื่อนไขแบบยืดหยุ่นไว้".
 *
 * ⚠️ LENGTH ALONE CANNOT DECIDE — this is the whole reason the leading-zero rule
 * exists. Both real messages the owner supplied hold TWO ten-digit runs:
 *
 *     อธิพัชร์  ธันยบูรณ์นนทกร        ระกา รักษาน้อย
 *     1571226037  กสิกร              235-8-87879-5      → 2358878795
 *     0915550012                      กสิกร
 *                                     0635550013
 *
 * In both, the account and the phone are the SAME length and the phone is last.
 * A rule built on "10 digits = phone" would have picked the account in message
 * one. Only `0` at the front separates them. เลข 10 หลักเท่ากันทั้งคู่ ·
 * ตัวที่ขึ้นต้น 0 เท่านั้นที่บอกได้ว่าอันไหนเบอร์.
 *
 * ⚠️ PURE AND SYNCHRONOUS. No model, no network, no database — the caller ends a
 * live webhook flow on this answer, so it must be ready in the same tick.
 *
 * ⚠️⚠️ PARKED — REGISTERED BUT NOT SELECTED BY ANYTHING ⚠️⚠️
 * ===========================================================================
 * [FEAT-20260820-DYNAMICPARK] This IS the rule `basic register` used until
 * 2026-08-20, moved here whole. Not a rewrite and not a draft: every line — the
 * leading-zero priority, the dash joining, the last-match-wins ordering, the
 * duplicate removal, the swapped second candidate — is the code that ran in
 * production, with only the name changed.
 *
 * WHY IT MOVED. The owner replaced the live rule with a much blunter one: a run
 * of more than five digits ANYWHERE means "they sent something", full stop. This
 * careful version is kept because the knowledge in it is expensive and was paid
 * for with real customer messages — see the two pinned at the top of the header.
 * ย้ายมาทั้งดุ้น ไม่ได้เขียนใหม่ · กฎที่ live ใช้จริงมาก่อน.
 *
 * NOTHING CALLS IT. `INFO_RESOLVERS` lists it so it stays compiled, typed and
 * tested, but no scenario names `'dynamic'`. Selecting it is one word in
 * `scenarios/scenario-a.ts` (`resolver: 'dynamic'`).
 *
 * revert: delete this file and its line in `index.ts`. Nothing else refers to it.
 */
import type {
  InfoResolver,
  ResolveInfoInput,
  ResolvedInfo,
  ResolvedPair,
} from './resolve-info.types';

/* ── The tunable rules. Every judgement this file makes reads one of these, so
      changing what counts as a phone or an account is an edit HERE and nowhere
      in the logic below. แก้กติกาได้ที่นี่ที่เดียว ไม่ต้องแตะตรรกะ. ───────────── */

/** How many digits a Thai mobile number has. */
export const PHONE_LENGTH = 10;

/** What a Thai mobile number starts with — the owner's strongest rule. */
export const PHONE_PREFIX = '0';

/** Plausible bank-account length once separators are stripped. */
export const ACCOUNT_MIN_LENGTH = 9;
export const ACCOUNT_MAX_LENGTH = 15;

/**
 * Characters that may sit INSIDE one number without breaking it.
 *
 * `235-8-87879-5` is one account, not four numbers — the owner's second message
 * proves that. A space is deliberately NOT here: two numbers on one line
 * separated by a space would merge into a 20-digit run that is neither.
 * ขีดคั่นได้ · เว้นวรรคไม่ได้ เพราะจะเชื่อมสองเลขติดกัน.
 */
const INNER_SEPARATORS = '-./';

/** Digits, optionally broken by an inner separator. Never crosses a space. */
const DIGIT_RUN = new RegExp(`[0-9]+(?:[${INNER_SEPARATORS}][0-9]+)*`, 'g');

/** An empty answer, so "nothing found" is one object and not four branches. */
const nothing = (): ResolvedInfo => ({
  by: 'dynamic',
  found: false,
  candidates: [
    { phone: null, account: null },
    { phone: null, account: null },
  ],
});

/**
 * Every run of digits in the text, separators stripped, in the order written.
 *
 * Duplicates are kept: a customer who types their phone twice has typed two
 * runs, and deciding that is the caller's business, not this function's.
 */
function digitRuns(messages: string[]): string[] {
  const text = (messages ?? []).filter((m) => typeof m === 'string').join('\n');
  return (text.match(DIGIT_RUN) ?? []).map((run) =>
    run.replace(new RegExp(`[${INNER_SEPARATORS}]`, 'g'), ''),
  );
}

/**
 * The ordered rules that pick the phone. FIRST MATCH WINS, and the order IS the
 * priority the owner asked to keep flexible — adding a rule is a line in this
 * array, not a new branch somewhere in the logic.
 * เพิ่มกติกา = เพิ่มบรรทัดในลิสต์ ไม่ต้องแก้ตรรกะ.
 */
const PHONE_RULES: ReadonlyArray<{
  why: string;
  match: (run: string) => boolean;
}> = [
  {
    // the owner's rule, and the only one that separates the two real messages
    why: 'starts with 0 and is exactly a mobile length',
    match: (r) => r.startsWith(PHONE_PREFIX) && r.length === PHONE_LENGTH,
  },
  {
    // a leading zero still says "phone" even at an unexpected length — a typo
    // in the digits should not turn a phone into an account
    why: 'starts with 0',
    match: (r) => r.startsWith(PHONE_PREFIX),
  },
  {
    // nothing led with a zero; length is all that is left to go on
    why: 'is exactly a mobile length',
    match: (r) => r.length === PHONE_LENGTH,
  },
];

/** Could this run be an account at all? Length is the only cheap test there is. */
const couldBeAccount = (run: string): boolean =>
  run.length >= ACCOUNT_MIN_LENGTH && run.length <= ACCOUNT_MAX_LENGTH;

export const DYNAMIC_REGISTER: InfoResolver = {
  name: 'dynamic',
  what: 'reads digit runs out of text — leading 0 is the phone, the other is the account',

  resolve(input: ResolveInfoInput): ResolvedInfo {
    const runs = digitRuns(input?.messages ?? []);

    /* Pick the phone by the first rule that matches anything. A rule that
       matches several runs takes the LAST of them — in BOTH real messages the
       customer wrote their phone at the bottom, under the account, and that is
       the only evidence there is about ordering.
       เบอร์อยู่ล่างสุดทั้งสองข้อความจริง ⇒ เจอหลายตัวเอาตัวท้าย. */
    let phone: string | null = null;
    for (const rule of PHONE_RULES) {
      const hits = runs.filter(rule.match);
      if (hits.length) {
        phone = hits[hits.length - 1]!;
        break;
      }
    }
    if (!phone) return nothing();

    /* The account is whatever is left. Prefer a run of a plausible account
       length; if none qualifies, take the first leftover rather than answering
       "nothing" — the swapped candidate below is what covers a wrong pick.
       เลือกไม่ชัวร์ก็ยังตอบ · ช่องสลับคือตาข่าย.

       ⚠️ EVERY copy of the phone is removed, not just the one that was picked.
       A customer who writes their number twice produces two identical runs, and
       removing only one leaves the other to be chosen as the "account" — which
       answered found=true with the SAME number in both slots. That is worse than
       finding nothing, because it looks complete. Found by mutation
       (`lastIndexOf` → `indexOf` changed the answer, which meant neither was
       right) and reproduced against the real algorithm before this line changed.
       ตัดทุกตัวที่ซ้ำกับเบอร์ · ไม่ใช่ตัดตัวเดียว. */
    const leftovers = runs.filter((run) => run !== phone);
    const account = leftovers.find(couldBeAccount) ?? leftovers[0] ?? null;
    /* ⚠️ THE ONE GUARD THAT DECIDES `found`. One number cannot be both: if the
       phone consumed the only run there is nothing left to be an account, and
       the owner's rule is that anything short of both is a miss.
       A `runs.length < 2` check used to sit above as well — it covered exactly
       this case, which made neither line killable by a test. Removed on purpose;
       this is the one that carries the meaning.
       เหลือด่านเดียวที่ตัดสิน · ด่านซ้ำถูกถอดเพราะเทสฆ่าไม่ได้ทั้งคู่. */
    if (!account) return nothing();

    const best: ResolvedPair = { phone, account };
    // [1] is [0] with the two values traded — the exact mistake [0] could make
    const swapped: ResolvedPair = { phone: account, account: phone };

    return { by: 'dynamic', found: true, candidates: [best, swapped] };
  },
};
