/**
 * [TEST-20260813-P2-DSREPLY] DeepSeek reply transport — the contract suite.
 *
 * ⚠️ NO NETWORK. `axios.post` is spied and REFUSES by default; each test arms
 * one canned response. The `no-ai-outbound` setup file blocks the DeepSeek host
 * as a second layer (added in T01).
 *
 * ⚠️ This is NOT a byte-equality suite. Gemini and DeepSeek speak different
 * JSON, so the standard is the CONTRACT (wrap-ai-design §2.3): the instruction
 * reaches the vendor's system slot, every block's text survives in order, knobs
 * map or are ignored-with-a-log, the key never leaves the header, and the result
 * shape is exactly what the SHARED interpreter already understands.
 */

import axios from 'axios';

import { AI_HTTP_TIMEOUT_MS } from '@/modules/ai-vendor';

import { Logger } from '@nestjs/common';

import {
  DeepSeekReplyTransport,
  DEEPSEEK_CHAT_URL,
  buildDeepSeekBody,
  DEEPSEEK_FAMILY_MODEL,
  readDeepSeekText,
  resetIgnoredKnobNotice,
  resolveDeepSeekModelId,
} from '@/modules/webhook/ai-vendors/deepseek/deepseek-reply.transport';
import type { NeutralReplyCall } from '@/modules/webhook/ai-reply/reply-neutral';
import { interpretReply } from '@/modules/webhook/ai-reply/reply-interpreter';

const callFor = (over: Partial<NeutralReplyCall> = {}): NeutralReplyCall => ({
  instruction: 'SYSTEM-INSTRUCTION',
  blocks: [
    { kind: 'raw_json', text: 'BLOCK-A' },
    { kind: 'document', text: 'BLOCK-B' },
    { kind: 'question', text: 'BLOCK-C' },
  ],
  knobs: { temperature: 0.4, topP: 0.9, topK: 20 },
  thinkingBudget: null,
  apiKey: 'DS-KEY-123',
  modelId: null, // hook chose no model ⇒ the transport applies its family default
  ...over,
});

describe('[P2 DEEPSEEK REPLY] request mapping', () => {
  let post: jest.SpyInstance;

  beforeEach(() => {
    delete process.env['DEEPSEEK_MODEL_ID'];
    post = jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('no test armed this call'));
  });
  afterEach(() => post.mockRestore());

  it('puts the instruction in the system message and the blocks in one user message, in order', () => {
    const body = buildDeepSeekBody(callFor());
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: 'SYSTEM-INSTRUCTION',
    });
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: 'BLOCK-A\n\nBLOCK-B\n\nBLOCK-C',
    });
  });

  it('maps temperature and top_p, and never invents a top_k field', () => {
    const body = buildDeepSeekBody(callFor());
    expect(body.temperature).toBe(0.4);
    expect(body.top_p).toBe(0.9);
    expect(body as unknown as Record<string, unknown>).not.toHaveProperty(
      'top_k',
    );
    expect(body as unknown as Record<string, unknown>).not.toHaveProperty(
      'thinkingConfig',
    );
  });

  it('⭐ HONOURS the per-hook model (this used to be deliberately ignored)', () => {
    // Before P2-A the assembler resolved MODEL_ID with a Gemini default, so
    // passing it on would have asked DeepSeek for a Gemini model. The model is
    // per hook now, so the hook's choice must reach the wire.
    expect(
      buildDeepSeekBody(callFor({ modelId: 'deepseek-reasoner' })).model,
    ).toBe('deepseek-reasoner');
    expect(resolveDeepSeekModelId('deepseek-reasoner')).toBe(
      'deepseek-reasoner',
    );
  });

  it("falls back to the vendor's family default when the hook chose none", () => {
    expect(buildDeepSeekBody(callFor({ modelId: null })).model).toBe(
      DEEPSEEK_FAMILY_MODEL,
    );
    expect(resolveDeepSeekModelId(null)).toBe(DEEPSEEK_FAMILY_MODEL);
    expect(resolveDeepSeekModelId('   ')).toBe(DEEPSEEK_FAMILY_MODEL);
  });

  it('⭐ has NO env rung — a server-level model would be the override the rule removes', () => {
    try {
      process.env['DEEPSEEK_MODEL_ID'] = 'deepseek-from-env';
      expect(buildDeepSeekBody(callFor({ modelId: null })).model).toBe(
        DEEPSEEK_FAMILY_MODEL,
      );
    } finally {
      delete process.env['DEEPSEEK_MODEL_ID'];
    }
  });

  it('sends the key as a Bearer header — never in the URL', async () => {
    post.mockResolvedValueOnce({
      status: 200,
      data: { choices: [{ message: { content: 'hi' } }] },
    });
    await new DeepSeekReplyTransport().send(callFor());
    const [url, , config] = post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string>; timeout: number },
    ];
    expect(url).toBe(DEEPSEEK_CHAT_URL);
    expect(url).not.toContain('DS-KEY-123');
    expect(config.headers['Authorization']).toBe('Bearer DS-KEY-123');
    /* [FEAT-20260908-AITIMEOUT] the stall ceiling moved 30s -> 45s for BOTH
       vendors on the owner's decision. Read from the shared constant so this
       lane can never drift to a private number — which is the state the door
       was built to end (DEEPSEEK_HTTP_TIMEOUT_MS used to be declared three
       times, equal only by luck). */
    expect(config.timeout).toBe(AI_HTTP_TIMEOUT_MS);
    expect(AI_HTTP_TIMEOUT_MS).toBe(45_000);
  });
});

describe('[P2 DEEPSEEK REPLY] response reading', () => {
  it('reads choices[0].message.content', () => {
    expect(
      readDeepSeekText({ choices: [{ message: { content: 'ANSWER' } }] }),
    ).toBe('ANSWER');
  });

  it('treats no choices, empty text and a content_filter stop as "no answer"', () => {
    expect(readDeepSeekText({ choices: [] })).toBeUndefined();
    expect(readDeepSeekText({})).toBeUndefined();
    expect(
      readDeepSeekText({ choices: [{ message: { content: '' } }] }),
    ).toBeUndefined();
    expect(
      readDeepSeekText({
        choices: [
          { message: { content: 'partial' }, finish_reason: 'content_filter' },
        ],
      }),
    ).toBeUndefined();
  });
});

describe('[P2 DEEPSEEK REPLY] result contract the shared interpreter needs', () => {
  let post: jest.SpyInstance;
  beforeEach(() => {
    post = jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('no test armed this call'));
  });
  afterEach(() => post.mockRestore());

  it('success → rawText set, errorMessage null, and the interpreter returns the text', async () => {
    post.mockResolvedValueOnce({
      status: 200,
      data: { choices: [{ message: { content: 'สวัสดีค่ะ' } }] },
    });
    const res = await new DeepSeekReplyTransport().send(callFor());
    expect(res).toMatchObject({
      rawText: 'สวัสดีค่ะ',
      httpStatus: 200,
      errorMessage: null,
    });
    expect(interpretReply(res).text).toBe('สวัสดีค่ะ');
    expect(interpretReply(res).error_message).toBeNull();
  });

  it('vendor HTTP error → the error PAIR (rawText undefined + errorMessage set) so the interpreter takes the legacy error path', async () => {
    post.mockRejectedValueOnce({
      response: { status: 429, data: { error: 'rate limited' } },
    });
    const res = await new DeepSeekReplyTransport().send(callFor());
    expect(res.rawText).toBeUndefined();
    expect(res.httpStatus).toBe(429);
    expect(res.errorMessage).toContain('rate limited');
    const out = interpretReply(res);
    expect(out.http_status).toBe(429);
    expect(out.error_message).toContain('rate limited');
  });

  it('transport-level failure (no response) → httpStatus 0, still the error pair', async () => {
    post.mockRejectedValueOnce(new Error('socket hang up'));
    const res = await new DeepSeekReplyTransport().send(callFor());
    expect(res).toMatchObject({ rawText: undefined, httpStatus: 0 });
    expect(res.errorMessage).toContain('socket hang up');
  });

  it('empty answer is NOT an error — the interpreter applies the domain fallback', async () => {
    post.mockResolvedValueOnce({ status: 200, data: { choices: [] } });
    const res = await new DeepSeekReplyTransport().send(callFor());
    expect(res.rawText).toBeUndefined();
    expect(res.errorMessage).toBeNull();
    // Shared interpreter decides the wording; the transport must not.
    expect(interpretReply(res).error_message).toBeNull();
    expect(typeof interpretReply(res).text).toBe('string');
  });
});

describe('[P2 DEEPSEEK REPLY] no hard vendor leak', () => {
  it('the neutral + shared files never mention DeepSeek', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    const shared = [
      'src/modules/webhook/ai-reply/reply-neutral.ts',
      'src/modules/webhook/ai-reply/reply-transport.ts',
      'src/modules/webhook/ai-reply/reply-prompt-assembler.ts',
      'src/modules/webhook/ai-reply/reply-interpreter.ts',
    ];
    for (const rel of shared) {
      const body = fs
        .readFileSync(rel, 'utf8')
        .split('\n')
        .filter(
          (l) =>
            !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'),
        )
        .join('\n');
      expect(body.toLowerCase()).not.toContain('deepseek');
      expect(body).not.toContain('api.deepseek.com');
    }
  });
});

describe('[P2 DEEPSEEK REPLY] the "never silently" promise is actually kept', () => {
  /**
   * Review finding: this log existed but NOTHING asserted it — the whole
   * notice could be deleted and the suite stayed green, while the file's header
   * promised knobs are "ignored ONCE with a log, never silently". These cases
   * are what make that promise enforceable.
   */
  let post: jest.SpyInstance;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    resetIgnoredKnobNotice();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    post = jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: { choices: [{ message: { content: 'ok' } }] },
    });
  });
  afterEach(() => {
    post.mockRestore();
    warn.mockRestore();
  });

  it('says which knobs were dropped, naming their values', async () => {
    await new DeepSeekReplyTransport().send(
      callFor({
        knobs: { temperature: 0.4, topP: 0.9, topK: 20 },
        thinkingBudget: 8000,
      }),
    );
    const lines = warn.mock.calls.map((c) => String(c[0]));
    const notice = lines.find((l) => l.includes('[P2-DEEPSEEK]'));
    expect(notice).toBeDefined();
    expect(notice).toContain('topK=20');
    expect(notice).toContain('thinkingBudget=8000');
  });

  it('repeats for a DIFFERENT knob configuration — the per-process flag bug', async () => {
    const t = new DeepSeekReplyTransport();
    await t.send(
      callFor({
        knobs: { temperature: 0.4, topP: 0.9, topK: 20 },
        thinkingBudget: 1,
      }),
    );
    await t.send(
      callFor({
        knobs: { temperature: 0.4, topP: 0.9, topK: 40 },
        thinkingBudget: 2,
      }),
    );
    const notices = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('[P2-DEEPSEEK]'));
    expect(notices).toHaveLength(2);
    expect(notices[1]).toContain('topK=40');
  });

  it('does not repeat for the same configuration (a busy OA cannot flood the log)', async () => {
    const t = new DeepSeekReplyTransport();
    const call = callFor({
      knobs: { temperature: 0.4, topP: 0.9, topK: 20 },
      thinkingBudget: 5,
    });
    await t.send(call);
    await t.send(call);
    await t.send(call);
    const notices = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('[P2-DEEPSEEK]'));
    expect(notices).toHaveLength(1);
  });

  it('a throw from the notice cannot escape send() — the result contract holds', async () => {
    // The notice now runs INSIDE the try. Force it to throw and prove send()
    // still returns a TransportResult instead of rejecting.
    warn.mockImplementation(() => {
      throw new Error('logger exploded');
    });
    const res = await new DeepSeekReplyTransport().send(callFor());
    expect(res.rawText).toBeUndefined();
    expect(res.errorMessage).toContain('logger exploded');
  });
});
