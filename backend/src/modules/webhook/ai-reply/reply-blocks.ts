/**
 * [FEAT-20260813-WRAPAI-W1] Pure block + instruction assembly for the reply path.
 *
 * Re-homes, WITHOUT changing, three deterministic pieces that live inside
 * `askGemini` today:
 *   · the `contents.parts` order — rawJson → rawJsonRules → siteRules →
 *     siteRulesGuide → Document → Question (`rag-engine.service.ts:1588-1616`)
 *   · the `finalInstruction` join — suggestion + tag-protocol lines,
 *     `.filter(Boolean).join('\n')`, exact line text (`:1527-1537`)
 *   · the block wrappers themselves — IMPORTED from rag-engine, never copied
 *     (`buildRawJsonBlock` / `buildRawJsonRulesBlock` / `buildRawSiteRulesBlock`
 *     / `buildSiteRulesGuideBlock`)
 *
 * ⚠️ EVERYTHING HERE IS PURE. No I/O, no model, no vendor word. The dynamic-tag
 *    substitution (a DB read) happens BEFORE this, in the assembler, which hands
 *    us the already-substituted `instruction`. The W0 pack pins the bytes this
 *    produces.
 *
 * revert: delete this file and reply-neutral.ts; nothing imports them until W1d.
 */
import { TAG_FOUND, TAG_NOT_FOUND } from '@/modules/ai/rag-engine.service';
// eslint-disable-next-line no-restricted-imports -- same fence rag-doc-retrieval uses
import {
  buildRawJsonBlock,
  buildRawJsonRulesBlock,
  buildRawSiteRulesBlock,
  buildSiteRulesGuideBlock,
} from '@/modules/ai/rag-engine.service';

import type { NeutralBlock } from './reply-neutral';

/** Everything the block/instruction build needs — already dyntag-substituted. */
export interface BlockInput {
  /** The customer's message. */
  question: string;
  /** Retrieved document context (may be empty). */
  docText: string;
  /** Training doc with dynamic tags ALREADY substituted by the assembler. */
  substitutedSuggestion: string;
  /** Combined external-API result, or null. */
  profileData: Record<string, unknown> | null;
  sendRawJson: boolean;
  rawJsonRules: string;
  sendSiteRules: boolean;
  siteRulesGuide: string;
  /* [FEAT-20260830-STABLEPROMPT] both OPTIONAL — a caller/spec literal that
     omits them compiles unchanged and emits no new block (that is the per-OA
     opt-out path since the 30/08 default flip, and every pre-flip fixture). */
  historyBlockText?: string;
  timeContextText?: string;
  /* [FEAT-20260902-NOWBLOCK] OPTIONAL for the same reason as the two above: a
     caller or spec literal that omits it compiles unchanged and emits no block,
     which is the default state of this feature. */
  nowBlockText?: string;
}

/**
 * The system instruction — legacy `finalInstruction` (`:1527-1537`), byte for byte.
 * ⚠️ `.filter(Boolean)` drops an empty suggestion but keeps the three protocol
 *    lines; the join is a single '\n'. Both are contract — the W0 snapshot fails
 *    on any drift.
 */
export function buildInstruction(substitutedSuggestion: string): string {
  return [
    substitutedSuggestion,
    '---',
    `- If the answer is found, append "${TAG_FOUND}" at the end.`,
    `- If the answer is NOT found, append "${TAG_NOT_FOUND}" at the end.`,
    `- IMPORTANT: You MUST INCLUDE tags like [[[assist]]] exactly as they appear in the Document in your response.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The ordered context blocks — legacy `contents[0].parts` (`:1588-1616`).
 *
 * ⚠️ ORDER IS LOAD-BEARING and matches legacy exactly. Each entry mirrors one
 *    legacy `...(cond ? [{text}] : [])` spread:
 *      1 raw_json         — `sendRawJson === true` · `buildRawJsonBlock(profile, sendSiteRules===true)`
 *      2 raw_json_rules   — `sendRawJson === true && buildRawJsonRulesBlock(rules)`
 *      3 site_rules       — `sendSiteRules === true && buildRawSiteRulesBlock(profile)`
 *      4 site_rules_guide — `sendSiteRules === true && buildSiteRulesGuideBlock(guide)`
 *      5 document         — `docText ? 'Document:\n'+docText : —`
 *      6 question         — always `'Question:\n'+question`
 *
 * ⚠️ raw_json block passes `sendSiteRules === true` as its 2nd arg so the
 *    site-rules endpoint is filtered out of the dump when site rules are also on
 *    (legacy [FEAT-20260802-RAWSITERULES]) — do NOT drop that argument.
 */
export function buildBlocks(input: BlockInput): NeutralBlock[] {
  const {
    question,
    docText,
    profileData,
    sendRawJson,
    rawJsonRules,
    sendSiteRules,
    siteRulesGuide,
  } = input;
  const blocks: NeutralBlock[] = [];

  // 1 — raw json (with the site-rules-on filter flag)
  if (sendRawJson === true) {
    blocks.push({
      kind: 'raw_json',
      text: buildRawJsonBlock(profileData, sendSiteRules === true),
    });
  }
  // 2 — raw json rules (only when raw json is on AND rules produce a block)
  if (sendRawJson === true) {
    const b = buildRawJsonRulesBlock(rawJsonRules);
    if (b) blocks.push({ kind: 'raw_json_rules', text: b });
  }
  // 3 — site rules block (auto-injected when site rules on AND it produces one)
  if (sendSiteRules === true) {
    const b = buildRawSiteRulesBlock(profileData);
    if (b) blocks.push({ kind: 'site_rules', text: b });
  }
  // 4 — site rules guide (rules that describe the block above, before Document)
  if (sendSiteRules === true) {
    const b = buildSiteRulesGuideBlock(siteRulesGuide);
    if (b) blocks.push({ kind: 'site_rules_guide', text: b });
  }
  // 5 — the retrieved document, when present
  if (docText) {
    blocks.push({ kind: 'document', text: 'Document:\n' + docText });
  }
  /* [FEAT-20260830-STABLEPROMPT] 5.5/5.6 — history then the time line, sitting
     right before the question so the volatile text is as close to the customer
     turn as possible while the instruction above stays byte-stable. Non-empty
     guard is deliberate: an empty part would still join into the DeepSeek user
     string as a stray blank gap. Emitted only when the webhook gate filled the
     fields (stable layout — the default since 30/08; explicit false opts out).
     revert: delete these two pushes + the two BlockInput fields. */
  const { historyBlockText, timeContextText } = input;
  if (typeof historyBlockText === 'string' && historyBlockText.length > 0) {
    blocks.push({ kind: 'history', text: historyBlockText });
  }
  if (typeof timeContextText === 'string' && timeContextText.length > 0) {
    blocks.push({ kind: 'today', text: timeContextText });
  }
  /* [FEAT-20260902-NOWBLOCK] 5.7 — the computed office-hours / holiday answer,
     placed immediately AFTER the raw time line so the model reads the raw value
     and the conclusion drawn from it next to each other, and immediately BEFORE
     the question so the volatile material stays as close to the customer turn as
     possible. Same non-empty guard as its two neighbours: an empty part would
     still join into the DeepSeek user string as a stray blank gap.
     revert: delete this push + the BlockInput field. */
  const { nowBlockText } = input;
  if (typeof nowBlockText === 'string' && nowBlockText.length > 0) {
    blocks.push({ kind: 'now', text: nowBlockText });
  }
  // 6 — the question, always last
  blocks.push({ kind: 'question', text: 'Question:\n' + question });

  return blocks;
}
