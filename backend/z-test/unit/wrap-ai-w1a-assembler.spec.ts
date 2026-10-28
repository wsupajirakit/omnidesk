/**
 * ⚠️ [HOTFIX-20260826-THINK36] snapshot ในไฟล์นี้ถูก **พลิก** เมื่อ 26/08/2026
 * ---------------------------------------------------------------------------
 * `thinkingConfig` เปลี่ยนจาก `{"thinkingBudget":0}` เป็น `{"thinkingLevel":"minimal"}`
 * สำหรับกรณี "ปิดความคิด" บนโมเดล Gemini 3
 *
 * เหตุผล (วัดจริง ไม่ใช่อ่านเอกสาร): `gemini-3.6-flash` ตอบ **400 INVALID_ARGUMENT**
 * เมื่อได้ `thinkingBudget: 0` และ error ไม่มีคำว่า "think" ⇒ ตาข่ายกู้ชีพไม่ติด
 * ⇒ ลูกค้าไม่ได้คำตอบ · 24/29 hook ตั้ง "ปิด" ไว้ ⇒ สลับรุ่นเมื่อไหร่ตายยกชุด
 * ผู้ตัดสิน: เจ้าของ 26/08 — *"สรุปใช้ minimal ทั้งสองนะ"*
 *
 * 🔴 พร้อมกันนี้ `toGeminiBody` ในไฟล์นี้เลิกสำเนาสูตรเอง แล้วหันไปเรียก
 *    `resolveThinkingConfig` ตัวจริง — สำเนาสูตรคือสาเหตุที่ไฟล์นี้แดงตามหลัง
 *    ทั้งที่ของจริงถูกแล้ว (ความจริงชุดที่สอง)
 */
/**
 * [WRAP-AI W1a] ReplyPromptAssembler — proves it produces the SAME neutral call
 * that the current path would send, without any model, DB, or key.
 *
 * The strongest tie to reality is W0's wire snapshots (the real `askGemini` body
 * bytes). Here the assembler's `NeutralReplyCall` is projected to that same
 * Gemini body shape and asserted equal to what W0 recorded — so if the assembler
 * builds a block out of order, drops one, or resolves a knob differently, this
 * fails against the frozen record, not against my opinion.
 *
 * Pure spec: no network, no fetch, no key. `no-ai-outbound` still guards it.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 KNOWN GAP — DO NOT MISTAKE THIS FOR A FINISHED ASSEMBLER (no-bias review)
 * ════════════════════════════════════════════════════════════════════════════
 * W1a re-homes only the PURE part: block order, instruction join, knob/fast-mode
 * resolution. Dynamic-tag substitution (a DB read + regex over the suggestion)
 * is NOT here — the assembler receives `substitutedSuggestion` already done, per
 * the plan's "inject the dyntag step" decision (§W1a).
 *
 * Consequence, stated against interest:
 *   · the byte-equality gate below covers plain/docText/all-blocks/knobs/thinking
 *     — NOT a dyntag-substituted body. W0 recorded a dyntag scenario; W1a does
 *     not yet prove the substituted bytes because it never runs the substitution.
 *   · so "the assembler is correct" here means: GIVEN a substituted suggestion,
 *     it assembles identically. It does NOT yet mean the substitution itself is
 *     wrapped or byte-verified.
 *
 * WHERE THIS IS CLOSED: W1d. When the provider is switched, the DB-backed
 * substitution (still in askGemini today) runs BEFORE the assembler, and the
 * full wire body — dyntag included — must be byte-equal to W0's dyntag snapshot.
 * That gate lives in W1d's spec, not here. อย่าลืม: dyntag ปิดที่ W1d.
 */
import { assembleReply } from '@/modules/webhook/ai-reply/reply-prompt-assembler';
import type { AiReplyRequest } from '@/modules/webhook/ai-reply/ai-reply.provider';
import type { NeutralReplyCall } from '@/modules/webhook/ai-reply/reply-neutral';
import { resolveThinkingConfig } from '../../src/modules/webhook/ai-vendors/gemini/thinking-config';

const savedEnv: Record<string, string | undefined> = {};
const ENV = [
  'MODEL_ID',
  'FAST_MODE',
  'GEMINI_TEMPERATURE',
  'GEMINI_TOP_P',
  'GEMINI_TOP_K',
  'GEMINI_THINKING_BUDGET',
] as const;
beforeAll(() => {
  for (const k of ENV) savedEnv[k] = process.env[k];
  process.env['MODEL_ID'] = 'gemini-3.5-flash';
  process.env['FAST_MODE'] = '0';
  for (const k of [
    'GEMINI_TEMPERATURE',
    'GEMINI_TOP_P',
    'GEMINI_TOP_K',
    'GEMINI_THINKING_BUDGET',
  ])
    delete process.env[k];
});
afterAll(() => {
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

function req(over: Partial<AiReplyRequest> = {}): AiReplyRequest {
  return {
    question: 'ยอดหนี้เท่าไหร่',
    docText: '',
    suggestionText: '',
    profileData: null,
    temperature: 0.4,
    topK: 20,
    topP: 0.4,
    thinkingBudget: null,
    hookId: 'hook-1',
    hookGroupId: 'grp-1',
    sendRawJson: false,
    rawJsonRules: '',
    sendSiteRules: false,
    siteRulesGuide: '',
    dictOpts: { tool: null, scope: null },
    apiKey: 'unit-test-key-not-real',
    ...over,
  };
}

/**
 * Project a neutral call to the exact Gemini body shape askGemini builds — this
 * is the transport's job in W1b, done inline here so W1a can be verified against
 * the W0 wire bytes before the transport exists.
 */
function toGeminiBody(call: NeutralReplyCall): unknown {
  return {
    system_instruction: { parts: [{ text: call.instruction }] },
    contents: [{ parts: call.blocks.map((b) => ({ text: b.text })) }],
    generationConfig: {
      temperature: call.knobs.temperature,
      topP: call.knobs.topP,
      topK: call.knobs.topK,
      /* [HOTFIX-20260826-THINK36] เดิมสำเนาสูตร `{ thinkingBudget: call.thinkingBudget ?? 0 }`
         ไว้ตรงนี้ ⇒ กลายเป็น "ความจริงชุดที่สอง" ทันทีที่ของจริงเปลี่ยน
         (`gemini-3.6-flash` ตอบ 400 กับ budget 0 · เจ้าของ 26/08: "ใช้ minimal ทั้งสอง")
         ⇒ เรียกตัวตัดสินของจริงแทน · ถ้าสูตรเปลี่ยนอีก ไฟล์นี้ตามเองโดยไม่ต้องแก้
         ดูเหตุผลเต็มที่ `src/modules/webhook/ai-vendors/gemini/thinking-config.ts` */
      thinkingConfig: resolveThinkingConfig(call.modelId, call.thinkingBudget),
    },
  };
}

function callOf(over: Partial<AiReplyRequest>): NeutralReplyCall {
  const a = assembleReply({
    request: req(over),
    substitutedSuggestion: (over.suggestionText as string) ?? '',
  });
  if (a.kind !== 'call') throw new Error('expected a call verdict');
  return a.call;
}

describe('[WRAP-AI W1a] the neutral call matches the recorded wire body', () => {
  it('plain question', () => {
    expect(toGeminiBody(callOf({}))).toMatchSnapshot();
  });

  it('with docText → a document block before the question', () => {
    const call = callOf({ docText: 'the document body' });
    const kinds = call.blocks.map((b) => b.kind);
    expect(kinds).toEqual(['document', 'question']);
    expect(toGeminiBody(call)).toMatchSnapshot();
  });

  it('all blocks on together — order is rawJson→rules→siteRules→guide→doc→question', () => {
    const call = callOf({
      docText: 'doc',
      sendRawJson: true,
      rawJsonRules: 'json rules',
      sendSiteRules: true,
      siteRulesGuide: 'site guide',
      profileData: {
        'Path : api/v1/customer': { data: { name: 'x' } },
        SITE_RULES: { role: 'site_rules', data: { min_deposit: 100 } },
      },
    });
    expect(call.blocks.map((b) => b.kind)).toEqual([
      'raw_json',
      'raw_json_rules',
      'site_rules',
      'site_rules_guide',
      'document',
      'question',
    ]);
    expect(toGeminiBody(call)).toMatchSnapshot();
  });

  it('a substituted suggestion lands in the instruction verbatim', () => {
    const call = callOf({ suggestionText: 'สถานะบัญชี เปิดใช้งาน ตอนนี้' });
    expect(call.instruction).toContain('สถานะบัญชี เปิดใช้งาน ตอนนี้');
    expect(call.instruction).toContain('[[[FOUND]]]');
    expect(call.instruction).toContain('[[[NOT_FOUND]]]');
  });

  it('knobs unset (null) fall through to the same defaults', () => {
    const call = callOf({ temperature: null, topK: null, topP: null });
    // askGemini defaults: 0.0 / 0.1 / 1
    expect(call.knobs).toEqual({ temperature: 0.0, topP: 0.1, topK: 1 });
  });

  it('a HOOK knob value wins over the env (layer 1 beats layer 2)', () => {
    // env says one thing, the request (the hook value) says another → hook wins
    process.env['GEMINI_TEMPERATURE'] = '0.99';
    try {
      const call = callOf({ temperature: 0.3, topK: null, topP: null });
      expect(call.knobs.temperature).toBe(0.3); // the hook value, not 0.99
    } finally {
      delete process.env['GEMINI_TEMPERATURE'];
    }
  });

  it('env is used ONLY when the hook did not set the knob (layer 2)', () => {
    process.env['GEMINI_TOP_K'] = '7';
    try {
      const call = callOf({ temperature: null, topK: null, topP: null });
      expect(call.knobs.topK).toBe(7); // hook unset → env fills in
    } finally {
      delete process.env['GEMINI_TOP_K'];
    }
  });

  it('thinkingBudget set → carried on the neutral call', () => {
    expect(callOf({ thinkingBudget: 128 }).thinkingBudget).toBe(128);
  });

  it('thinkingBudget null → 0 (off), matching resolveThinkingBudget', () => {
    expect(callOf({ thinkingBudget: null }).thinkingBudget).toBe(0);
  });

  it('the key rides the call, never the instruction or a block', () => {
    const call = callOf({ apiKey: 'SECRET-XYZ' });
    expect(call.apiKey).toBe('SECRET-XYZ');
    expect(call.instruction).not.toContain('SECRET-XYZ');
    expect(JSON.stringify(call.blocks)).not.toContain('SECRET-XYZ');
  });
});

/**
 * ⭐ THE REAL GATE: the assembler's projected Gemini body must be BYTE-IDENTICAL
 * to what the live `askGemini` recorded in the W0 pack. Not a re-implementation
 * of the assertion — a direct string compare against the frozen record.
 *
 * The W0 snapshot stores `{ url, body }` where body is `JSON.stringify(realBody)`.
 * We project the neutral call the same way and compare strings. Any block
 * reorder, dropped block, changed knob, or altered instruction line diverges the
 * string and fails here — against Google's actual bytes, not against opinion.
 */
describe('[WRAP-AI W1a] byte-equality vs the W0 wire record', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');

  const W0_SNAP = join(
    __dirname,
    '__snapshots__',
    'wrap-ai-w0-before-pack.spec.ts.snap',
  );

  /**
   * Pull the recorded `body` string for a named W0 wire scenario.
   *
   * The .snap stores the record inside a backtick template as a pretty-printed
   * object whose `body` field is itself a JSON string — but jest does NOT escape
   * the inner quotes, so the line reads literally:
   *   "body": "{"system_instruction":{…},"generationConfig":{…"thinkingBudget":N}}",
   * We take everything between `"body": "` and the closing `}}",` (the record
   * always ends its body with `}}` before the trailing `",`). Then unescape the
   * `\\n` / `\\"` the serialiser doubled.
   */
  function w0Body(scenarioTitle: string): string {
    const snap = readFileSync(W0_SNAP, 'utf8');
    const key = `wire snapshots — the frozen matrix (B-W1) ${scenarioTitle} 1`;
    const at = snap.indexOf(key);
    if (at < 0) throw new Error(`W0 scenario not found: ${scenarioTitle}`);
    const seg = snap.slice(at, at + 6000);
    const start = seg.indexOf('"body": "') + '"body": "'.length;
    const end = seg.indexOf('}}",', start) + 2; // include the closing }}
    if (start < 9 || end < 2) throw new Error(`no body for: ${scenarioTitle}`);
    const raw = seg.slice(start, end);
    // the snapshot serialiser doubled the JSON escapes: \\n → \n, \\" → \"
    return raw.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '\\"');
  }

  /** Project a neutral call to the exact JSON string the transport will send. */
  function projectBody(over: Partial<AiReplyRequest>): string {
    return JSON.stringify(toGeminiBody(callOf(over)));
  }

  it('plain question — identical bytes', () => {
    expect(projectBody({})).toBe(w0Body('plain question'));
  });

  it('with docText — identical bytes', () => {
    expect(projectBody({ docText: 'the document body' })).toBe(
      w0Body('with docText'),
    );
  });

  it('all blocks on together — identical bytes (proves order + content)', () => {
    const over = {
      docText: 'doc',
      sendRawJson: true,
      rawJsonRules: 'json rules',
      sendSiteRules: true,
      siteRulesGuide: 'site guide',
      profileData: {
        'Path : api/v1/customer': { data: { name: 'x' } },
        SITE_RULES: { role: 'site_rules', data: { min_deposit: 100 } },
      },
    };
    expect(projectBody(over)).toBe(
      w0Body('all blocks on together (proves block ORDER)'),
    );
  });

  it('knobs unset — identical bytes', () => {
    expect(projectBody({ temperature: null, topK: null, topP: null })).toBe(
      w0Body('knobs unset (null) fall through to defaults'),
    );
  });

  it('thinkingBudget set — identical bytes', () => {
    expect(projectBody({ thinkingBudget: 128 })).toBe(
      w0Body('thinkingBudget set → thinkingConfig present in the body'),
    );
  });
});

describe('[WRAP-AI W1a] fast-mode 2 → skip verdict, no call built', () => {
  it('returns a ready AiReplyResponse and no NeutralReplyCall', () => {
    const a = assembleReply({
      request: req({ docText: 'some doc' }),
      substitutedSuggestion: '',
      fastModeOverride: 2,
    });
    expect(a.kind).toBe('skip');
    if (a.kind !== 'skip') return;
    // text = docText, noData false, NO tagStatus surprises (mapped to null)
    expect(a.response).toEqual({
      text: 'some doc',
      noData: false,
      tagStatus: null,
      http_status: null,
      error_message: null,
      response_data: undefined,
    });
  });

  it('fast-mode with empty doc → fallback text + noData true', () => {
    const a = assembleReply({
      request: req({ docText: '' }),
      substitutedSuggestion: '',
      fastModeOverride: 2,
    });
    if (a.kind !== 'skip') throw new Error('expected skip');
    expect(a.response.noData).toBe(true);
    expect(a.response.text).toBe('ไม่พบข้อมูลที่เกี่ยวข้องในเอกสาร');
  });
});
