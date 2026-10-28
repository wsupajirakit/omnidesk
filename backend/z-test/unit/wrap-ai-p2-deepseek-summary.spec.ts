/**
 * [TEST-20260813-P2-DSSUM] DeepSeek summary transport — contract suite.
 *
 * ⚠️ NO NETWORK: axios.post spied, refusing by default; each test arms one
 * response. `no-ai-outbound` blocks the DeepSeek host as a second layer.
 *
 * The standard here is the CONTRACT, not byte equality with Gemini:
 *   · the SHARED prompt is what gets sent (not a vendor copy)
 *   · the key stays in the header
 *   · the result feeds the SHARED interpreter and produces the same
 *     `{summary, category}` shapes, including the three fallback strings.
 */

import axios from 'axios';

import { AI_HTTP_TIMEOUT_MS } from '@/modules/ai-vendor';

import {
  DeepSeekSummaryTransport,
  buildDeepSeekSummaryBody,
  readDeepSeekSummaryText,
} from '@/modules/webhook/ai-vendors/deepseek/deepseek-summary.transport';
import { DEEPSEEK_CHAT_URL } from '@/modules/webhook/ai-vendors/deepseek/deepseek-reply.transport';
import { buildSummaryPrompt } from '@/modules/webhook/assist/summary-prompt';
import type { SummaryCall } from '@/modules/webhook/assist/summary-neutral';
import {
  interpretSummary,
  SUMMARY_ERROR_FALLBACK,
  SUMMARY_PARSE_FALLBACK,
} from '@/modules/webhook/assist/summary-interpreter';

const callFor = (over: Partial<SummaryCall> = {}): SummaryCall => ({
  history: 'ลูกค้า: สวัสดี\nบอท: สวัสดีค่ะ',
  currentQuestion: 'ยอดค้างเท่าไหร่',
  currentAnswer: 'ขอส่งให้แอดมินตรวจสอบค่ะ',
  apiKey: 'DS-KEY-SUM',
  ...over,
});

describe('[P2 DEEPSEEK SUMMARY] request mapping', () => {
  let post: jest.SpyInstance;
  beforeEach(() => {
    delete process.env['DEEPSEEK_MODEL_ID'];
    post = jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('no test armed this call'));
  });
  afterEach(() => post.mockRestore());

  it('sends the SHARED prompt verbatim — not a vendor copy', () => {
    const call = callFor();
    const body = buildDeepSeekSummaryBody(call);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.role).toBe('user');
    // The whole point of lifting the prompt out of the Gemini file: byte-identical.
    expect(body.messages[0]?.content).toBe(buildSummaryPrompt(call));
  });

  it('mirrors the hardcoded low knobs and invents no top_k', () => {
    const body = buildDeepSeekSummaryBody(callFor());
    expect(body.temperature).toBe(0.1);
    expect(body.top_p).toBe(0.1);
    expect(body as unknown as Record<string, unknown>).not.toHaveProperty(
      'top_k',
    );
  });

  it('uses the per-hook model, else the family default — never an env value', () => {
    expect(buildDeepSeekSummaryBody(callFor()).model).toBe('deepseek-v4-flash');
    expect(
      buildDeepSeekSummaryBody({ ...callFor(), modelId: 'deepseek-reasoner' })
        .model,
    ).toBe('deepseek-reasoner');
    try {
      // A stray env var must not influence the model any more: every value
      // shaping an answer comes from the hook.
      process.env['DEEPSEEK_MODEL_ID'] = 'deepseek-from-env';
      expect(buildDeepSeekSummaryBody(callFor()).model).toBe(
        'deepseek-v4-flash',
      );
    } finally {
      delete process.env['DEEPSEEK_MODEL_ID'];
    }
  });

  it('puts the key in the Authorization header, never the URL', async () => {
    post.mockResolvedValueOnce({
      status: 200,
      data: {
        choices: [
          { message: { content: '{"summary":"x","category":"Other"}' } },
        ],
      },
    });
    await new DeepSeekSummaryTransport().send(callFor());
    const [url, , config] = post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string>; timeout: number },
    ];
    expect(url).toBe(DEEPSEEK_CHAT_URL);
    expect(url).not.toContain('DS-KEY-SUM');
    expect(config.headers['Authorization']).toBe('Bearer DS-KEY-SUM');
    /* [FEAT-20260908-AITIMEOUT] the stall ceiling moved 30s -> 45s for BOTH
       vendors on the owner's decision. Read from the shared constant so this
       lane can never drift to a private number — which is the state the door
       was built to end (DEEPSEEK_HTTP_TIMEOUT_MS used to be declared three
       times, equal only by luck). */
    expect(config.timeout).toBe(AI_HTTP_TIMEOUT_MS);
    expect(AI_HTTP_TIMEOUT_MS).toBe(45_000);
  });
});

describe('[P2 DEEPSEEK SUMMARY] result feeds the shared interpreter', () => {
  let post: jest.SpyInstance;
  beforeEach(() => {
    // Independent of whatever ran before — the model must not be inherited.
    delete process.env['DEEPSEEK_MODEL_ID'];
    post = jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('no test armed this call'));
  });
  afterEach(() => post.mockRestore());

  it('clean JSON → {summary, category} straight through', async () => {
    post.mockResolvedValueOnce({
      status: 200,
      data: {
        choices: [
          {
            message: {
              content: '{"summary":"ลูกค้าถามยอดค้าง","category":"Collection"}',
            },
          },
        ],
      },
    });
    const res = await new DeepSeekSummaryTransport().send(callFor());
    expect(interpretSummary(res)).toEqual({
      summary: 'ลูกค้าถามยอดค้าง',
      category: 'Collection',
    });
  });

  it('fenced JSON → the shared extractor still finds it', async () => {
    post.mockResolvedValueOnce({
      status: 200,
      data: {
        choices: [
          {
            message: {
              content: '```json\n{"summary":"ปัญหาแอพ","category":"IT"}\n```',
            },
          },
        ],
      },
    });
    const res = await new DeepSeekSummaryTransport().send(callFor());
    expect(interpretSummary(res)).toEqual({
      summary: 'ปัญหาแอพ',
      category: 'IT',
    });
  });

  it('unparsable text → the interpreter keeps the raw text (NOT a transport decision)', async () => {
    // ⚠️ Characterised, not assumed: `summary-interpreter.ts:103` returns
    //    `rawText || SUMMARY_PARSE_FALLBACK` — with text present the RAW TEXT
    //    survives; the fallback string is only for "no text at all". My first
    //    draft of this test asserted the fallback and went red, which is the
    //    point of writing the assertion against the real interpreter.
    post.mockResolvedValueOnce({
      status: 200,
      data: { choices: [{ message: { content: 'ขอโทษค่ะ ตอบไม่ได้' } }] },
    });
    const res = await new DeepSeekSummaryTransport().send(callFor());
    expect(interpretSummary(res)).toEqual({
      summary: 'ขอโทษค่ะ ตอบไม่ได้',
      category: 'Other',
    });
  });

  it('no text at all → the shared parse fallback string', async () => {
    post.mockResolvedValueOnce({ status: 200, data: { choices: [] } });
    const res = await new DeepSeekSummaryTransport().send(callFor());
    expect(interpretSummary(res)).toEqual({
      summary: SUMMARY_PARSE_FALLBACK,
      category: 'Other',
    });
  });

  it('vendor error → the error PAIR and the shared error fallback', async () => {
    post.mockRejectedValueOnce({
      response: { status: 500, data: { error: 'boom' } },
    });
    const res = await new DeepSeekSummaryTransport().send(callFor());
    expect(res.rawText).toBeUndefined();
    expect(res.httpStatus).toBe(500);
    expect(res.errorMessage).toContain('boom');
    expect(interpretSummary(res)).toEqual({
      summary: SUMMARY_ERROR_FALLBACK,
      category: 'Other',
    });
  });

  it('content_filter / empty answer → no text, and it is NOT reported as an error', async () => {
    expect(
      readDeepSeekSummaryText({
        choices: [
          { message: { content: 'x' }, finish_reason: 'content_filter' },
        ],
      }),
    ).toBeUndefined();
    post.mockResolvedValueOnce({ status: 200, data: { choices: [] } });
    const res = await new DeepSeekSummaryTransport().send(callFor());
    expect(res.rawText).toBeUndefined();
    expect(res.errorMessage).toBeNull();
  });
});
