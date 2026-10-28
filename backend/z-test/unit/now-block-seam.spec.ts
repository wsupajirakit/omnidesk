/**
 * [FEAT-20260902-NOWBLOCK] The seam — does the block travel, and does OFF really
 * change nothing?
 *
 * Deliberately shaped after `wrap-ai-stable-prompt-blocks.spec.ts`, which pins the
 * same seam for the `history` and `today` blocks. Same harness, same TARGET/PIN
 * split: TARGET cases describe the new behaviour, PIN cases must be green before
 * AND after because they are the old shape.
 *
 * ⚠️ WHY DEEPSEEK IS TESTED SEPARATELY AND EXPLICITLY.
 * Gemini emits one part per block, so a new kind is visible as a new part. DeepSeek
 * FLATTENS the whole block list into one string joined by '\n\n', and its own pin in
 * the sibling suite is titled "DeepSeek joins ANY block list in array order — new
 * kinds ride free". That means a new block can never make that suite red: it just
 * silently ships different bytes to that vendor. Proving OFF on one vendor proves
 * nothing about the other, so both are asserted here by hand.
 * พิสูจน์ OFF ทีละ vendor · ตัวที่กลืนบล็อกเงียบ ๆ คือตัวที่เทสเดิมจับไม่ได้
 *
 * revert: delete this file with the `now-block/` folder.
 */
import type { AiReplyRequest } from '@/modules/webhook/ai-reply/ai-reply.provider';
import type { NeutralBlock } from '@/modules/webhook/ai-reply/reply-neutral';
import { assembleReply } from '@/modules/webhook/ai-reply/reply-prompt-assembler';
import { buildDeepSeekBody } from '@/modules/webhook/ai-vendors/deepseek/deepseek-reply.transport';

const TODAY_TEXT = 'Today is วันพุธที่ 02 กันยายน 69 22:53:11 (Bangkok Time)';
const HISTORY_TEXT =
  '[start-of-history]\nCustomer: ถาม\nBot: ตอบ\n[end-of-history]';
const NOW_TEXT = [
  '[START_OF_NOW]',
  'datetime_th = วันพุธที่ 02 กันยายน 69 22:53:11',
  'date_iso = 2026-09-02',
  'time_24h = 22:53',
  'office_hours = 10:00-19:00 ทุกวัน',
  'is_holiday = false',
  'holiday_name = -',
  'status = AFTER_CLOSE',
  'append_time_suffix = YES',
  '[END_OF_NOW]',
].join('\n');

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

function blocksOf(request: AiReplyRequest): NeutralBlock[] {
  const out = assembleReply({
    request,
    substitutedSuggestion: request.suggestionText,
    fastModeOverride: undefined,
  });
  if (out.kind !== 'call') throw new Error('expected a call verdict');
  return out.call.blocks;
}

const kindsOf = (request: AiReplyRequest): string[] =>
  blocksOf(request).map((b) => b.kind);

describe('[NOWBLOCK] OFF changes nothing — the whole promise of the switch', () => {
  /* These are PIN cases: they were green before this feature existed and must
     stay green. If one of them ever goes red, the default path has moved and the
     "off is byte-identical" claim is no longer true. */
  it('PIN: the field absent → no block, and the list is exactly as before', () => {
    expect(kindsOf(baseRequest())).toEqual(['question']);
  });

  it('PIN: absent alongside the stable-prompt blocks → history, today, question', () => {
    const kinds = kindsOf(
      baseRequest({
        historyBlockText: HISTORY_TEXT,
        timeContextText: TODAY_TEXT,
      }),
    );
    expect(kinds).toEqual(['history', 'today', 'question']);
  });

  /* An empty string must behave exactly like an absent field. Without this guard
     an "" would still be pushed and would join into the DeepSeek string as a
     stray blank gap — a wire-byte change that no vendor would report. */
  it('PIN: an empty string emits no block, never an empty part', () => {
    expect(kindsOf(baseRequest({ nowBlockText: '' }))).toEqual(['question']);
  });

  it('PIN: the DeepSeek string is untouched when the field is absent', () => {
    const call = {
      instruction: 'คุณคือแอดมิน',
      blocks: blocksOf(
        baseRequest({
          historyBlockText: HISTORY_TEXT,
          timeContextText: TODAY_TEXT,
        }),
      ),
      knobs: { temperature: null, topP: null, topK: null },
      thinkingBudget: null,
      apiKey: 'k',
      modelId: null,
    };
    const body = buildDeepSeekBody(call as never);
    expect(body.messages[1]!.content).toBe(
      `${HISTORY_TEXT}\n\n${TODAY_TEXT}\n\nQuestion:\nยอดค้างเท่าไหร่`,
    );
  });
});

describe('[NOWBLOCK] ON — the block travels, and lands where it was designed to', () => {
  it('appears as its own kind', () => {
    expect(kindsOf(baseRequest({ nowBlockText: NOW_TEXT }))).toEqual([
      'now',
      'question',
    ]);
  });

  /* Position is the design: immediately after the raw time line, so the model
     reads the value and the conclusion drawn from it side by side, and
     immediately before the question, so the volatile material stays closest to
     the customer turn while the instruction above stays byte-stable. */
  it('sits after `today` and before `question`', () => {
    const kinds = kindsOf(
      baseRequest({
        historyBlockText: HISTORY_TEXT,
        timeContextText: TODAY_TEXT,
        nowBlockText: NOW_TEXT,
      }),
    );
    expect(kinds).toEqual(['history', 'today', 'now', 'question']);
  });

  it('keeps the question last even with every switch on', () => {
    const kinds = kindsOf(
      baseRequest({
        docText: 'เอกสาร',
        sendRawJson: true,
        rawJsonRules: 'กติกา',
        profileData: { p: { role: 'x' } },
        historyBlockText: HISTORY_TEXT,
        timeContextText: TODAY_TEXT,
        nowBlockText: NOW_TEXT,
      }),
    );
    expect(kinds.slice(-5)).toEqual([
      'document',
      'history',
      'today',
      'now',
      'question',
    ]);
    expect(kinds[kinds.length - 1]).toBe('question');
  });

  it('carries the text through byte for byte — the assembler never rewrites it', () => {
    const blocks = blocksOf(baseRequest({ nowBlockText: NOW_TEXT }));
    expect(blocks[0]!.text).toBe(NOW_TEXT);
  });

  /* The vendor whose own suite can never report this. Asserting the exact joined
     string is the only way a change to DeepSeek's wire bytes becomes visible. */
  it('DeepSeek joins it into the user string in array order', () => {
    const call = {
      instruction: 'คุณคือแอดมิน',
      blocks: blocksOf(
        baseRequest({
          historyBlockText: HISTORY_TEXT,
          timeContextText: TODAY_TEXT,
          nowBlockText: NOW_TEXT,
        }),
      ),
      knobs: { temperature: null, topP: null, topK: null },
      thinkingBudget: null,
      apiKey: 'k',
      modelId: null,
    };
    const body = buildDeepSeekBody(call as never);
    expect(body.messages[1]!.content).toBe(
      `${HISTORY_TEXT}\n\n${TODAY_TEXT}\n\n${NOW_TEXT}\n\nQuestion:\nยอดค้างเท่าไหร่`,
    );
  });

  /* The instruction is the half that must stay byte-stable for the model-side
     cache to hit. The block rides in `contents`, so adding it must not touch the
     instruction at all — that is the entire reason the 30/08 layout exists. */
  it('the system instruction is unchanged whether the block is on or off', () => {
    const off = assembleReply({
      request: baseRequest(),
      substitutedSuggestion: 'คุณคือแอดมิน',
      fastModeOverride: undefined,
    });
    const on = assembleReply({
      request: baseRequest({ nowBlockText: NOW_TEXT }),
      substitutedSuggestion: 'คุณคือแอดมิน',
      fastModeOverride: undefined,
    });
    if (off.kind !== 'call' || on.kind !== 'call')
      throw new Error('expected calls');
    expect(on.call.instruction).toBe(off.call.instruction);
  });
});
