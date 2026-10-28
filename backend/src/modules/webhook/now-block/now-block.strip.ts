/**
 * ==== [FIX-20261018-NOWLEAK] A "now" block never reaches a customer ====
 *
 * WHAT: removes a whole now block — fence AND the `key = value` lines inside it — from text
 *       about to be sent. Called first thing by the outbound sweep (`sweepMarkers`,
 *       `hook-reply/reply-tags.util.ts`), so the AI path and the hook-field path both get it.
 *
 * WHY:  seen live 18/10/2026 (loan OA `demo-acme`): the customer asked "ยอดเท่าไหร่" and got a
 *       verbatim `[NOW] … [/NOW]` block before the answer. The system had sent no block that turn;
 *       the OA's Training Document describes one with `[NOW]`, so the model invented it. The sweep
 *       removed only `[START_OF_*]` / `[END_OF_*]` fences (lines kept) and did not know `[NOW]`.
 *       Owner: "ตอนตอบลูกค้า ต้องไม่หลุด now เข้าไป".
 *
 * SHAPES (both fence pairs, case-insensitive):
 *   1. a closed block, fence to fence                       → removed whole
 *   2. an opener the model never closed + the `key = value` lines right after it → removed
 *   3. a stray fence left over (closer, or an opener mid-sentence) → removed
 * Only text INSIDE a now fence is touched: `status = รอโอน` in an ordinary answer survives.
 *
 * revert: delete this file, its export in `./index.ts` and the call in `sweepMarkers`.
 */
import { NOW_BLOCK_END, NOW_BLOCK_START } from './now-block.builder';

/** The system's own fences, and the `[NOW]` pair Training Documents were written with. */
const NOW_FENCES: ReadonlyArray<readonly [string, string]> = [
  [NOW_BLOCK_START, NOW_BLOCK_END],
  ['[NOW]', '[/NOW]'],
];

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One `key = value` line as the block writes it (`datetime_th = …`, `is_holiday = false`). */
const KV_LINE = String.raw`(?:\r?\n[ \t]*[a-z][a-z0-9_]*[ \t]*=[^\n]*)`;

export function stripNowBlocks(text: string): string {
  let out = text;
  for (const [open, close] of NOW_FENCES) {
    const o = escapeRe(open);
    const c = escapeRe(close);
    out = out
      .replace(new RegExp(`${o}[\\s\\S]*?${c}`, 'gi'), '')
      .replace(new RegExp(`${o}[ \\t]*${KV_LINE}*`, 'gi'), '')
      .replace(new RegExp(c, 'gi'), '');
  }
  return out;
}
