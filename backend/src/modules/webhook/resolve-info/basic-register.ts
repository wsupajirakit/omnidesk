/**
 * `basic register` — did this customer send us a number at all?
 * ===========================================================================
 * Owner, 2026-08-20: "basic ปัจจุบันปรับ ให้เป็น เจอตัวเลข มากกว่า 5 ตัว (ตัดขีด ตัด trim
 * แล้ว) ตรงไหนก็ได้ไม่สน ทำ flow เดิมเลย endFlow = true · ถ้าไม่เจอ endFlow = false".
 *
 * ONE QUESTION, ONE ANSWER: is there a run of MORE THAN FIVE digits anywhere in
 * what they wrote? Yes → `found: true`. No → `found: false`. Nothing else is
 * judged: not which number is a phone, not which is an account, not how many
 * there are, not what order they came in.
 * เจอเลขยาวเกิน 5 หลักที่ไหนก็ได้ = เจอ · ไม่ตัดสินว่าเลขไหนเป็นอะไร.
 *
 * ⚠️ THE CAREFUL VERSION STILL EXISTS. Until 2026-08-20 this file held a much
 * more particular rule — leading zero means phone, dashes join into one number,
 * last match wins, the second candidate is the first one swapped. That rule was
 * built from two real customer messages and it is NOT deleted: it lives whole in
 * `dynamic-register.ts`, registered and tested, waiting for a scenario to select
 * `'dynamic'`. ของเดิมไม่ได้ถูกลบ · ย้ายไป dynamic-register.ts ครบทุกบรรทัด.
 *
 * WHY A BLUNTER RULE IS THE RIGHT ONE HERE. Scenario A reads only `found`, to
 * answer "has this customer replied with their details yet". A customer who
 * types their account number and nothing else has replied; so has one who types
 * their phone. The precise version answered a harder question than the caller
 * was asking, and got it wrong for anyone who sent only one of the two.
 *
 * ⚠️ PURE AND SYNCHRONOUS, like every resolver: the caller ends a live webhook
 * flow on this answer, so it must be ready in the same tick. No model, no
 * network, no database.
 *
 * revert: delete this file and its line in `index.ts`.
 */
import type {
  InfoResolver,
  ResolveInfoInput,
  ResolvedInfo,
  ResolvedPair,
} from './resolve-info.types';

/**
 * How long a run has to be to count. "More than five" — five is not enough.
 *
 * Five is where the owner drew the line, and it is a sensible one: shorter runs
 * are the ordinary noise of a chat message — an amount (`500`), a date (`2026`),
 * a quantity, a bank's branch code — while six or more is somebody deliberately
 * writing an identifier down. ต่ำกว่านี้คือเลขทั่วไปในบทสนทนา ไม่ใช่ข้อมูลที่ตั้งใจส่ง.
 */
export const MIN_DIGITS = 6;

/**
 * Characters that may sit INSIDE one number without breaking it.
 *
 * `235-8-87879-5` is one account, not four numbers — that is a real customer
 * message. A space is deliberately NOT here: two numbers on one line separated
 * by a space would merge into one long run and pass on a length neither of them
 * has. ขีดคั่นได้ · เว้นวรรคไม่ได้ เพราะจะเชื่อมสองเลขเป็นก้อนเดียว.
 */
const INNER_SEPARATORS = '-./';

/** Digits, optionally broken by an inner separator. Never crosses whitespace. */
const DIGIT_RUN = new RegExp(`[0-9]+(?:[${INNER_SEPARATORS}][0-9]+)*`, 'g');

/** An empty answer, so "nothing found" is one object and not four branches. */
const nothing = (): ResolvedInfo => ({
  by: 'basic',
  found: false,
  candidates: [
    { phone: null, account: null },
    { phone: null, account: null },
  ],
});

/**
 * Every run of digits in the text, separators stripped, in the order written.
 *
 * Messages are joined by a newline rather than a space so nothing can merge
 * across two of them — though the pattern above never crosses whitespace either,
 * which is the real guarantee.
 */
export function digitRuns(messages: string[]): string[] {
  const text = (messages ?? []).filter((m) => typeof m === 'string').join('\n');
  return (text.match(DIGIT_RUN) ?? []).map((run) =>
    run.replace(new RegExp(`[${INNER_SEPARATORS}]`, 'g'), ''),
  );
}

export const BASIC_REGISTER: InfoResolver = {
  name: 'basic',
  what: 'answers whether a run of more than five digits appears anywhere in the text',

  resolve(input: ResolveInfoInput): ResolvedInfo {
    const long = digitRuns(input?.messages ?? []).filter(
      (run) => run.length > MIN_DIGITS - 1,
    );
    if (!long.length) return nothing();

    /* ⚠️ `candidates` IS NOT A JUDGEMENT HERE — it is the qualifying runs in the
       order they were written, filling the same two slots every resolver answers
       with. This rule does not know which is a phone and which is an account and
       does not pretend to; `dynamic register` is the one that decides. A consumer
       that needs that distinction must select that resolver, not read meaning
       into these fields. ที่นี่ไม่ตัดสินว่าเลขไหนเป็นอะไร · แค่ใส่ตามลำดับที่เขียนมา. */
    const best: ResolvedPair = {
      phone: long[0] ?? null,
      account: long[1] ?? null,
    };
    const swapped: ResolvedPair = { phone: best.account, account: best.phone };
    return { by: 'basic', found: true, candidates: [best, swapped] };
  },
};
