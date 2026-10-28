/**
 * [TEST-20260813-P2A-THREAD] The hook's vendor and model reach the vendor call.
 *
 * A1 put the two columns in the DB; this pins that they actually travel:
 * request → assembler → neutral call → the transport the registry picked, and
 * the same for the summary path. It also pins the key rule at the provider,
 * because that is where a DeepSeek hook would otherwise fire with Google's key.
 *
 * No network: the transports are never invoked here except through fakes.
 */

import { assembleReply } from '@/modules/webhook/ai-reply/reply-prompt-assembler';
import type { AiReplyRequest } from '@/modules/webhook/ai-reply/ai-reply.provider';
import {
  REPLY_TRANSPORTS,
  DEFAULT_REPLY_PROVIDER,
  resolveReplyTransport,
} from '@/modules/webhook/ai-reply/reply-transport.registry';
import {
  SUMMARY_TRANSPORTS,
  resolveSummaryTransport,
} from '@/modules/webhook/assist/summary-transport.registry';
import axios from 'axios';

import { buildDeepSeekBody } from '@/modules/webhook/ai-vendors/deepseek/deepseek-reply.transport';
import { RealAssistSummaryProvider } from '@/modules/webhook/ai-vendors/gemini/assist-summary.provider';
import { GEMINI_FAMILY_MODEL } from '@/modules/webhook/ai-vendors/gemini/gemini-reply.transport';

const baseRequest = (over: Partial<AiReplyRequest> = {}): AiReplyRequest => ({
  question: 'ยอดเท่าไหร่',
  docText: '',
  suggestionText: 'SUGGESTION',
  profileData: null,
  temperature: 0.4,
  topK: 20,
  topP: 0.9,
  thinkingBudget: null,
  hookId: 'h1',
  hookGroupId: null,
  sendRawJson: false,
  rawJsonRules: '',
  sendSiteRules: false,
  siteRulesGuide: '',
  dictOpts: { tool: null, scope: null },
  apiKey: 'HOOK-KEY',
  ...over,
});

/** The assembler returns either a skip verdict or the neutral call. */
function callOf(request: AiReplyRequest) {
  const assembled = assembleReply({
    request,
    substitutedSuggestion: request.suggestionText,
    fastModeOverride: undefined,
  });
  if (assembled.kind !== 'call') throw new Error('expected a call verdict');
  return assembled.call;
}

describe('[P2A THREAD] the hook model reaches the neutral call', () => {
  it("carries the hook's model verbatim", () => {
    expect(callOf(baseRequest({ aiModel: 'deepseek-reasoner' })).modelId).toBe(
      'deepseek-reasoner',
    );
  });

  it('⭐ passes null through instead of guessing a default', () => {
    // The assembler is vendor-blind: the right default depends on which vendor
    // receives the call, so choosing one here would be a guess.
    expect(callOf(baseRequest({ aiModel: null })).modelId).toBeNull();
    expect(callOf(baseRequest()).modelId).toBeNull();
  });

  it('⭐ ignores MODEL_ID entirely — the env layer is gone', () => {
    const saved = process.env['MODEL_ID'];
    try {
      process.env['MODEL_ID'] = 'gemini-from-env';
      expect(callOf(baseRequest({ aiModel: null })).modelId).toBeNull();
      expect(callOf(baseRequest({ aiModel: 'x-model' })).modelId).toBe(
        'x-model',
      );
    } finally {
      if (saved === undefined) delete process.env['MODEL_ID'];
      else process.env['MODEL_ID'] = saved;
    }
  });
});

describe('[P2A THREAD] each transport applies ITS OWN family default on null', () => {
  it('deepseek turns null into its own model, not a Gemini one', () => {
    const body = buildDeepSeekBody(callOf(baseRequest({ aiModel: null })));
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.model).not.toContain('gemini');
  });

  it("gemini's family constant is the value the env default used to carry", () => {
    // Pinning the constant keeps the "a hook with no model hits exactly what it
    // hits today" promise checkable.
    expect(GEMINI_FAMILY_MODEL).toBe('gemini-3.5-flash');
  });
});

describe('[P2A THREAD] the hook vendor selects the transport', () => {
  it('deepseek resolves to the DeepSeek transports on both paths', () => {
    expect(resolveReplyTransport('deepseek')).toBe(
      REPLY_TRANSPORTS['deepseek'],
    );
    expect(resolveSummaryTransport('deepseek')).toBe(
      SUMMARY_TRANSPORTS['deepseek'],
    );
  });

  it('absent / null / unknown all resolve to the default — a typo cannot break a reply', () => {
    const fallback = REPLY_TRANSPORTS[DEFAULT_REPLY_PROVIDER];
    expect(resolveReplyTransport(null)).toBe(fallback);
    expect(resolveReplyTransport(undefined)).toBe(fallback);
    expect(resolveReplyTransport('deepsek')).toBe(fallback);
  });
});

describe('[P2A THREAD] the PROVIDER passes the hook vendor to the registry', () => {
  /**
   * Mutation-driven: removing the argument at the provider left every other
   * test green, because they call the registry directly. These drive the real
   * provider and watch which host is contacted, which is the only place the
   * mistake would show. เทสต้องกัดที่ provider ไม่ใช่แค่ registry.
   */
  let post: jest.SpyInstance;
  beforeEach(() => {
    post = jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        choices: [
          { message: { content: '{"summary":"s","category":"Other"}' } },
        ],
      },
    });
  });
  afterEach(() => post.mockRestore());

  it('a deepseek hook reaches api.deepseek.com on the summary path', async () => {
    await new RealAssistSummaryProvider().summarise({
      history: 'h',
      currentQuestion: 'q',
      currentAnswer: 'a',
      geminiApiKey: 'HOOK-KEY',
      aiVendor: 'deepseek',
      aiModel: null,
    });
    expect(String(post.mock.calls[0]?.[0])).toContain('api.deepseek.com');
  });

  it('a gemini hook still reaches Google on the summary path', async () => {
    post.mockResolvedValueOnce({
      status: 200,
      data: {
        candidates: [
          {
            content: {
              parts: [{ text: '{"summary":"s","category":"Other"}' }],
            },
          },
        ],
      },
    });
    await new RealAssistSummaryProvider().summarise({
      history: 'h',
      currentQuestion: 'q',
      currentAnswer: 'a',
      geminiApiKey: 'HOOK-KEY',
      aiVendor: 'gemini',
      aiModel: null,
    });
    expect(String(post.mock.calls[0]?.[0])).toContain(
      'generativelanguage.googleapis.com',
    );
  });

  it('⭐ a keyless deepseek hook REFUSES instead of borrowing the Gemini env key', async () => {
    const saved = process.env['GEMINI_API_KEY'];
    try {
      process.env['GEMINI_API_KEY'] = 'G-PROD';
      await expect(
        new RealAssistSummaryProvider().summarise({
          history: 'h',
          currentQuestion: 'q',
          currentAnswer: 'a',
          geminiApiKey: undefined,
          aiVendor: 'deepseek',
          aiModel: null,
        }),
      ).rejects.toThrow();
      expect(post).not.toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete process.env['GEMINI_API_KEY'];
      else process.env['GEMINI_API_KEY'] = saved;
    }
  });
});
