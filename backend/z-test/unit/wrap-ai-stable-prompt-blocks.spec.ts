/**
 * [FEAT-20260830-STABLEPROMPT] assembler/blocks half of the stable-prompt gate.
 *
 * The stable layout — the DEFAULT since the 30/08 flip (absent = ON; explicit
 * hook.ai_stable_prompt === false is the per-OA opt-out) — moves the volatile
 * "Today is …" line and the [[[history]]] material OUT of system_instruction
 * and into two NEW contents blocks placed right before `question`, so the
 * instruction becomes byte-stable and Gemini implicit caching can hit.
 * Plan + full impact audit: todo/task/30082026/todo1_30082026_*.md.
 *
 * TARGET cases here were written RED-FIRST against the unchanged tree.
 * PIN cases must be green before AND after — they are the seam's old shape.
 *
 * ⚠️ New request fields are reached through a widening cast on purpose: before
 * the implementation lands the fields do not exist on AiReplyRequest, and a
 * typed literal would fail compile — a red for the WRONG reason. The cast keeps
 * the failure at the assertion, where it names the missing behaviour.
 *
 * revert: delete this file (nothing imports it).
 */
import type { AiReplyRequest } from '@/modules/webhook/ai-reply/ai-reply.provider';

import { filesContaining, tsFilesUnder } from '../lib/source-census';
import { join as joinPath } from 'node:path';

const CENSUS_ROOT = joinPath(__dirname, '../..');
import { assembleReply } from '@/modules/webhook/ai-reply/reply-prompt-assembler';
import type { NeutralBlock } from '@/modules/webhook/ai-reply/reply-neutral';
import { buildDeepSeekBody } from '@/modules/webhook/ai-vendors/deepseek/deepseek-reply.transport';

const HISTORY_TEXT =
  '[start-of-history]\nCustomer: ถาม\nBot: ตอบ\n[end-of-history]';
const TODAY_TEXT = 'Today is วันเสาร์ที่ 30 สิงหาคม 69 12:00:00 (Bangkok Time)';

function baseRequest(over: Record<string, unknown> = {}): AiReplyRequest {
  return {
    question: 'ยอดค้างเท่าไหร่',
    docText: '',
    suggestionText: 'คุณคือแอดมิน',
    profileData: null,
    sendRawJson: false,
    rawJsonRules: '',
    sendSiteRules: false,
    siteRulesGuide: '',
    dictOpts: { tool: null, scope: null },
    ...over,
  };
}

function kindsOf(request: AiReplyRequest): string[] {
  const out = assembleReply({
    request,
    substitutedSuggestion: request.suggestionText,
    fastModeOverride: undefined,
  });
  if (out.kind !== 'call') throw new Error('expected a call verdict');
  return out.call.blocks.map((b) => b.kind);
}

function blocksOf(request: AiReplyRequest): NeutralBlock[] {
  const out = assembleReply({
    request,
    substitutedSuggestion: request.suggestionText,
    fastModeOverride: undefined,
  });
  if (out.kind !== 'call') throw new Error('expected a call verdict');
  return out.call.blocks;
}

describe('[STABLEPROMPT] assembler emits history/today contents blocks', () => {
  // ── TARGET (red before the change) ─────────────────────────────────────────
  it('with both fields set → …, history, today, question — question stays last', () => {
    const req = baseRequest({
      historyBlockText: HISTORY_TEXT,
      timeContextText: TODAY_TEXT,
    });
    const blocks = blocksOf(req);
    expect(blocks.map((b) => b.kind)).toEqual(['history', 'today', 'question']);
    expect(blocks[0]!.text).toBe(HISTORY_TEXT);
    expect(blocks[1]!.text).toBe(TODAY_TEXT);
    expect(blocks[2]!.text).toBe('Question:\nยอดค้างเท่าไหร่');
  });

  it('order sits BETWEEN document and question when every switch is on', () => {
    const req = baseRequest({
      docText: 'เอกสาร',
      sendRawJson: true,
      rawJsonRules: 'กติกา',
      profileData: { p: { role: 'x' } },
      historyBlockText: HISTORY_TEXT,
      timeContextText: TODAY_TEXT,
    });
    const kinds = kindsOf(req);
    expect(kinds.slice(-4)).toEqual([
      'document',
      'history',
      'today',
      'question',
    ]);
  });

  it('a field that is an empty string emits NO block — never an empty part', () => {
    const req = baseRequest({ historyBlockText: '', timeContextText: '' });
    expect(kindsOf(req)).toEqual(['question']);
  });

  it('history alone / today alone each emit exactly their own block', () => {
    expect(kindsOf(baseRequest({ historyBlockText: HISTORY_TEXT }))).toEqual([
      'history',
      'question',
    ]);
    expect(kindsOf(baseRequest({ timeContextText: TODAY_TEXT }))).toEqual([
      'today',
      'question',
    ]);
  });

  // ── PIN (green before AND after) ───────────────────────────────────────────
  it('PIN: absent fields → the six-kind world is byte-identical to today', () => {
    const blocks = blocksOf(baseRequest());
    expect(blocks.map((b) => b.kind)).toEqual(['question']);
    expect(blocks[0]!.text).toBe('Question:\nยอดค้างเท่าไหร่');
  });

  /* [FIX-20260830-STABLEPIN] the hooks-side write path of the emergency
     opt-out was completely unpinned (review-confirmed: deleting the
     ALLOWED_UPDATES entry, either parser call, or the schema default all
     survived the suite). Same source-pin pattern as
     ignore-abandon-assist.spec.ts §'the write path cannot drop it silently'. */
  describe('⭐ the opt-out write path cannot drop or invert silently', () => {
    const fs = require('fs') as typeof import('fs');
    const read = (p: string) => fs.readFileSync(p, 'utf8');
    const hooks = () => read('src/modules/hooks/hooks.service.ts');

    it('⭐ ALLOWED_UPDATES carries it — otherwise edit 200s and drops the opt-out', () => {
      expect(hooks()).toMatch(/'ai_stable_prompt',/);
    });

    it('create AND update both run the parser', () => {
      const calls = hooks().match(/parseAiStablePrompt\(/g) ?? [];
      expect(calls.length).toBe(2);
    });

    it('the update branch keys on hasOwnProperty, so an explicit false lands', () => {
      expect(
        hooks().indexOf("hasOwnProperty.call(updates, 'ai_stable_prompt')"),
      ).toBeGreaterThan(-1);
    });

    it('⭐ schema default stays true — a fresh hook must not persist the opt-out', () => {
      const schema = read('src/modules/hooks/schemas/hook.schema.ts');
      expect(schema).toMatch(
        /@Prop\(\{ type: Boolean, default: true \}\)\s*\n\s*ai_stable_prompt!/,
      );
    });

    it('⭐ polarity: null/"" clears BACK TO ON — never a silent opt-out', () => {
      const W = require('@/modules/hooks/hook-write.helpers') as Record<
        string,
        any
      >;
      expect(W.parseAiStablePrompt(null)).toBe(true);
      expect(W.parseAiStablePrompt('')).toBe(true);
      expect(W.parseAiStablePrompt(undefined)).toBeUndefined();
      expect(W.parseAiStablePrompt(false)).toBe(false);
      expect(W.parseAiStablePrompt('false')).toBe(false);
      expect(W.parseAiStablePrompt(true)).toBe(true);
    });

    it('the webhook reader treats ONLY explicit false as the opt-out', () => {
      /* [PROG-20260905-CENSUSCONV] Looked for across the spine AND the role directories
         the prompt-assembly body may move to. The RULE is what matters — a hook opts out
         only by saying false, so an absent field keeps the stable prompt — and the rule
         is equally true wherever the reader lives. Pinned to the service alone, this
         reddens the day the body moves without changing behaviour, and a spec that
         reddens on safe changes gets deleted, taking the rule's guard with it. It still
         fails if NO file reads it that way. */
      const readers = [
        'src/modules/webhook/webhook.service.ts',
        ...tsFilesUnder(CENSUS_ROOT, 'src/modules/webhook/ai-reply'),
        ...tsFilesUnder(CENSUS_ROOT, 'src/modules/webhook/ai-vendors'),
      ];
      expect(
        filesContaining(
          CENSUS_ROOT,
          readers,
          /hook\?\.\['ai_stable_prompt'\] !== false/,
        ),
      ).not.toEqual([]);
    });
  });

  it('PIN: DeepSeek joins ANY block list in array order — new kinds ride free', () => {
    const call = {
      instruction: 'inst',
      blocks: [
        { kind: 'history', text: HISTORY_TEXT },
        { kind: 'today', text: TODAY_TEXT },
        { kind: 'question', text: 'Question:\nถาม' },
      ] as unknown as NeutralBlock[],
      knobs: { temperature: 0, topP: 0.1, topK: 1 },
      thinkingBudget: null,
      apiKey: 'k',
      modelId: null,
    };
    const body = buildDeepSeekBody(call);
    expect(body.messages[1]!.content).toBe(
      `${HISTORY_TEXT}\n\n${TODAY_TEXT}\n\nQuestion:\nถาม`,
    );
  });
});
